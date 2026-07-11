<script setup lang="ts">
// บัญชี B2B — LIFF wholesale account (03-08, CUST-02 / CUST-05 · D-08/D-09). Route
// "/b2b". A B2B customer applies for approval, then (once a staff member approves)
// sees wholesale prices and sets a recurring standing order. The SERVER is the
// authority: the wholesale price is gated behind approval (/me/b2b/prices → 403
// until approved, T-03-21) and the standing order is scoped to the session customer
// (T-03-20). This screen only mirrors those states.
//
// States (UI-SPEC §B2B): guest-gate · not-applied (apply) · pending-approval gate ·
// rejected · approved (wholesale prices + standing-order set) · error. The loading
// state is owned by the App.vue <Suspense> fallback. `sessionToken` + `loaders` +
// action fns are injectable so the view test runs DOM-free.
import { computed, reactive, ref } from "vue";
import { api } from "../api";
import { ensureLineLogin, getSessionToken, loginWithLine } from "../liff";
import { baht } from "../stores/subscription";
import BusyOverlay from "../components/BusyOverlay.vue";
import EmptyState from "../components/EmptyState.vue";

interface Account {
  b2bStatus: "pending" | "approved" | "rejected" | null;
  creditTerms: string | null;
}
interface CatalogVariety {
  id: string;
  name: string;
  rounds: { roundId: string }[];
}
interface StandingItem {
  varietyId: string;
  plantsPerRound: number;
}
interface StandingOrder {
  id: string;
  active: boolean;
  items: StandingItem[];
}
interface PriceResult {
  data: { pricePerKgSatang: number } | null;
  error: unknown | null;
}
interface Loaders {
  account?: () => Promise<{ data: Account | null; error: unknown }>;
  catalog?: () => Promise<{ data: { varieties: CatalogVariety[] } | null; error: unknown }>;
  standing?: () => Promise<{ data: { standingOrders: StandingOrder[] } | null; error: unknown }>;
  price?: (roundId: string, varietyId: string) => Promise<PriceResult>;
}

const props = defineProps<{
  sessionToken?: string | null;
  loaders?: Loaders;
  applyFn?: () => Promise<{ error: unknown }>;
  createStandingFn?: (body: { items: StandingItem[] }) => Promise<{ error: unknown }>;
}>();

const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);
function authHeaders() {
  return { authorization: `Bearer ${token ?? ""}` };
}

const accountLoad =
  props.loaders?.account ??
  (() => api.me.b2b.get({ headers: authHeaders() }) as unknown as Promise<{ data: Account | null; error: unknown }>);
const catalogLoad =
  props.loaders?.catalog ??
  (() => api.catalog.get() as unknown as Promise<{ data: { varieties: CatalogVariety[] } | null; error: unknown }>);
const standingLoad =
  props.loaders?.standing ??
  (() =>
    api.me["standing-orders"].get({ headers: authHeaders() }) as unknown as Promise<{
      data: { standingOrders: StandingOrder[] } | null;
      error: unknown;
    }>);
const priceLoad =
  props.loaders?.price ??
  ((roundId: string, varietyId: string) =>
    api.me.b2b.prices.get({
      query: { roundId, varietyId },
      headers: authHeaders(),
    }) as unknown as Promise<PriceResult>);
const applyCall =
  props.applyFn ??
  (() => api.me.b2b.apply.post({}, { headers: authHeaders() }) as unknown as Promise<{ error: unknown }>);
const createStandingCall =
  props.createStandingFn ??
  ((body: { items: StandingItem[] }) =>
    api.me["standing-orders"].post(body, { headers: authHeaders() }) as unknown as Promise<{ error: unknown }>);

const errored = ref(false);
const account = ref<Account | null>(null);

interface PricedVariety {
  varietyId: string;
  name: string;
  roundId: string;
  pricePerKgSatang: number | null;
}
const pricedVarieties = ref<PricedVariety[]>([]);
const existingStanding = ref<StandingOrder | null>(null);
// The plants-per-round the customer wants per variety (the standing-order draft).
const draft = reactive<Record<string, number>>({});

async function loadApproved(): Promise<void> {
  const [cat, standing] = await Promise.all([
    catalogLoad().catch(() => ({ data: null, error: { network: true } })),
    standingLoad().catch(() => ({ data: null, error: { network: true } })),
  ]);
  const varieties = cat.data?.varieties ?? [];
  existingStanding.value = standing.data?.standingOrders?.find((o) => o.active) ?? null;

  // Resolve the wholesale price per variety through the GATED endpoint (server
  // authority, T-03-21) — a 403/404 simply yields a null price for that row.
  const rows = await Promise.all(
    varieties
      .filter((v) => v.rounds[0])
      .map(async (v) => {
        const roundId = v.rounds[0]!.roundId;
        const res = await priceLoad(roundId, v.id).catch(
          () => ({ data: null, error: { network: true } }) as PriceResult,
        );
        return {
          varietyId: v.id,
          name: v.name,
          roundId,
          pricePerKgSatang: res.data?.pricePerKgSatang ?? null,
        } satisfies PricedVariety;
      }),
  );
  pricedVarieties.value = rows;
  for (const r of rows) {
    const existing = existingStanding.value?.items.find((it) => it.varietyId === r.varietyId);
    draft[r.varietyId] = existing?.plantsPerRound ?? 0;
  }
}

async function reload(): Promise<void> {
  const res = await accountLoad().catch(() => ({ data: null, error: { network: true } }));
  errored.value = res.error != null;
  account.value = res.data ?? null;
  if (account.value?.b2bStatus === "approved") await loadApproved();
}

