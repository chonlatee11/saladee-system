<script setup lang="ts">
// Full-screen busy overlay. While an action is in flight it dims the app and
// CAPTURES all pointer/touch input (fixed inset-0), so no other control can be
// tapped until the action resolves — preventing double-submits and mid-request
// navigation. Shown via `show`; renders nothing when false. Fixed to the LIFF
// viewport and above every in-page layer (z-50 > the pay-screen modal's z-10).
import Spinner from "./Spinner.vue";

defineProps<{ show: boolean; label?: string }>();
</script>

<template>
  <transition name="s2-fade">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-md bg-canvas/70 backdrop-blur-sm"
      role="alert"
      aria-busy="true"
      aria-live="assertive"
      @click.stop
      @touchstart.stop
    >
      <Spinner size="lg" />
      <p v-if="label" class="text-[15px] font-semibold text-ink">{{ label }}</p>
    </div>
  </transition>
</template>

<style scoped>
.s2-fade-enter-active,
.s2-fade-leave-active {
  transition: opacity 0.15s ease;
}
.s2-fade-enter-from,
.s2-fade-leave-to {
  opacity: 0;
}
</style>
