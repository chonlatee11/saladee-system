<script setup lang="ts">
// Accessible CSS-only spinner (no deps, NFR-08). A ring in the accent color that
// spins; under prefers-reduced-motion it degrades to a gentle opacity pulse so it
// never induces motion sickness. Size via the `size` prop (sm/md/lg).
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "md" });
const PX = { sm: 22, md: 34, lg: 52 } as const;
const STROKE = { sm: "3px", md: "4px", lg: "5px" } as const;
</script>

<template>
  <!-- Two-tone accent ring: a soft accent track with a bold accent sweep (top+right),
       thicker than a hairline ring so it reads clearly on the frosted overlay. -->
  <span
    class="s2-spinner inline-block shrink-0 rounded-full border-accent/20 border-t-accent border-r-accent"
    :style="{ width: `${PX[size]}px`, height: `${PX[size]}px`, borderWidth: STROKE[size] }"
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
