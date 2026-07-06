<script setup lang="ts">
// สรุป & ชำระเงิน — the 3-step LINE checkout wizard (02-08 / LINE-02 · DEL-04 · PLAT-04).
// Route "/checkout". Consumes the shared cart store (02-05), calls GET /delivery/quote
// (02-03) for the freshness-gated methods + server fee, POSTs /orders (02-04) with the
// delivery choice + PDPA consent, then routes to /pay/:id.
//
// STEPS (D-16):
//   1) เลือกผักรอบนี้        — review the cart lines (qty/remove), show the DISPLAY subtotal.
//   2) วิธีรับสินค้า & ที่อยู่ — zone + method tiles (freshness-disabled, server fee, free-
//      shipping state, read-only round deliveryDate), recipient fields, PDPA consent.
//      The "ถัดไป" CTA is DISABLED until the required usage consent is ticked (D-25).
//   3) สรุป & ชำระเงิน       — server-sourced summary (subtotal + fee + total); the primary
//      "ยืนยันและชำระเงิน" CTA places the order and navigates to the pay screen.
//
// MONEY (T-02-30): every amount shown is a SERVER value — unit prices from the catalog,
// the delivery fee from the quote. The order body carries ids + qty + choice + consent
// only; POST /orders re-resolves the price/fee/freshness and drives the QR amount.
//
// The screen awaits its data in setup, so the loading state is owned by the App.vue
// <Suspense> fallback (the 02-02 shell pattern). `loaders`/`initialStep` are injectable
// so the component test can mount it DOM-free with a mocked catalog + quote.
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { getCustomerId } from "../liff";
import { useCart } from "../stores/cart";
import BusyOverlay from "../components/BusyOverlay.vue";
import DeliveryMethodTiles from "../components/DeliveryMethodTiles.vue";
import ConsentCheckboxes from "../components/ConsentCheckboxes.vue";
import WizardStepIndicator from "../components/WizardStepIndicator.vue";
import QtyStepper from "../components/QtyStepper.vue";
import EmptyState from "../components/EmptyState.vue";
import {
  type CheckoutConsent,
  type DeliveryMethod,
  type DeliveryQuote,
  DELIVERY_ZONES,
  baht,
  buildOrderBody,
  consentSatisfied,
} from "../lib/checkout";

// ── Catalog shapes (subset we resolve for display) ───────────────────────────
interface Pack {
  saleUnitId: string;
  label: string;
  unitPriceSatang: number;
}
interface Round {
  roundId: string;
  prices: { b2c: { packs: Pack[] } | null };
}
interface CatalogVariety {
  id: string;
  name: string;
  rounds: Round[];
}
interface CatalogBox {
  id: string;
  name: string;
  rounds: { roundId: string; priceSatang: { b2c: number | null } }[];
}
interface CatalogData {
  varieties: CatalogVariety[];
  boxes: CatalogBox[];
}

interface Loaded<T> {
  data: T | null;
  error: unknown;
}
interface QuoteParams {
  roundId: string;
  zoneId: string;
  varietyIds: string[];
  boxIds: string[];
  subtotalSatang: number;
}
interface Loaders {
  catalog?: () => Promise<Loaded<CatalogData>>;
  quote?: (p: QuoteParams) => Promise<Loaded<DeliveryQuote>>;
  placeOrder?: (body: ReturnType<typeof buildOrderBody>) => Promise<Loaded<{ id: string }>>;
}

const props = defineProps<{ loaders?: Loaders; initialStep?: number }>();
const router = useRouter();
const cart = useCart();

const catalogLoad =
  props.loaders?.catalog ?? (() => api.catalog.get() as unknown as Promise<Loaded<CatalogData>>);
const quoteLoad =
  props.loaders?.quote ??
  ((p: QuoteParams) =>
    api.delivery.quote.get({
      query: {
        roundId: p.roundId,
        zoneId: p.zoneId,
        subtotalSatang: p.subtotalSatang,
        varietyIds: p.varietyIds,
        boxIds: p.boxIds,
      },
    }) as unknown as Promise<Loaded<DeliveryQuote>>);
const placeOrder =
  props.loaders?.placeOrder ??
  ((body: ReturnType<typeof buildOrderBody>) =>
    api.orders.post(body) as unknown as Promise<Loaded<{ id: string }>>);

// ── Resolve the cart lines against the catalog for DISPLAY (name/label/price) ──
const catalogRes = await catalogLoad().catch(
  () => ({ data: null, error: { network: true } }) as Loaded<CatalogData>,
);
const varietyById = new Map((catalogRes.data?.varieties ?? []).map((v) => [v.id, v]));
const boxById = new Map((catalogRes.data?.boxes ?? []).map((b) => [b.id, b]));

