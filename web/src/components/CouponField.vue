<script setup lang="ts">
// Coupon-code entry at LIFF checkout (04-10 / D-14, MKT-01). SECURITY: this NEVER
// computes or trusts a discount — it captures a CODE only. POST /orders resolves the
// discount server-side and drives the PromptPay QR (04-03, T-04-07). "Applied" here
// is an optimistic UI state (the code will be sent); the real reduction shows on the
// pay screen. Mirrors the web-store CouponField copy + accent rules (UI-SPEC).
import { ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  // A segment code carried in the LIFF launch link auto-applies on mount (D-14).
  autoApply?: boolean;
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const draft = ref(props.modelValue ?? "");
const applied = ref<string>("");

function apply(): void {
  const code = draft.value.trim();
  if (!code) return;
  applied.value = code;
  emit("update:modelValue", code);
}

function remove(): void {
  applied.value = "";
  draft.value = "";
  emit("update:modelValue", "");
}

// Auto-apply a launch-link segment code once (D-14): prefill + apply on mount.
watch(
  () => [props.modelValue, props.autoApply] as const,
  ([value, auto]) => {
    if (auto && value && !applied.value) {
      draft.value = value;
      applied.value = value;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-sm">
    <label class="text-[14px] font-semibold text-ink" for="coupon">โค้ดส่วนลด</label>

    <!-- Applied state — optimistic; the server resolves the actual discount at pay. -->
    <div
      v-if="applied"
      class="flex items-center justify-between gap-md rounded-lg bg-surface p-md"
    >
      <p class="min-w-0 flex-1 text-[14px] text-ink">
        ใช้คูปอง <span class="font-semibold">{{ applied }}</span> แล้ว —
        ระบบจะคำนวณส่วนลดตอนชำระเงิน
      </p>
      <button
        type="button"
        class="shrink-0 text-[14px] text-muted underline"
        @click="remove"
      >
        นำออก
      </button>
    </div>

    <!-- Entry state — input + accent apply confirm (UI-SPEC accent reserved). -->
    <div v-else class="flex gap-sm">
      <input
        id="coupon"
        v-model="draft"
        type="text"
        autocomplete="off"
        placeholder="กรอกโค้ดคูปอง"
        class="min-h-[44px] flex-1 rounded-lg border border-hairline bg-canvas px-md text-[16px] text-ink"
        @keyup.enter="apply"
      />
      <button
        type="button"
        class="flex min-h-[44px] items-center rounded-lg bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-40"
        :disabled="!draft.trim()"
        @click="apply"
      >
        ใช้คูปอง
      </button>
    </div>
  </div>
</template>
