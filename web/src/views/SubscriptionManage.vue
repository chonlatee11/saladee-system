<script setup lang="ts">
// จัดการสมาชิก — LIFF subscription self-service manage (03-08, CUST/SALE-03 · D-14).
// Route "/subscription/manage". A member pauses / skips the next round / cancels
// their OWN box. The server is the authority: ownership (customerId=session) + the
// cut-off gate live in the api (03-07); this screen only mirrors them and shows the
// after-cut-off locked notice. Inherits the Phase-2 mobile contract verbatim.
//
// States (UI-SPEC §manage): guest-gate · active · paused · after-cutoff-locked ·
// pause/skip/cancel confirm · not-a-member (empty) · error. The loading state is
// owned by the App.vue <Suspense> fallback. `sessionToken`/`loader`/`actionFn` are
// injectable so the view test runs DOM-free.
import { computed, ref } from "vue";
import { api } from "../api";
import { ensureLineLogin, getSessionToken, loginWithLine } from "../liff";
import { baht } from "../stores/subscription";
import BusyOverlay from "../components/BusyOverlay.vue";
import EmptyState from "../components/EmptyState.vue";

interface MySubscription {
  id: string;
  packageCode: string;
  packageValueSatang: number;
  frequency: string;
  status: string;
}
interface NextRound {
  id: string;
  name: string;
  cutoffAt: string | null;
  deliveryDate: string | null;
}
interface ListResult {
  data: { subscriptions: MySubscription[]; nextRound: NextRound | null } | null;
  error: unknown | null;
}
type Action = "pause" | "resume" | "skip" | "cancel";
interface ActionResult {
  error: unknown | null;
}

const props = defineProps<{
  sessionToken?: string | null;
  loader?: () => Promise<ListResult>;
  actionFn?: (action: Action, id: string, roundId?: string) => Promise<ActionResult>;
}>();

const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);

function authHeaders() {
  return { authorization: `Bearer ${token ?? ""}` };
}

const defaultLoader = (): Promise<ListResult> =>
  api.me.subscriptions.get({ headers: authHeaders() }) as unknown as Promise<ListResult>;
const defaultAction = (action: Action, id: string, roundId?: string): Promise<ActionResult> => {
  const node = api.subscriptions({ id });
  if (action === "skip") {
    return node.skip.post({ roundId: roundId ?? "" }, { headers: authHeaders() }) as unknown as Promise<ActionResult>;
  }
  return node[action].post({}, { headers: authHeaders() }) as unknown as Promise<ActionResult>;
};

const errored = ref(false);
const subscriptions = ref<MySubscription[]>([]);
const nextRound = ref<NextRound | null>(null);

async function reload(): Promise<void> {
  const res = await (props.loader ?? defaultLoader)().catch(
    () => ({ data: null, error: { network: true } }) as ListResult,
  );
  errored.value = res.error != null;
  subscriptions.value = res.data?.subscriptions ?? [];
  nextRound.value = res.data?.nextRound ?? null;
}

// Async setup: only members fetch (the App <Suspense> owns the spinner).
if (isMember) await reload();

// The manageable box: the first active/paused subscription (cancelled ones are done).
const current = computed(() =>
  subscriptions.value.find((s) => s.status === "active" || s.status === "paused") ?? null,
);
const isNotMember = computed(() => isMember && !errored.value && current.value === null);

