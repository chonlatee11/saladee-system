<script setup lang="ts">
// Reusable quantity stepper (02-05). Neutral ink + border only — the accent color
// is reserved for the single primary CTA per screen (UI-SPEC Color), so a stepper
// never uses accent. Both hit targets are a full 44×44px (WCAG 2.5.5 / NFR-07)
// even though the glyph is small — the padding, not the glyph, defines the target.
const props = withDefaults(
  defineProps<{ modelValue: number; min?: number; max?: number }>(),
  { min: 0, max: 999 },
);
const emit = defineEmits<{ (e: "update:modelValue", value: number): void }>();

function dec(): void {
  if (props.modelValue > props.min) emit("update:modelValue", props.modelValue - 1);
}
function inc(): void {
  if (props.modelValue < props.max) emit("update:modelValue", props.modelValue + 1);
}
</script>

<template>
  <div class="inline-flex items-center gap-sm">
    <button
      type="button"
      aria-label="ลดจำนวน"
      class="flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-hairline text-[20px] text-ink disabled:opacity-40"
      :disabled="modelValue <= min"
      @click="dec"
    >
      −
    </button>
    <span class="min-w-[2ch] text-center text-[16px] font-semibold text-ink" aria-live="polite">
      {{ modelValue }}
    </span>
    <button
      type="button"
      aria-label="เพิ่มจำนวน"
      class="flex h-[44px] w-[44px] items-center justify-center rounded-lg border border-hairline text-[20px] text-ink disabled:opacity-40"
      :disabled="modelValue >= max"
      @click="inc"
    >
      +
    </button>
  </div>
</template>
