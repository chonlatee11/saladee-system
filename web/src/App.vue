<script setup lang="ts">
// Root shell: a single router-view with a Suspense loading/error boundary so the
// lazily-imported screen chunks show a Thai loading state on first paint and a
// recoverable error state instead of a blank LIFF WebView (NFR-07).
import { onErrorCaptured, ref } from "vue";

const failed = ref(false);
onErrorCaptured(() => {
  failed.value = true;
  return false; // contain the error at the shell — don't crash the whole app
});
</script>

<template>
  <main class="mx-auto min-h-dvh w-full max-w-md">
    <div
      v-if="failed"
      class="flex min-h-dvh flex-col items-center justify-center gap-md p-md text-center"
    >
      <p class="text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
      <button
        type="button"
        class="min-h-[44px] rounded-lg border border-hairline px-md py-sm text-ink"
        @click="failed = false"
      >
        ลองใหม่
      </button>
    </div>
    <router-view v-else v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
        <template #fallback>
          <div class="flex min-h-dvh items-center justify-center p-md text-muted">
            กำลังโหลด…
          </div>
        </template>
      </Suspense>
    </router-view>
  </main>
</template>