interface LineRow {
  key: string;
  name: string;
  label: string;
  unitPriceSatang: number;
  qty: number;
  kind: "line" | "box";
}

const lineRows = computed<LineRow[]>(() => {
  const rows: LineRow[] = [];
  for (const l of cart.lines.value) {
    const v = varietyById.get(l.varietyId);
    const round = v?.rounds.find((r) => r.roundId === l.roundId);
    const pack = round?.prices.b2c?.packs.find((p) => p.saleUnitId === l.saleUnitId);
    rows.push({
      key: `${l.roundId}:${l.varietyId}:${l.saleUnitId}`,
      name: v?.name ?? "รายการสินค้า",
      label: pack?.label ?? "",
      unitPriceSatang: pack?.unitPriceSatang ?? 0,
      qty: l.qty,
      kind: "line",
    });
  }
  for (const b of cart.boxLines.value) {
    const box = boxById.get(b.boxId);
    const round = box?.rounds.find((r) => r.roundId === b.roundId);
    rows.push({
      key: `box:${b.roundId}:${b.boxId}`,
      name: box?.name ?? "กล่องผักรวม",
      label: "กล่องผักรวม",
      unitPriceSatang: round?.priceSatang.b2c ?? 0,
      qty: b.qty,
      kind: "box",
    });
  }
  return rows;
});

const cartEmpty = computed(() => lineRows.value.length === 0);
// DISPLAY subtotal (server unit prices × qty) — never sent as money; drives the
// quote's free-shipping calc + the summary line.
const subtotalSatang = computed(() =>
  lineRows.value.reduce((sum, r) => sum + r.unitPriceSatang * r.qty, 0),
);

// The round the cart draws from (all lines share the open round).
const roundId = computed(
  () => cart.lines.value[0]?.roundId ?? cart.boxLines.value[0]?.roundId ?? "",
);

// ── Delivery quote (freshness-gated methods + server fee) ─────────────────────
const zoneId = ref(DELIVERY_ZONES[0]?.id ?? "samut_prakan");
const method = ref<DeliveryMethod | null>(null);
const quote = ref<DeliveryQuote | null>(null);
const quoteError = ref(false);

async function loadQuote(): Promise<void> {
  if (cartEmpty.value || !roundId.value) return;
  quoteError.value = false;
  const res = await quoteLoad({
    roundId: roundId.value,
    zoneId: zoneId.value,
    varietyIds: cart.lines.value.map((l) => l.varietyId),
    boxIds: cart.boxLines.value.map((b) => b.boxId),
    subtotalSatang: subtotalSatang.value,
  }).catch(() => ({ data: null, error: { network: true } }) as Loaded<DeliveryQuote>);
  if (res.error || !res.data) {
    quoteError.value = true;
    quote.value = null;
    return;
  }
  quote.value = res.data;
  // Drop a selected method that the new zone/freshness no longer allows.
  if (method.value && !res.data.allowedMethods.includes(method.value)) method.value = null;
}

// Load the initial quote so step 2 has data on first paint; reload on zone change.
await loadQuote();
watch(zoneId, () => {
  void loadQuote();
});

const selectedFee = computed<number | null>(() => {
  if (!method.value || !quote.value) return null;
  return quote.value.fees[method.value] ?? null;
});
const totalSatang = computed(() => subtotalSatang.value + (selectedFee.value ?? 0));

// ── Recipient + consent ───────────────────────────────────────────────────────
const customer = reactive({ name: "", phone: "", address: "" });
const consent = ref<CheckoutConsent>({ usage: false, marketing: false });
const fieldErrors = reactive({ name: "", phone: "", address: "", method: "" });

function validateStep2(): boolean {
  fieldErrors.name = customer.name.trim() ? "" : "โปรดกรอกชื่อผู้รับ";
  fieldErrors.phone = customer.phone.trim() ? "" : "โปรดกรอกเบอร์โทร";
  fieldErrors.address = customer.address.trim() ? "" : "โปรดกรอกที่อยู่จัดส่ง";
  fieldErrors.method = method.value ? "" : "โปรดเลือกวิธีจัดส่ง";
  return (
    !fieldErrors.name && !fieldErrors.phone && !fieldErrors.address && !fieldErrors.method
  );
}

// The step-2 advance CTA is DISABLED until the required usage consent is ticked (D-25).
const canAdvanceStep2 = computed(() => consentSatisfied(consent.value) && method.value !== null);

// ── Wizard navigation ─────────────────────────────────────────────────────────
const STEP_LABELS = ["เลือกผักรอบนี้", "วิธีรับสินค้า & ที่อยู่", "สรุป & ชำระเงิน"];
const step = ref(props.initialStep ?? 1);

