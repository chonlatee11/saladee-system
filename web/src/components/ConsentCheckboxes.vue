<script setup lang="ts">
// PDPA consent rows (02-08 / UI-SPEC PDPA consent copy, D-25/26). Captured at
// checkout BEFORE name/address/phone are submitted (PLAT-04). Two INDEPENDENT
// consents:
//   • usage    — REQUIRED. The wizard gates its "ถัดไป" CTA disabled until this is
//                ticked (D-25); the server also rejects usage=false (T-02-31).
//   • marketing — OPTIONAL, default UNCHECKED (D-26).
// The tick-fill uses the accent color (UI-SPEC accent reserved item 5). Each row is a
// full 44px touch target (NFR-07). The policy link opens the privacy policy.
import type { CheckoutConsent } from "../lib/checkout";

const props = defineProps<{ modelValue: CheckoutConsent }>();
const emit = defineEmits<{ (e: "update:modelValue", value: CheckoutConsent): void }>();

function toggle(key: keyof CheckoutConsent): void {
  emit("update:modelValue", { ...props.modelValue, [key]: !props.modelValue[key] });
}
</script>

<template>
  <fieldset class="flex flex-col gap-sm">
    <legend class="sr-only">ความยินยอมตาม PDPA</legend>

    <!-- Usage consent — required to proceed (D-25) -->
    <label class="flex min-h-[44px] cursor-pointer items-start gap-sm py-sm">
      <input
        type="checkbox"
        class="mt-xs h-[20px] w-[20px] shrink-0 accent-accent"
        :checked="modelValue.usage"
        @change="toggle('usage')"
      />
      <span class="text-[14px] leading-[1.5] text-ink">
        ฉันยินยอมให้ร้านเก็บและใช้ข้อมูลเพื่อดำเนินการคำสั่งซื้อและจัดส่ง
        (<a href="/privacy" target="_blank" rel="noopener" class="text-accent underline"
          >นโยบายความเป็นส่วนตัว</a
        >)
      </span>
    </label>

    <!-- Marketing consent — optional, default unchecked (D-26) -->
    <label class="flex min-h-[44px] cursor-pointer items-start gap-sm py-sm">
      <input
        type="checkbox"
        class="mt-xs h-[20px] w-[20px] shrink-0 accent-accent"
        :checked="modelValue.marketing"
        @change="toggle('marketing')"
      />
      <span class="text-[14px] leading-[1.5] text-muted">
        ฉันยินยอมรับข่าวสาร โปรโมชัน และรอบผักใหม่ผ่าน LINE (ไม่บังคับ)
      </span>
    </label>
  </fieldset>
</template>