// After-cut-off (D-14): once the next round's cut-off passes, adjustments apply to the
// round AFTER it — the skip for THIS round is locked (the server 409s it too).
const cutoffPassed = computed(() => {
  const c = nextRound.value?.cutoffAt;
  return c != null && new Date() > new Date(c);
});
function cutoffTime(): string {
  const c = nextRound.value?.cutoffAt;
  if (!c) return "";
  return new Date(c).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const busy = ref(false);
const actionError = ref<string | null>(null);
// The confirm modal: which action is awaiting the member's confirmation (null=closed).
const pending = ref<Action | null>(null);

const frequencyLabel = (f: string): string =>
  f === "weekly" ? "ทุกสัปดาห์" : f === "biweekly" ? "ทุก 2 สัปดาห์" : f;
const statusLabel = (s: string): string =>
  s === "active" ? "กำลังรับกล่อง" : s === "paused" ? "หยุดชั่วคราว" : s;

interface ConfirmCopy {
  heading: string;
  body: string;
  confirm: string;
  destructive: boolean;
}
const confirmCopy = computed<ConfirmCopy | null>(() => {
  switch (pending.value) {
    case "pause":
      return { heading: "หยุดชั่วคราว", body: "หยุดรับกล่องผักไว้ก่อนใช่ไหม? กลับมารับต่อได้ทุกเมื่อ", confirm: "หยุดชั่วคราว", destructive: false };
    case "skip":
      return { heading: "ข้ามรอบนี้", body: "ข้ามกล่องผักรอบถัดไปใช่ไหม? รอบถัด ๆ ไปยังจัดส่งตามปกติ", confirm: "ข้ามรอบนี้", destructive: false };
    case "cancel":
      return { heading: "ยกเลิกสมาชิก", body: "ยกเลิกกล่องผักถาวรใช่ไหม? สมัครใหม่ได้ทุกเมื่อ", confirm: "ยืนยันยกเลิก", destructive: true };
    default:
      return null;
  }
});

async function onLogin(): Promise<void> {
  await ensureLineLogin();
  const session = await loginWithLine().catch(() => null);
  if (session) location.reload();
}

function ask(action: Action): void {
  actionError.value = null;
  pending.value = action;
}
function dismiss(): void {
  pending.value = null;
}

async function resume(): Promise<void> {
  await run("resume");
}

async function confirmAction(): Promise<void> {
  const action = pending.value;
  if (!action) return;
  pending.value = null;
  await run(action);
}

async function run(action: Action): Promise<void> {
  if (busy.value || !current.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const roundId = action === "skip" ? nextRound.value?.id : undefined;
    const res = await (props.actionFn ?? defaultAction)(action, current.value.id, roundId);
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
    <BusyOverlay :show="busy" label="กำลังอัปเดตสมาชิก…" />
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">จัดการสมาชิก</h1>

    <!-- Guest gate -->
    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อจัดการสมาชิก"
      body="การจัดการกล่องผักใช้ได้เมื่อเข้าสู่ระบบด้วย LINE"
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

    <!-- Not a member yet → route to signup. -->
    <EmptyState
      v-else-if="isNotMember"
      heading="ยังไม่ได้สมัครกล่องผัก"
      body="เลือกแพ็กเกจและความถี่ที่ต้องการ แล้วเราจัดผักสดให้ทุกรอบ"
    >
      <RouterLink
        to="/subscription"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
      >
        สมัครสมาชิกกล่องผัก
      </RouterLink>
    </EmptyState>

    <!-- Active / paused member -->
    <template v-else-if="current">
      <div class="rounded-xl border border-border p-md">
        <div class="flex items-center justify-between gap-md">
          <span class="text-[18px] font-semibold text-ink">แพ็กเกจ {{ current.packageCode }}</span>
          <span
            class="rounded-full px-sm py-[2px] text-[13px] font-medium"
            :class="current.status === 'active' ? 'bg-[#F1F5EC] text-[#5B6B5B]' : 'bg-[#F1F5EC] text-[#5B6B5B]'"
          >
            {{ statusLabel(current.status) }}
          </span>
        </div>
        <p class="mt-sm text-[15px] text-muted">
          มูลค่ากล่อง {{ baht(current.packageValueSatang) }} · {{ frequencyLabel(current.frequency) }}
        </p>
        <p v-if="nextRound" class="mt-[2px] text-[14px] text-muted">
          รอบถัดไป: {{ nextRound.name }}
        </p>
      </div>

      <!-- After-cut-off locked notice (D-14) -->
      <p
        v-if="cutoffPassed"
        class="mt-md rounded-lg bg-[#FFF4E5] px-md py-sm text-[14px] leading-[1.55] text-[#B26A00]"
        role="status"
      >
        รอบนี้เลยเวลาปรับแล้ว (ปิดรับ {{ cutoffTime() }}) การหยุด/ข้าม/ยกเลิกจะมีผลกับรอบถัดไป
      </p>

      <p
        v-if="actionError"
        class="mt-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ actionError }}
      </p>

      <!-- Actions -->
      <div class="mt-lg flex flex-col gap-sm">
        <button
          v-if="current.status === 'active'"
          type="button"
          class="w-full rounded-lg border border-border px-lg py-sm text-[16px] font-semibold text-ink disabled:opacity-50"
          :disabled="busy"
          @click="ask('pause')"
        >
          หยุดชั่วคราว
        </button>
        <button
          v-else
          type="button"
          class="w-full rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white disabled:opacity-50"
          :disabled="busy"
          @click="resume"
        >
          กลับมารับต่อ
        </button>

        <button
          type="button"
          class="w-full rounded-lg border border-border px-lg py-sm text-[16px] font-semibold text-ink disabled:opacity-50"
          :disabled="busy || cutoffPassed || !nextRound"
          @click="ask('skip')"
        >
          ข้ามรอบนี้
        </button>

        <button
          type="button"
          class="w-full rounded-lg border border-destructive px-lg py-sm text-[16px] font-semibold text-destructive disabled:opacity-50"
          :disabled="busy"
          @click="ask('cancel')"
        >
          ยกเลิกสมาชิก
        </button>
      </div>
    </template>

    <!-- Confirm modal (destructive confirm on the right; never pre-focus it). -->
    <div
      v-if="confirmCopy"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-md sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div class="w-full max-w-[26rem] rounded-2xl bg-white p-lg">
        <h2 class="text-[18px] font-semibold text-ink">{{ confirmCopy.heading }}</h2>
        <p class="mt-sm text-[15px] leading-[1.6] text-muted">{{ confirmCopy.body }}</p>
        <div class="mt-lg flex gap-sm">
          <button
            type="button"
            class="flex-1 rounded-lg border border-border px-md py-sm text-[16px] font-semibold text-ink"
            @click="dismiss"
          >
            ไม่ใช่
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg px-md py-sm text-[16px] font-semibold text-white"
            :class="confirmCopy.destructive ? 'bg-destructive' : 'bg-accent'"
            @click="confirmAction"
          >
            {{ confirmCopy.confirm }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
