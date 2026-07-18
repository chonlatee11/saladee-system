<script setup lang="ts">
// Guest web-store checkout (04-09, ORD-05). A single-page wizard that REUSES the
// existing order/reservation/payment endpoints unchanged — NO new order or payment
// API, no second reservation path (D-02 / NFR-02 / T-04-28):
//
//   1) ตะกร้า        — review the cart lines (qty/remove), DISPLAY subtotal.
//   2) จัดส่ง & ผู้รับ — zone + freshness-gated method (GET /delivery/quote), recipient
//                       fields, PDPA consent, coupon + points fields (D-14).
//   3) สรุป          — server-priced summary; the primary CTA POSTs the order.
//   4) ชำระเงิน       — GET /orders/:id/qr renders the PromptPay QR for the NET (post-
//                       discount) whole-baht amount; the slip upload POSTs the slip.
//
// MONEY / SECURITY (T-04-29): nothing here computes or trusts money. The order body
// carries ONLY ids + qty + delivery choice + consent + a coupon CODE (never a value).
// POST /orders re-resolves every price, the fee, the freshness intersection AND the
// coupon discount, then drives the QR amount. The subtotal shown is DISPLAY-only,
// summed from server-resolved unit prices. A guest never earns/redeems points (T-04-31).
//
// This page is CSR (routeRules ssr:false in nuxt.config) — the cart is client
// sessionStorage state and the checkout does live API round-trips; SSR gains nothing.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useCart, type CartBoxLine, type CartLine } from "~/stores/cart";
import CouponField from "~/components/CouponField.vue";
import PointsRedeem from "~/components/PointsRedeem.vue";
import QtyStepper from "~/components/QtyStepper.vue";
import EmptyState from "~/components/EmptyState.vue";

// ── Checkout constants (mirrors web/src/lib/checkout.ts — one brand N apps) ────────
type DeliveryMethod = "self" | "cold" | "on_demand" | "general";
const DELIVERY_METHODS: DeliveryMethod[] = ["self", "cold", "general", "on_demand"];
const METHOD_LABEL: Record<DeliveryMethod, string> = {
  self: "ส่งเอง (ในพื้นที่)",
  cold: "ส่งแบบแช่เย็น",
  general: "ขนส่งทั่วไป",
  on_demand: "ส่งด่วนตามสั่ง",
};
interface DeliveryZone {
  id: string;
  nameTh: string;
}
const DELIVERY_ZONES: DeliveryZone[] = [
  { id: "samut_prakan", nameTh: "สมุทรปราการ (ส่งเอง)" },
  { id: "upcountry", nameTh: "ต่างจังหวัด (ขนส่งทั่วไป)" },
];
const POLICY_VERSION = "1.0";

/** Whole-baht display from server satang (Phase-1 prices/fees are whole-baht, X.00). */
function baht(satang: number): number {
  return Math.round(satang / 100);
}

/** Read a segment/coupon code carried in the arrival link (D-14): `?code=…`. */
function readArrivalCode(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  return (sp.get("code") ?? "").trim();
}

const api = useApi();
const router = useRouter();
const cart = useCart();

// ── Catalog resolution for DISPLAY (name/label/price) ─────────────────────────────
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

const catalog = ref<CatalogData | null>(null);
const varietyById = computed(
  () => new Map((catalog.value?.varieties ?? []).map((v) => [v.id, v])),
);
const boxById = computed(() => new Map((catalog.value?.boxes ?? []).map((b) => [b.id, b])));

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
    const v = varietyById.value.get(l.varietyId);
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
    const box = boxById.value.get(b.boxId);
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
// DISPLAY subtotal (server unit prices × qty) — never sent as money; drives the quote's
// free-shipping calc + the summary line.
const subtotalSatang = computed(() =>
  lineRows.value.reduce((sum, r) => sum + r.unitPriceSatang * r.qty, 0),
);
const roundId = computed(
  () => cart.lines.value[0]?.roundId ?? cart.boxLines.value[0]?.roundId ?? "",
);

