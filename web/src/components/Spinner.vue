<script setup lang="ts">
// Accessible CSS-only spinner (no deps, NFR-08). A ring in the accent color that
// spins; under prefers-reduced-motion it degrades to a gentle opacity pulse so it
// never induces motion sickness. Size via the `size` prop (sm/md/lg).
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "md" });
const PX = { sm: 20, md: 32, lg: 44 } as const;
</script>

<template>
  <span
    class="s2-spinner inline-block shrink-0 rounded-full border-hairline border-t-accent"
    :style="{
      width: `${PX[size]}px`,
      height: `${PX[size]}px`,
      borderWidth: size === 'sm' ? '2px' : '3px',
    }"
    role="status"
    aria-label="กำลังโหลด"
  />
</template>

<style scoped>
.s2-spinner {
  animation: s2-spin 0.7s linear infinite;
}
@keyframes s2-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .s2-spinner {
    animation: s2-pulse 1.2s ease-in-out infinite;
  }
  @keyframes s2-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
}
</style>