function goStep1to2(): void {
  if (cartEmpty.value) return;
  step.value = 2;
}
function goStep2to3(): void {
  if (!canAdvanceStep2.value) return;
  if (!validateStep2()) return;
  step.value = 3;
}
function back(): void {
  if (step.value > 1) step.value -= 1;
}

const placing = ref(false);
const submitError = ref("");

async function confirm(): Promise<void> {
  if (placing.value || !method.value) return;
  placing.value = true;
  submitError.value = "";
  const body = buildOrderBody({
    lines: cart.lines.value,
    boxLines: cart.boxLines.value,
    deliveryMethod: method.value,
    deliveryZone: zoneId.value,
    customer,
    consent: consent.value,
    // A logged-in member binds the order to their LINE identity (history/detail/push,
    // UAT-4); a guest sends the byte-identical guest body (getCustomerId() === null).
    customerId: getCustomerId() ?? undefined,
  });
  const res = await placeOrder(body).catch(
    () => ({ data: null, error: { network: true } }) as Loaded<{ id: string }>,
  );
  placing.value = false;
  if (res.error || !res.data?.id) {
    submitError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
    return;
  }
  cart.clear();
  await router.push(`/pay/${res.data.id}`);
}
</script>

<template>
  <section class="flex flex-col gap-lg p-md pb-2xl">
    <!-- Blocks all input while placing the order + building the QR (server round-trip). -->
    <BusyOverlay :show="placing" label="กำลังสร้างคำสั่งซื้อ…" />
    <WizardStepIndicator :steps="STEP_LABELS" :current="step" />

    <!-- ── STEP 1 — review cart ─────────────────────────────────────────────── -->
    <div v-if="step === 1" class="flex flex-col gap-md">
      <h1 class="text-[20px] font-semibold leading-[1.35] text-ink">เลือกผักรอบนี้</h1>

      <EmptyState
        v-if="cartEmpty"
        heading="ยังไม่ได้เลือกผัก"
        body="เลือกผักสลัดที่อยากได้ แล้วมาต่อที่นี่"
      >
        <RouterLink
          to="/"
          class="flex min-h-[48px] items-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-white"
          >สั่งผักรอบนี้</RouterLink
        >
      </EmptyState>

      <template v-else>
        <ul class="flex flex-col gap-sm">
          <li
            v-for="row in lineRows"
            :key="row.key"
            class="flex items-center justify-between gap-md rounded-lg bg-surface p-md"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-[16px] font-semibold text-ink">{{ row.name }}</p>
              <p class="text-[14px] text-muted">
                ฿{{ baht(row.unitPriceSatang) }}
                <span v-if="row.label">/ {{ row.label }}</span>
              </p>
            </div>
            <QtyStepper
              v-if="row.kind === 'line'"
              :model-value="row.qty"
              :min="1"
              :max="99"
              @update:model-value="
                (q) =>
                  cart.updateQty(
                    cart.lines.value.find(
                      (l) => `${l.roundId}:${l.varietyId}:${l.saleUnitId}` === row.key,
                    )!,
                    q,
                  )
              "
            />
            <span v-else class="text-[16px] font-semibold text-ink">×{{ row.qty }}</span>
          </li>
        </ul>

        <div class="flex items-center justify-between border-t border-hairline pt-md">
          <span class="text-[16px] text-muted">ยอดรวมสินค้า</span>
          <span class="text-[20px] font-semibold text-ink">฿{{ baht(subtotalSatang) }}</span>
        </div>

        <button
          type="button"
          class="mt-sm flex h-[48px] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-white disabled:opacity-40"
          :disabled="cartEmpty"
          @click="goStep1to2"
        >
          ถัดไป
        </button>
      </template>
    </div>

    <!-- ── STEP 2 — delivery + address + consent ────────────────────────────── -->
    <div v-else-if="step === 2" class="flex flex-col gap-lg">
      <h1 class="text-[20px] font-semibold leading-[1.35] text-ink">วิธีรับสินค้า & ที่อยู่</h1>

      <!-- Zone -->
      <div class="flex flex-col gap-sm">
        <label class="text-[14px] font-semibold text-ink" for="zone">เขตจัดส่ง</label>
        <select
          id="zone"
          v-model="zoneId"
          class="min-h-[44px] rounded-lg border border-hairline bg-canvas px-md text-[16px] text-ink"
        >
          <option v-for="z in DELIVERY_ZONES" :key="z.id" :value="z.id">{{ z.nameTh }}</option>
        </select>
      </div>

      <!-- Method tiles -->
      <div class="flex flex-col gap-sm">
        <p class="text-[14px] font-semibold text-ink">วิธีจัดส่ง</p>
        <p
          v-if="quoteError"
          class="text-[14px] text-destructive"
          role="alert"
        >
          เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง
        </p>
        <DeliveryMethodTiles
          v-else-if="quote"
          v-model="method"
          :allowed-methods="quote.allowedMethods"
          :fees="quote.fees"
        />
        <p class="text-[14px] text-muted">ส่งฟรีเมื่อซื้อครบ ฿500 (เฉพาะส่งเอง/ขนส่งทั่วไป)</p>
        <p v-if="quote?.deliveryDate" class="text-[14px] text-muted">
          กำหนดจัดส่ง: {{ quote.deliveryDate }}
        </p>
        <p v-if="fieldErrors.method" class="text-[14px] text-destructive">
          {{ fieldErrors.method }}
        </p>
      </div>

      <!-- Recipient -->
      <div class="flex flex-col gap-md">
        <div class="flex flex-col gap-xs">
          <label class="text-[14px] font-semibold text-ink" for="name">ชื่อผู้รับ</label>
          <input
            id="name"
            v-model="customer.name"
            type="text"
            class="min-h-[44px] rounded-lg border border-hairline bg-canvas px-md text-[16px] text-ink"
          />
          <p v-if="fieldErrors.name" class="text-[14px] text-destructive">{{ fieldErrors.name }}</p>
        </div>
        <div class="flex flex-col gap-xs">
          <label class="text-[14px] font-semibold text-ink" for="phone">เบอร์โทร</label>
          <input
            id="phone"
            v-model="customer.phone"
            type="tel"
            inputmode="tel"
            class="min-h-[44px] rounded-lg border border-hairline bg-canvas px-md text-[16px] text-ink"
          />
          <p v-if="fieldErrors.phone" class="text-[14px] text-destructive">
            {{ fieldErrors.phone }}
          </p>
        </div>
        <div class="flex flex-col gap-xs">
          <label class="text-[14px] font-semibold text-ink" for="address">ที่อยู่จัดส่ง</label>
          <textarea
            id="address"
            v-model="customer.address"
            rows="3"
            class="rounded-lg border border-hairline bg-canvas px-md py-sm text-[16px] text-ink"
          />
          <p v-if="fieldErrors.address" class="text-[14px] text-destructive">
            {{ fieldErrors.address }}
          </p>
        </div>
      </div>

      <!-- PDPA consent -->
      <ConsentCheckboxes v-model="consent" />

      <div class="flex gap-md">
        <button
          type="button"
          class="flex h-[48px] flex-1 items-center justify-center rounded-lg border border-hairline text-[16px] text-ink"
          @click="back"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          class="flex h-[48px] flex-[2] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-white disabled:opacity-40"
          :disabled="!canAdvanceStep2"
          @click="goStep2to3"
        >
          ถัดไป
        </button>
      </div>
    </div>

    <!-- ── STEP 3 — summary + place order ───────────────────────────────────── -->
    <div v-else class="flex flex-col gap-lg">
      <h1 class="text-[20px] font-semibold leading-[1.35] text-ink">สรุป & ชำระเงิน</h1>

      <ul class="flex flex-col gap-sm">
        <li
          v-for="row in lineRows"
          :key="row.key"
          class="flex items-center justify-between gap-md text-[16px] text-ink"
        >
          <span class="min-w-0 flex-1 truncate">{{ row.name }} ×{{ row.qty }}</span>
          <span class="shrink-0 font-semibold">฿{{ baht(row.unitPriceSatang * row.qty) }}</span>
        </li>
      </ul>

      <div class="flex flex-col gap-sm border-t border-hairline pt-md text-[16px]">
        <div class="flex items-center justify-between text-muted">
          <span>ยอดรวมสินค้า</span><span>฿{{ baht(subtotalSatang) }}</span>
        </div>
        <div class="flex items-center justify-between text-muted">
          <span>ค่าจัดส่ง</span>
          <span v-if="selectedFee === 0" class="font-semibold text-accent">ส่งฟรี</span>
          <span v-else>฿{{ baht(selectedFee ?? 0) }}</span>
        </div>
        <div class="flex items-center justify-between text-[20px] font-semibold text-ink">
          <span>ยอดชำระ</span><span>฿{{ baht(totalSatang) }}</span>
        </div>
      </div>

      <p v-if="submitError" class="text-[14px] text-destructive" role="alert">{{ submitError }}</p>

      <div class="flex gap-md">
        <button
          type="button"
          class="flex h-[48px] flex-1 items-center justify-center rounded-lg border border-hairline text-[16px] text-ink"
          @click="back"
        >
          ย้อนกลับ
        </button>
        <button
          type="button"
          class="flex h-[48px] flex-[2] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-white disabled:opacity-40"
          :disabled="placing"
          @click="confirm"
        >
          ยืนยันและชำระเงิน
        </button>
      </div>
    </div>
  </section>
</template>