// ── Delivery quote (freshness-gated methods + server fee) ──────────────────────────
interface DeliveryQuote {
  allowedMethods: DeliveryMethod[];
  fees: Partial<Record<DeliveryMethod, number>>;
  deliveryDate: string | null;
}
const zoneId = ref(DELIVERY_ZONES[0]?.id ?? "samut_prakan");
const method = ref<DeliveryMethod | null>(null);
const quote = ref<DeliveryQuote | null>(null);
const quoteError = ref(false);

async function loadQuote(): Promise<void> {
  if (cartEmpty.value || !roundId.value) return;
  quoteError.value = false;
  try {
    const { data, error } = await (
      api.delivery.quote.get as unknown as (o: {
        query: Record<string, unknown>;
      }) => Promise<{ data: DeliveryQuote | null; error: unknown }>
    )({
      query: {
        roundId: roundId.value,
        zoneId: zoneId.value,
        subtotalSatang: subtotalSatang.value,
        varietyIds: cart.lines.value.map((l) => l.varietyId),
        boxIds: cart.boxLines.value.map((b) => b.boxId),
      },
    });
    if (error || !data) {
      quoteError.value = true;
      quote.value = null;
      return;
    }
    quote.value = data;
    if (method.value && !data.allowedMethods.includes(method.value)) method.value = null;
  } catch {
    quoteError.value = true;
    quote.value = null;
  }
}
watch(zoneId, () => void loadQuote());

const selectedFee = computed<number | null>(() => {
  if (!method.value || !quote.value) return null;
  return quote.value.fees[method.value] ?? null;
});
const totalSatang = computed(() => subtotalSatang.value + (selectedFee.value ?? 0));

// ── Recipient + PDPA consent + discount inputs ─────────────────────────────────────
const customer = reactive({ name: "", phone: "", address: "" });
const consent = reactive({ usage: false, marketing: false });
const fieldErrors = reactive({ name: "", phone: "", address: "", method: "" });

// The web store has no LINE login wired yet → every buyer is a GUEST: no points, coupon
// only. isMember stays false so PointsRedeem shows the log-in hint and redeemPoints is
// never sent (T-04-31). Coupons work for guests — the server resolves/validates them.
const isMember = false;
const couponCode = ref("");
const redeemPoints = ref(0);
const arrivalCode = ref("");
onMounted(() => {
  arrivalCode.value = readArrivalCode();
  if (arrivalCode.value) couponCode.value = arrivalCode.value;
});

function validateStep2(): boolean {
  fieldErrors.name = customer.name.trim() ? "" : "โปรดกรอกชื่อผู้รับ";
  fieldErrors.phone = customer.phone.trim() ? "" : "โปรดกรอกเบอร์โทร";
  fieldErrors.address = customer.address.trim() ? "" : "โปรดกรอกที่อยู่จัดส่ง";
  fieldErrors.method = method.value ? "" : "โปรดเลือกวิธีจัดส่ง";
  return !fieldErrors.name && !fieldErrors.phone && !fieldErrors.address && !fieldErrors.method;
}
// The step-2 advance CTA is disabled until the required usage consent is ticked (D-25).
const canAdvanceStep2 = computed(() => consent.usage === true && method.value !== null);

/** Build the POST /orders body — ids + qty + delivery choice + consent + coupon CODE
 *  only (guest path, no customerId, no money, no redeemPoints for a guest). */
function buildOrderBody() {
  const body: Record<string, unknown> = {
    tier: "b2c",
    customer: {
      name: customer.name,
      phone: customer.phone,
      recipientName: customer.name,
      recipientPhone: customer.phone,
      recipientAddress: customer.address,
    },
    deliveryMethod: method.value,
    deliveryZone: zoneId.value,
    consent: {
      usage: consent.usage,
      marketing: consent.marketing,
      policyVersion: POLICY_VERSION,
    },
  };
  if (cart.lines.value.length > 0) body.lines = cart.lines.value.map((l: CartLine) => ({ ...l }));
  if (cart.boxLines.value.length > 0)
    body.boxLines = cart.boxLines.value.map((b: CartBoxLine) => ({ ...b }));
  const code = couponCode.value.trim();
  if (code) body.couponCode = code;
  // redeemPoints is intentionally never sent — guest checkout is points-free (T-04-31).
  return body;
}

