<script setup lang="ts">
// สั่งผักรอบนี้ — the catalog / round-browse screen (02-05, LINE-02). Entered from the
// Rich Menu "สั่งผักรอบนี้" deep link at "/". Lists the open round's varieties with
// their server-resolved ฿ price and adds packs to the shared cart store (consumed by
// the 02-08 checkout wizard). Money is only DISPLAYED from server values here.
//
// State inventory (UI-SPEC): this screen is async — it AWAITS its data in setup, so
// the *loading* state is owned by the App.vue <Suspense> fallback ("กำลังโหลด…") that
// wraps every route (the 02-02 shell pattern). Post-load this screen owns the rest:
//   • has-items      → the variety list (VarietyCard, per-item "หมดรอบนี้" sold-out badge)
//   • no-open-round  → the "รอบขายปิดชั่วคราว" empty state
//   • error          → "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง"
// A `loader` prop is injectable so the view test can mount it with a mocked catalog.
import { api } from "../api";
import { useCart, type CartLine } from "../stores/cart";
import VarietyCard, { type VarietyCardModel } from "../components/VarietyCard.vue";
import EmptyState from "../components/EmptyState.vue";

const SOLD_OUT_LABEL = "หมดรอบนี้"; // INV-08 sold-out copy (mirrors the api label)

interface CatalogResult {
  data: { varieties: VarietyCardModel[]; boxes: unknown[] } | null;
  error: unknown | null;
}

const props = defineProps<{ loader?: () => Promise<CatalogResult> }>();
const cart = useCart();
const load = props.loader ?? (() => api.catalog.get() as unknown as Promise<CatalogResult>);

// Async setup: the <Suspense> in App.vue shows the loading fallback until this
// resolves. A thrown/failed fetch is surfaced as the in-screen error state below.
const res = await load().catch(() => ({ data: null, error: { network: true } }) as CatalogResult);
const errored = res.error != null;
const varieties = (res.data?.varieties ?? []) as VarietyCardModel[];
const isEmpty = !errored && varieties.length === 0;

function onAdd(line: CartLine): void {
  cart.add(line);
}
</script>

<template>
  <section class="p-md">
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">สั่งผักรอบนี้</h1>

    <div
      v-if="errored"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <EmptyState
      v-else-if="isEmpty"
      heading="รอบขายปิดชั่วคราว"
      body='รอบถัดไปกำลังจะมา ติดตามได้ที่เมนู "ราคาวันนี้" หรือกดติดตามร้าน'
    />

    <ul v-else class="flex flex-col gap-md">
      <li v-for="v in varieties" :key="v.id">
        <VarietyCard :variety="v" :sold-out-label="SOLD_OUT_LABEL" @add="onAdd" />
      </li>
    </ul>
  </section>
</template>
