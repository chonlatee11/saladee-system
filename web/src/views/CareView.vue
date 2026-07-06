<script setup lang="ts">
// ความรู้เรื่องผัก — the care/knowledge screen (02-05, route "/care"). Entered from the
// Rich Menu "ความรู้เรื่องผัก" deep link. Lists the current round's varieties with their
// care tips (storageTips / washingTips, D-24) read from the public /catalog. Only
// varieties that actually have care content are listed. Care copy is rendered via Vue
// text interpolation (auto-escaped) — never v-html — so server text is XSS-safe (T-02-18).
//
// Loading is owned by the App.vue <Suspense> fallback (async-view shell pattern); this
// screen owns the content, empty, and error states. A `loader` prop is injectable for tests.
import { api } from "../api";
import EmptyState from "../components/EmptyState.vue";

interface Variety {
  id: string;
  name: string;
  storageTips: string | null;
  washingTips: string | null;
}
interface CatalogResult {
  data: { varieties: Variety[] } | null;
  error: unknown | null;
}

const props = defineProps<{ loader?: () => Promise<CatalogResult> }>();
const load = props.loader ?? (() => api.catalog.get() as unknown as Promise<CatalogResult>);

const res = await load().catch(() => ({ data: null, error: { network: true } }) as CatalogResult);
const errored = res.error != null;
// Only surface varieties that carry at least one care tip.
const varieties = (res.data?.varieties ?? []).filter((v) => v.storageTips || v.washingTips);
const isEmpty = !errored && varieties.length === 0;
</script>

<template>
  <section class="p-md">
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">ความรู้เรื่องผัก</h1>

    <div
      v-if="errored"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <EmptyState
      v-else-if="isEmpty"
      heading="ยังไม่มีเคล็ดลับผักในรอบนี้"
      body='ดูผักที่เปิดขายได้ที่เมนู "สั่งผักรอบนี้"'
    />

    <ul v-else class="flex flex-col gap-md">
      <li v-for="v in varieties" :key="v.id" class="rounded-xl bg-surface p-md">
        <h2 class="text-[20px] font-semibold leading-[1.35] text-ink">{{ v.name }}</h2>
        <div v-if="v.storageTips" class="mt-sm">
          <p class="text-[14px] font-semibold text-muted">วิธีเก็บรักษา</p>
          <p class="mt-xs text-[16px] leading-[1.6] text-ink">{{ v.storageTips }}</p>
        </div>
        <div v-if="v.washingTips" class="mt-sm">
          <p class="text-[14px] font-semibold text-muted">วิธีล้าง</p>
          <p class="mt-xs text-[16px] leading-[1.6] text-ink">{{ v.washingTips }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>