// ── Wizard navigation ──────────────────────────────────────────────────────────────
const STEP_LABELS = ["ตะกร้า", "จัดส่ง & ผู้รับ", "สรุป"];
const step = ref(1);
function goStep1to2(): void {
  if (cartEmpty.value) return;
  step.value = 2;
  void loadQuote();
}
function goStep2to3(): void {
  if (!canAdvanceStep2.value || !validateStep2()) return;
  step.value = 3;
}
function back(): void {
  if (step.value > 1) step.value -= 1;
}

// ── Place order ─────────────────────────────────────────────────────────────────────
const placing = ref(false);
const submitError = ref("");
const orderId = ref("");

async function confirm(): Promise<void> {
  if (placing.value || !method.value) return;
  placing.value = true;
  submitError.value = "";
  try {
    const { data, error } = await (
      api.orders.post as unknown as (
        b: unknown,
      ) => Promise<{ data: { id: string } | null; error: { value?: { error?: string } } | null }>
    )(buildOrderBody());
    if (error || !data?.id) {
      // Surface a coupon/stock rejection inline (the field carried an invalid coupon,
      // or a line sold out) — never a money error, the server owns the price.
      const code = error?.value?.error;
      submitError.value =
        code === "coupon_invalid" || code === "coupon_not_found"
          ? "โค้ดคูปองไม่ถูกต้องหรือหมดอายุ โปรดตรวจสอบแล้วลองใหม่"
          : "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      placing.value = false;
      return;
    }
    orderId.value = data.id;
    cart.clear();
    step.value = 4;
    await loadQr();
  } catch {
    submitError.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
  } finally {
    placing.value = false;
  }
}

// ── Pay step: idempotent QR + hold countdown + slip upload ──────────────────────────
interface QrData {
  id: string;
  status: string;
  qr: string;
  totalSatang: number;
  holdSecondsRemaining: number | null;
}
type PayView = "pay" | "paid" | "review" | "expired" | "error";
const payView = ref<PayView>("pay");
const qr = ref<QrData | null>(null);
const secondsLeft = ref<number | null>(null);
const uploading = ref(false);
const hasUploaded = ref(false);
const rejectReason = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
let statusPoll: ReturnType<typeof setInterval> | null = null;

const amountBaht = computed(() => (qr.value ? baht(qr.value.totalSatang) : 0));
const countdownLabel = computed(() => {
  const s = secondsLeft.value;
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
});
const REJECT_COPY: Record<string, string> = {
  wrong_amount: "ยอดในสลิปไม่ตรงกับคำสั่งซื้อ — โปรดโอนยอดที่ถูกต้องแล้วอัปโหลดสลิปใหม่",
  wrong_payee: "สลิปนี้ไม่ได้โอนเข้าบัญชีร้าน — โปรดสแกน QR ของร้านแล้วโอนใหม่",
  duplicate: "สลิปนี้ถูกใช้ไปแล้ว — หนึ่งสลิปใช้ได้กับหนึ่งคำสั่งซื้อเท่านั้น",
  other: "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง",
};
const rejectCopy = computed(() => (rejectReason.value ? REJECT_COPY[rejectReason.value] : ""));

async function loadQr(): Promise<void> {
  if (!orderId.value) return;
  try {
    const { data, error } = await (
      api.orders as unknown as (p: { id: string }) => {
        qr: { get: () => Promise<{ data: QrData | null; error: unknown }> };
      }
    )({ id: orderId.value }).qr.get();
    if (error || !data) {
      payView.value = "error";
      return;
    }
    qr.value = data;
    secondsLeft.value = data.holdSecondsRemaining;
    if (data.status === "paid") payView.value = "paid";
    else if (data.status === "cancelled") payView.value = "expired";
    else if (data.holdSecondsRemaining !== null && data.holdSecondsRemaining <= 0)
      payView.value = "expired";
    else {
      payView.value = "pay";
      startTimers();
    }
  } catch {
    payView.value = "error";
  }
}

