<script setup lang="ts">
// ชำระเงิน — the PromptPay pay screen (02-08 / LINE-02 · PAY-01 · PAY-03). Route "/pay/:id".
// Fetches GET /orders/:id/qr (02-04 — idempotent, never re-arms the hold timer, D-11),
// renders the QR + a live hold countdown + the SlipUploader (POST /orders/:id/slip, 02-06),
// and reflects EVERY payment state from the UI-SPEC:
//   • QR shown + countdown + not-yet-uploaded  (awaiting_payment)
//   • uploading / verifying                     (slip POST in flight)
//   • verified/paid                             (accent ✓ success)
//   • rejected — per reason                     (wrong amount / wrong payee / duplicate)
//   • awaiting-review (D-04, amber)             (verifier down → admin will confirm)
//   • hold-expired / cancelled (D-09)           (timer hit 0 or order cancelled)
//
// The screen awaits the QR fetch in setup, so the loading state is the App.vue <Suspense>
// fallback (02-02 shell). `loader`/`canceler` are injectable for testability.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import SlipUploader, { type SlipResult } from "../components/SlipUploader.vue";
import { baht } from "../lib/checkout";
import { getSessionToken } from "../liff";

interface QrData {
  id: string;
  status: string;
  qr: string;
  totalSatang: number;
  holdSecondsRemaining: number | null;
}
interface Loaded<T> {
  data: T | null;
  error: unknown;
}

const props = defineProps<{
  loader?: (id: string) => Promise<Loaded<QrData>>;
  canceler?: (id: string) => Promise<Loaded<unknown>>;
}>();

const route = useRoute();
const orderId = String(route.params.id ?? "");

const qrLoad =
  props.loader ??
  ((id: string) =>
    (
      api.orders as unknown as (p: { id: string }) => { qr: { get: () => Promise<Loaded<QrData>> } }
    )({
      id,
    }).qr.get());
