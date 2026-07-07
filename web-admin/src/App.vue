<script setup lang="ts">
// Root shell. Public routes (login) render bare; every authenticated route renders
// inside the AppShell (sidebar + toolbar). A Suspense boundary shows a Thai loading
// state for the lazily-imported view chunks and an onErrorCaptured boundary keeps a
// failed chunk from blanking the whole app.
import { computed, onErrorCaptured, ref } from "vue";
import { useRoute } from "vue-router";
import AppShell from "./components/AppShell.vue";
import type { AdminRouteMeta } from "./router";

const route = useRoute();
const isPublic = computed(() => Boolean((route.meta as AdminRouteMeta).public));

const failed = ref(false);
onErrorCaptured(() => {
  failed.value = true;
  return false; // contain the error at the shell
});
</script>

<template>
  <!-- Public (login): no chrome -->
  <router-view v-if="isPublic" />

  <!-- Authenticated: sidebar + toolbar chrome -->
  <AppShell v-else>
    <div
      v-if="failed"
      class="flex flex-col items-center justify-center gap-md p-3xl text-center"
    >
      <p class="text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
      <button
        type="button"
        class="rounded-md border border-hairline px-md py-sm text-ink hover:bg-surface"
        @click="failed = false"
      >
        ลองใหม่
      </button>
    </div>
    <router-view v-else v-slot="{ Component }">
      <Suspense>
        <component :is="Component" />
        <template #fallback>
          <div class="flex flex-col items-center justify-center gap-md p-3xl text-muted">
            <div class="h-6 w-6 animate-spin rounded-full border-2 border-hairline border-t-accent" />
            <p class="text-[14px]">กำลังโหลด…</p>
          </div>
        </template>
      </Suspense>
    </router-view>
  </AppShell>
</template>