function startTimers(): void {
  stopTimers();
  statusPoll = setInterval(() => void pollStatus(), 4000);
  if (secondsLeft.value !== null) {
    timer = setInterval(() => {
      if (secondsLeft.value === null) return;
      secondsLeft.value = Math.max(0, secondsLeft.value - 1);
      if (secondsLeft.value === 0 && payView.value === "pay") payView.value = "expired";
    }, 1000);
  }
}
function stopTimers(): void {
  if (timer) clearInterval(timer);
  if (statusPoll) clearInterval(statusPoll);
  timer = null;
  statusPoll = null;
}
async function pollStatus(): Promise<void> {
  if (!orderId.value) return;
  try {
    const { data } = await (
      api.orders as unknown as (p: { id: string }) => {
        qr: { get: () => Promise<{ data: QrData | null; error: unknown }> };
      }
    )({ id: orderId.value }).qr.get();
    const s = data?.status;
    if (s === "paid" || s === "cancelled") {
      uploading.value = false;
      payView.value = s === "paid" ? "paid" : "expired";
      stopTimers();
    }
  } catch {
    // Transient — keep polling.
  }
}

// Slip upload → POST /orders/:id/slip (multipart), mapped to a normalized outcome.
const fileInput = ref<HTMLInputElement | null>(null);
function pickSlip(): void {
  fileInput.value?.click();
}
async function onSlipChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  rejectReason.value = null;
  try {
    const res = await (
      api.orders as unknown as (p: { id: string }) => {
        slip: {
          post: (b: { slip: File }) => Promise<{
            data: { status?: string } | null;
            error: { value?: { error?: string } } | null;
          }>;
        };
      }
    )({ id: orderId.value }).slip.post({ slip: file });
    hasUploaded.value = true;
    if (res.data?.status === "paid") {
      payView.value = "paid";
      stopTimers();
    } else if (res.data?.status === "awaiting_review") {
      payView.value = "review";
    } else {
      const code = res.error?.value?.error ?? "other";
      rejectReason.value =
        code === "duplicate" || code === "duplicate_slip"
          ? "duplicate"
          : code === "wrong_amount"
            ? "wrong_amount"
            : code === "wrong_payee"
              ? "wrong_payee"
              : "other";
    }
  } catch {
    rejectReason.value = "other";
  } finally {
    uploading.value = false;
    input.value = ""; // allow re-picking the same file (replace flow)
  }
}

onUnmounted(stopTimers);
onMounted(async () => {
  try {
    const { data, error } = await (
      api.catalog.get as unknown as () => Promise<{ data: CatalogData | null; error: unknown }>
    )();
    if (!error && data) catalog.value = data;
  } catch {
    // A missing catalog only degrades DISPLAY names/prices — checkout still posts ids.
  }
});
</script>