// WR-01: cancel via the member-scoped POST /me/orders/:id/cancel with the LINE
// session Bearer token — NOT the staff-only PATCH /orders/:id/status, which a
// customer could never authorise (it always 401'd and failed silently). onlyIfHold
// on the server means only an unpaid held order is actually cancelled + released.
const cancelOrder =
  props.canceler ??
  ((id: string) => {
    const token = getSessionToken();
    return (
      api.me.orders as unknown as (p: { id: string }) => {
        cancel: {
          post: (
            b: undefined,
            o: { headers: Record<string, string> },
          ) => Promise<Loaded<unknown>>;
        };
      }
    )({ id }).cancel.post(undefined, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  });

// ── Initial fetch (idempotent QR) ─────────────────────────────────────────────
const res = await qrLoad(orderId).catch(
  () => ({ data: null, error: { network: true } }) as Loaded<QrData>,
);
const qr = res.data;

// ── View state machine ────────────────────────────────────────────────────────
type View = "pay" | "paid" | "review" | "expired" | "error";
function initialView(): View {
  if (!qr || res.error) return "error";
  if (qr.status === "paid") return "paid";
  if (qr.status === "cancelled") return "expired";
  if (qr.holdSecondsRemaining !== null && qr.holdSecondsRemaining <= 0) return "expired";
  return "pay";
}
const view = ref<View>(initialView());

// Slip flow within the "pay" view.
const uploading = ref(false);
const rejectReason = ref<SlipResult["reason"] | null>(null);
const hasUploaded = ref(false);

// Hold countdown.
const secondsLeft = ref<number | null>(qr?.holdSecondsRemaining ?? null);
let timer: ReturnType<typeof setInterval> | null = null;

const amountBaht = computed(() => (qr ? baht(qr.totalSatang) : 0));
const countdownLabel = computed(() => {
  const s = secondsLeft.value;
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
});

// Per-reason rejection copy (UI-SPEC Error states).
const REJECT_COPY: Record<NonNullable<SlipResult["reason"]>, string> = {
  wrong_amount: `ยอดในสลิปไม่ตรงกับคำสั่งซื้อ (ต้องโอน ฿${amountBaht.value} พอดี) — โปรดโอนยอดที่ถูกต้องแล้วอัปโหลดสลิปใหม่`,
  wrong_payee: "สลิปนี้ไม่ได้โอนเข้าบัญชีร้าน — โปรดสแกน QR ของร้านแล้วโอนใหม่",
  duplicate: "สลิปนี้ถูกใช้ไปแล้ว — หนึ่งสลิปใช้ได้กับหนึ่งคำสั่งซื้อเท่านั้น โปรดแนบสลิปการโอนจริงของออเดอร์นี้",
  other: "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง",
};
const rejectCopy = computed(() => (rejectReason.value ? REJECT_COPY[rejectReason.value] : ""));

function onUploading(): void {
  uploading.value = true;
  rejectReason.value = null;
}
function onResult(result: SlipResult): void {
  uploading.value = false;
  hasUploaded.value = true;
  if (result.status === "paid") view.value = "paid";
  else if (result.status === "review") view.value = "review";
  else rejectReason.value = result.reason ?? "other"; // stay in "pay" → allow re-upload
}

// ── Cancel order (destructive) ──────────────────────────────────────────────
const showCancelConfirm = ref(false);
const cancelling = ref(false);
async function doCancel(): Promise<void> {
  cancelling.value = true;
  const r = await cancelOrder(orderId).catch(
    () => ({ data: null, error: true }) as Loaded<unknown>,
  );
  cancelling.value = false;
  showCancelConfirm.value = false;
  if (!r.error) view.value = "expired";
}

// ── Countdown ticker (client only) ─────────────────────────────────────────────
onMounted(() => {
  if (secondsLeft.value === null) return;
  timer = setInterval(() => {
    if (secondsLeft.value === null) return;
    secondsLeft.value = Math.max(0, secondsLeft.value - 1);
    if (secondsLeft.value === 0 && view.value === "pay") view.value = "expired";
  }, 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="flex flex-col items-center gap-lg p-md pb-2xl">
    <!-- ── ERROR ────────────────────────────────────────────────────────────── -->
    <div v-if="view === 'error'" class="flex flex-col items-center gap-md py-2xl text-center" role="alert">
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <!-- ── PAID (success) ───────────────────────────────────────────────────── -->
    <div v-else-if="view === 'paid'" class="flex flex-col items-center gap-md py-3xl text-center">
      <span
        class="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-[32px] text-white"
        aria-hidden="true"
        >✓</span
      >
      <h1 class="text-[28px] font-semibold leading-[1.3] text-ink">ชำระเงินสำเร็จ</h1>
      <p class="text-[16px] text-muted">ขอบคุณค่ะ ร้านได้รับการชำระเงินแล้ว — จะจัดส่งผักสดให้เร็วที่สุด</p>
      <RouterLink
        :to="`/orders/${orderId}`"
        class="mt-sm flex min-h-[44px] items-center rounded-lg border border-hairline px-lg text-[16px] text-ink"
        >ดูรายละเอียดคำสั่งซื้อ</RouterLink
      >
    </div>

    <!-- ── AWAITING REVIEW (D-04, amber) ────────────────────────────────────── -->
    <div v-else-if="view === 'review'" class="flex flex-col items-center gap-md py-3xl text-center">
      <div class="rounded-lg bg-warning-surface px-md py-md text-warning" role="status">
        <p class="text-[16px] leading-[1.6]">
          เราได้รับสลิปแล้ว กำลังตรวจสอบโดยแอดมิน จะแจ้งผลทาง LINE เมื่อยืนยันการชำระเงิน
        </p>
      </div>
    </div>

    <!-- ── HOLD EXPIRED / CANCELLED (D-09) ──────────────────────────────────── -->
    <div v-else-if="view === 'expired'" class="flex flex-col items-center gap-md py-3xl text-center">
      <h1 class="text-[20px] font-semibold leading-[1.35] text-ink">หมดเวลาชำระเงิน</h1>
      <p class="max-w-[32ch] text-[16px] leading-[1.6] text-muted">
        คำสั่งซื้อนี้หมดเวลาชำระเงินและถูกยกเลิกแล้ว ผักถูกคืนสู่รอบ — สั่งใหม่ได้ทันทีหากยังต้องการ
      </p>
      <RouterLink
        to="/"
        class="mt-sm flex min-h-[48px] items-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-white"
        >สั่งผักรอบนี้</RouterLink
      >
    </div>

    <!-- ── PAY (QR + countdown + slip uploader) ─────────────────────────────── -->
    <div v-else class="flex w-full flex-col items-center gap-lg">
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

      <!-- Uploading / verifying transient -->
      <p v-if="uploading" class="text-[14px] text-muted" role="status">
        กำลังอัปโหลดและตรวจสอบสลิป…
      </p>

      <!-- Rejected — per-reason copy (D-02/03/06) -->
      <p
        v-else-if="rejectReason"
        class="rounded-lg px-md py-sm text-center text-[14px] leading-[1.5] text-destructive"
        style="background-color: color-mix(in srgb, var(--color-destructive) 10%, transparent)"
        role="alert"
      >
        {{ rejectCopy }}
      </p>

      <SlipUploader
        v-if="!uploading"
        class="w-full"
        :order-id="orderId"
        :label="hasUploaded ? 'อัปโหลดสลิปใหม่' : 'อัปโหลดสลิปการโอน'"
        @uploading="onUploading"
        @result="onResult"
      />

      <!-- Cancel order (destructive) -->
      <button
        type="button"
        class="min-h-[44px] text-[14px] text-destructive underline"
        @click="showCancelConfirm = true"
      >
        ยกเลิกคำสั่งซื้อ
      </button>
    </div>

    <!-- ── Destructive cancel confirm (bottom sheet) ────────────────────────── -->
    <div
      v-if="showCancelConfirm"
      class="fixed inset-0 z-10 flex items-end justify-center bg-black/40 p-md"
      role="dialog"
      aria-modal="true"
    >
      <div class="w-full max-w-[28rem] rounded-xl bg-canvas p-lg">
        <h2 class="text-[20px] font-semibold text-ink">ยกเลิกคำสั่งซื้อ</h2>
        <p class="mt-sm text-[16px] leading-[1.6] text-muted">
          ยกเลิกออเดอร์นี้ใช่ไหม? ผักที่จองไว้จะถูกคืนสู่รอบ
        </p>
        <div class="mt-lg flex gap-md">
          <button
            type="button"
            class="flex h-[48px] flex-1 items-center justify-center rounded-lg border border-hairline text-[16px] text-ink"
            @click="showCancelConfirm = false"
          >
            ไม่ใช่
          </button>
          <button
            type="button"
            class="flex h-[48px] flex-1 items-center justify-center rounded-lg bg-destructive text-[16px] font-semibold text-white disabled:opacity-40"
            :disabled="cancelling"
            @click="doCancel"
          >
            ยืนยันยกเลิก
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