if (isMember) await reload();

const status = computed(() => account.value?.b2bStatus ?? null);
const busy = ref(false);
const actionError = ref<string | null>(null);

async function onLogin(): Promise<void> {
  await ensureLineLogin();
  const session = await loginWithLine().catch(() => null);
  if (session) location.reload();
}

async function onApply(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const res = await applyCall();
    if (res.error != null) {
      actionError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      return;
    }
    await reload();
  } finally {
    busy.value = false;
  }
}

const draftItems = computed<StandingItem[]>(() =>
  pricedVarieties.value
    .map((v) => ({ varietyId: v.varietyId, plantsPerRound: Number(draft[v.varietyId] ?? 0) }))
    .filter((it) => it.plantsPerRound > 0),
);

async function onSaveStanding(): Promise<void> {
  if (busy.value || draftItems.value.length === 0) return;
  busy.value = true;
  actionError.value = null;
  try {
    const res = await createStandingCall({ items: draftItems.value });
    if (res.error != null) {
      actionError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      return;
    }
    await reload();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="p-md">
    <BusyOverlay :show="busy" label="กำลังดำเนินการ…" />
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">บัญชี B2B</h1>

    <!-- Guest gate -->
    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อใช้บัญชี B2B"
      body="ราคาส่งและออเดอร์ประจำใช้ได้เมื่อเข้าสู่ระบบด้วย LINE"
    >
      <button
        type="button"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
        @click="onLogin"
      >
        เข้าสู่ระบบด้วย LINE
      </button>
    </EmptyState>

    <!-- Error -->
    <div v-else-if="errored" class="flex flex-col items-center gap-md py-2xl text-center" role="alert">
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <!-- Not applied yet → apply CTA. -->
    <EmptyState
      v-else-if="status === null"
      heading="สมัครบัญชี B2B เพื่อรับราคาส่ง"
      body="ส่งคำขอเปิดบัญชีขายส่ง เมื่ออนุมัติแล้วคุณจะเห็นราคาส่งและตั้งออเดอร์ประจำได้"
    >
      <p
        v-if="actionError"
        class="mb-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ actionError }}
      </p>
      <button
        type="button"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white disabled:opacity-50"
        :disabled="busy"
        @click="onApply"
      >
        สมัครบัญชี B2B
      </button>
    </EmptyState>

    <!-- Pending approval gate (D-08) -->
    <EmptyState
      v-else-if="status === 'pending'"
      heading="บัญชี B2B กำลังรอการอนุมัติ"
      body="เราจะแจ้งทาง LINE เมื่ออนุมัติแล้ว จากนั้นคุณจะเห็นราคาส่งและตั้งออเดอร์ประจำได้"
    />

    <!-- Rejected -->
    <EmptyState
      v-else-if="status === 'rejected'"
      heading="คำขอบัญชี B2B ไม่ได้รับการอนุมัติ"
      body="หากมีข้อสงสัย ติดต่อร้านได้ทาง LINE"
    />

    <!-- Approved → wholesale prices + standing order -->
    <template v-else-if="status === 'approved'">
      <p
        v-if="account?.creditTerms"
        class="mb-md rounded-lg bg-[#F1F5EC] px-md py-sm text-[14px] text-[#5B6B5B]"
      >
        เงื่อนไขเครดิต: {{ account.creditTerms }}
      </p>

      <p
        v-if="actionError"
        class="mb-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ actionError }}
      </p>

      <h2 class="mb-sm text-[18px] font-semibold text-ink">ราคาส่งรอบนี้</h2>
      <EmptyState
        v-if="pricedVarieties.length === 0"
        heading="ยังไม่มีสินค้าเปิดขายรอบนี้"
        body="เมื่อมีรอบขายเปิดอยู่ ราคาส่งจะแสดงที่นี่"
      />
      <ul v-else class="mb-xl flex flex-col gap-sm">
        <li
          v-for="v in pricedVarieties"
          :key="v.varietyId"
          class="rounded-xl border border-border p-md"
        >
          <div class="flex items-center justify-between gap-md">
            <span class="text-[16px] font-medium text-ink">{{ v.name }}</span>
            <span v-if="v.pricePerKgSatang != null" class="text-[16px] font-semibold text-accent">
              {{ baht(v.pricePerKgSatang) }}/กก.
            </span>
            <span v-else class="text-[15px] text-muted">—</span>
          </div>
          <!-- Standing-order plants-per-round for this variety. -->
          <label class="mt-sm flex items-center justify-between gap-md text-[15px] text-muted">
            <span>ออเดอร์ประจำ (ต้น/รอบ)</span>
            <input
              v-model.number="draft[v.varietyId]"
              type="number"
              min="0"
              inputmode="numeric"
              class="w-24 rounded-lg border border-border px-sm py-[6px] text-right text-[15px] text-ink"
            />
          </label>
        </li>
      </ul>

      <p v-if="existingStanding" class="mb-md text-[14px] text-muted">
        คุณมีออเดอร์ประจำอยู่แล้ว — บันทึกใหม่เพื่อปรับจำนวน
      </p>

      <!-- Place / update the standing order (D-09). -->
      <button
        type="button"
        class="w-full rounded-lg bg-accent px-lg py-md text-[17px] font-semibold text-white disabled:opacity-50"
        :disabled="busy || draftItems.length === 0"
        @click="onSaveStanding"
      >
        ตั้งออเดอร์ประจำ
      </button>
    </template>
  </section>
</template>
