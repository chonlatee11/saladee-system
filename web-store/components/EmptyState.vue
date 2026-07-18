<script setup lang="ts">
// Reusable empty/zero-data state — copied VERBATIM from web/src/components/EmptyState.vue
// (02-05 / UI-SPEC empty states, one brand N apps). Heading + optional body, an
// optional action in the default slot. Text-only, no accent — accent is reserved for
// a primary CTA a consuming screen may drop into the slot.
defineProps<{ heading: string; body?: string }>();
</script>

<template>
  <section
    class="flex min-h-[60dvh] flex-col items-center justify-center gap-md px-md py-2xl text-center"
  >
    <h2 class="text-[20px] font-semibold leading-[1.35] text-ink">{{ heading }}</h2>
    <p v-if="body" class="max-w-[30ch] text-[16px] leading-[1.6] text-muted">{{ body }}</p>
    <slot />
  </section>
</template>