<template>
  <div class="store-max px-md py-lg">
    <!-- Wizard step indicator (steps 1–3; the pay step is terminal) -->
    <ol v-if="step <= 3" class="mb-lg flex items-center gap-sm text-[14px]">
      <li
        v-for="(label, i) in STEP_LABELS"
        :key="label"
        class="flex items-center gap-sm"
        :class="step === i + 1 ? 'font-semibold text-ink' : 'text-muted'"
      >
        <span>{{ i + 1 }}. {{ label }}</span>
        <span v-if="i < STEP_LABELS.length - 1" class="text-muted">›</span>
      </li>
    </ol>

    <!-- ── STEP 1 — review cart ──────────────────────────────────────────────── -->
    <section v-if="step === 1" class="flex flex-col gap-md">
      <h1 class="text-[28px] font-semibold leading-[1.25] text-ink">ตะกร้าของคุณ</h1>

      <EmptyState
        v-if="cartEmpty"
        heading="ยังไม่ได้เลือกผัก"
        body="เลือกผักสลัดที่อยากได้ แล้วมาต่อที่นี่"
      >
        <NuxtLink
          to="/"
          class="flex min-h-[48px] items-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-canvas"
          >เลือกผักรอบนี้</NuxtLink
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
          class="mt-sm flex h-[48px] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-canvas disabled:opacity-40"
          :disabled="cartEmpty"
          @click="goStep1to2"
        >
          ถัดไป
        </button>
      </template>
    </section>

    <!-- ── STEP 2 — delivery + address + consent + discount ──────────────────── -->
    <section v-else-if="step === 2" class="flex max-w-[42rem] flex-col gap-lg">
      <h1 class="text-[28px] font-semibold leading-[1.25] text-ink">จัดส่ง & ผู้รับ</h1>

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

      <div class="flex flex-col gap-sm">
        <p class="text-[14px] font-semibold text-ink">วิธีจัดส่ง</p>
        <p v-if="quoteError" class="text-[14px] text-destructive" role="alert">
          เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง
        </p>
        <div v-else-if="quote" class="grid grid-cols-1 gap-sm sm:grid-cols-2">
          <button
            v-for="m in DELIVERY_METHODS.filter((x) => quote!.allowedMethods.includes(x))"
            :key="m"
            type="button"
            class="flex min-h-[48px] items-center justify-between rounded-lg border p-md text-[16px] text-ink"
            :class="method === m ? 'border-accent ring-2 ring-accent' : 'border-hairline'"
            @click="method = m"
          >
            <span>{{ METHOD_LABEL[m] }}</span>
            <span class="font-semibold">
              <span v-if="quote.fees[m] === 0" class="text-accent">ส่งฟรี</span>
              <span v-else>฿{{ baht(quote.fees[m] ?? 0) }}</span>
            </span>
          </button>
        </div>
        <p class="text-[14px] text-muted">ส่งฟรีเมื่อซื้อครบ ฿500 (เฉพาะส่งเอง/ขนส่งทั่วไป)</p>
        <p v-if="quote?.deliveryDate" class="text-[14px] text-muted">
          กำหนดจัดส่ง: {{ quote.deliveryDate }}
        </p>
        <p v-if="fieldErrors.method" class="text-[14px] text-destructive">{{ fieldErrors.method }}</p>
      </div>

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
          <p v-if="fieldErrors.phone" class="text-[14px] text-destructive">{{ fieldErrors.phone }}</p>
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

      <!-- Coupon + points fields (D-14). Coupon works for a guest; points shows the
           log-in hint (member-only). Both send CODE/COUNT only — server resolves money. -->
      <div class="flex flex-col gap-md border-t border-hairline pt-md">
        <CouponField v-model="couponCode" :auto-apply="Boolean(arrivalCode)" />
        <PointsRedeem v-model="redeemPoints" :is-member="isMember" />
      </div>

      <!-- PDPA consent (D-25/26) — usage required to advance. -->
      <div class="flex flex-col gap-sm border-t border-hairline pt-md">
        <label class="flex cursor-pointer items-start gap-sm">
          <input
            type="checkbox"
            v-model="consent.usage"
            class="mt-xs h-[20px] w-[20px] shrink-0 accent-accent"
          />
          <span class="text-[14px] leading-[1.5] text-ink">
            ยินยอมให้ร้านใช้ข้อมูลเพื่อจัดส่งและดำเนินการคำสั่งซื้อ (จำเป็น)
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-sm">
          <input
            type="checkbox"
            v-model="consent.marketing"
            class="mt-xs h-[20px] w-[20px] shrink-0 accent-accent"
          />
          <span class="text-[14px] leading-[1.5] text-muted">
            ยินยอมรับข่าวสารและโปรโมชัน (ไม่บังคับ)
          </span>
        </label>
      </div>

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
          class="flex h-[48px] flex-[2] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-canvas disabled:opacity-40"
          :disabled="!canAdvanceStep2"
          @click="goStep2to3"
        >
          ถัดไป
        </button>
      </div>
    </section>

    <!-- ── STEP 3 — summary + place order ────────────────────────────────────── -->
    <section v-else-if="step === 3" class="flex max-w-[42rem] flex-col gap-lg">
      <h1 class="text-[28px] font-semibold leading-[1.25] text-ink">สรุปคำสั่งซื้อ</h1>

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
        <div v-if="couponCode.trim()" class="flex items-center justify-between text-muted">
          <span>คูปอง {{ couponCode.trim() }}</span>
          <span class="text-[14px]">ระบบจะคำนวณส่วนลดตอนชำระเงิน</span>
        </div>
        <div class="flex items-center justify-between text-[20px] font-semibold text-ink">
          <span>ยอดชำระ (ก่อนส่วนลด)</span><span>฿{{ baht(totalSatang) }}</span>
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
          class="flex h-[48px] flex-[2] items-center justify-center rounded-lg bg-accent text-[16px] font-semibold text-canvas disabled:opacity-40"
          :disabled="placing"
          @click="confirm"
        >
          ยืนยันและชำระเงิน
        </button>
      </div>
    </section>

    <!-- ── STEP 4 — pay (QR + countdown + slip upload) ───────────────────────── -->
    <section v-else class="flex flex-col items-center gap-lg py-lg">
      <!-- ERROR -->
      <div v-if="payView === 'error'" class="py-2xl text-center" role="alert">
        <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
      </div>

      <!-- PAID -->
      <div v-else-if="payView === 'paid'" class="flex flex-col items-center gap-md py-3xl text-center">
        <span
          class="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-[32px] text-canvas"
          aria-hidden="true"
          >✓</span
        >
        <h1 class="text-[28px] font-semibold leading-[1.3] text-ink">ชำระเงินสำเร็จ</h1>
        <p class="text-[16px] text-muted">
          ขอบคุณค่ะ ร้านได้รับการชำระเงินแล้ว — จะจัดส่งผักสดให้เร็วที่สุด
        </p>
        <NuxtLink
          to="/"
          class="mt-sm flex min-h-[44px] items-center rounded-lg border border-hairline px-lg text-[16px] text-ink"
          >กลับไปเลือกผักต่อ</NuxtLink
        >
      </div>

      <!-- AWAITING REVIEW -->
      <div v-else-if="payView === 'review'" class="flex flex-col items-center gap-md py-3xl text-center">
        <div class="rounded-lg bg-warning-surface px-md py-md text-warning" role="status">
          <p class="text-[16px] leading-[1.6]">
            เราได้รับสลิปแล้ว กำลังตรวจสอบ จะแจ้งผลเมื่อยืนยันการชำระเงิน
          </p>
        </div>
      </div>

      <!-- EXPIRED / CANCELLED -->
      <div v-else-if="payView === 'expired'" class="flex flex-col items-center gap-md py-3xl text-center">
        <h1 class="text-[20px] font-semibold leading-[1.35] text-ink">หมดเวลาชำระเงิน</h1>
        <p class="max-w-[32ch] text-[16px] leading-[1.6] text-muted">
          คำสั่งซื้อนี้หมดเวลาชำระเงินและถูกยกเลิกแล้ว ผักถูกคืนสู่รอบ — สั่งใหม่ได้ทันทีหากยังต้องการ
        </p>
        <NuxtLink
          to="/"
          class="mt-sm flex min-h-[48px] items-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-canvas"
          >สั่งผักรอบนี้</NuxtLink
        >
      </div>

      <!-- PAY -->
      <div v-else class="flex w-full max-w-[28rem] flex-col items-center gap-lg">
        <h1 class="text-[28px] font-semibold leading-[1.3] text-ink">ชำระเงิน</h1>
        <img
          v-if="qr"
          :src="qr.qr"
          alt="PromptPay QR"
          class="h-56 w-56 rounded-lg border border-hairline bg-canvas"
        />
        <p class="max-w-[34ch] text-center text-[16px] leading-[1.6] text-ink">
          สแกน QR นี้ด้วยแอปธนาคารเพื่อโอน ฿{{ amountBaht }} แล้วอัปโหลดสลิป
        </p>
        <p v-if="secondsLeft !== null" class="text-[14px] text-muted">
          เหลือเวลาชำระเงิน <span class="font-semibold text-ink">{{ countdownLabel }}</span>
        </p>

        <p v-if="uploading" class="text-[14px] text-muted" role="status">
          กำลังอัปโหลดและตรวจสอบสลิป…
        </p>
        <p
          v-else-if="rejectReason"
          class="rounded-lg px-md py-sm text-center text-[14px] leading-[1.5] text-destructive"
          style="background-color: color-mix(in srgb, var(--color-destructive) 10%, transparent)"
          role="alert"
        >
          {{ rejectCopy }}
        </p>

        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onSlipChange"
        />
        <button
          type="button"
          class="flex min-h-[48px] w-full items-center justify-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-canvas disabled:opacity-40"
          :disabled="uploading"
          @click="pickSlip"
        >
          {{ hasUploaded ? "อัปโหลดสลิปใหม่" : "อัปโหลดสลิปการโอน" }}
        </button>
      </div>
    </section>
  </div>
</template>
