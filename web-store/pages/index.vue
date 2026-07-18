<script setup lang="ts">
// Public web-store catalog (04-08, ORD-05, D-05). SSR-fetches GET /catalog (the SAME
// public route the LIFF app reads — one round model, D-04) and renders a desktop-
// first hero + a multi-column grid that degrades to a single mobile column. Shows the
// "ยังไม่เปิดรอบขาย" empty state when no round is open. Money is DISPLAYED from server
// values (StoreVarietyCard); browse only — cart/checkout land in Plan 09.
import StoreVarietyCard, { type VarietyCardModel } from "~/components/StoreVarietyCard.vue";
import EmptyState from "~/components/EmptyState.vue";
import { useCart, type CartLine } from "~/stores/cart";

const SOLD_OUT_LABEL = "หมดรอบนี้"; // INV-08 sold-out copy (mirrors the api label)

interface CatalogPayload {
  varieties: VarietyCardModel[];
  boxes: unknown[];
}

const api = useApi();

// SSR data fetch — resolves on the server so the catalog HTML is crawlable (SEO).
const { data: catalog } = await useAsyncData<CatalogPayload>("catalog", async () => {
  const { data, error } = await api.catalog.get();
  if (error || !data) return { varieties: [], boxes: [] };
  return data as unknown as CatalogPayload;
});

const varieties = computed<VarietyCardModel[]>(() => catalog.value?.varieties ?? []);
const isEmpty = computed(() => varieties.value.length === 0);

// Page-level SEO (D-06): title + description + OG for the storefront landing.
useSeoMeta({
  title: "เลือกผักสลัดสดรอบนี้ | Saladee",
  description: "สั่งผักสลัดสดส่งตรงจากฟาร์ม รอบเก็บเกี่ยวปัจจุบัน จำนวนตรงกับผลผลิตจริง",
  ogTitle: "Saladee — ผักสลัดสดรอบนี้",
  ogDescription: "เลือกผักสลัดสดจากรอบเก็บเกี่ยวปัจจุบัน ส่งตรงจากฟาร์ม",
  ogType: "website",
});

// Cart wiring (04-09): add the emitted line (ids + qty only, T-04-29) to the shared
// cart store. The store persists to sessionStorage so /checkout sees the same lines.
const cart = useCart();
function onAdd(line: CartLine): void {
  cart.add(line);
}
</script>

<template>
  <div class="store-max px-md">
    <!-- Desktop hero (Display 28px, D-05). CTA scrolls to the catalog grid. -->
    <section class="flex flex-col items-start gap-md py-2xl md:py-3xl">
      <h1 class="text-[28px] font-semibold leading-[1.25] text-ink">
        เลือกผักสลัดสด ส่งตรงจากฟาร์ม
      </h1>
      <p class="max-w-[48ch] text-[16px] leading-[1.6] text-muted">
        รอบเก็บเกี่ยวปัจจุบัน — จำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ ไม่ขายเกิน ไม่เหลือทิ้ง
      </p>
      <a
        href="#catalog"
        class="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-canvas"
      >
        เลือกผักรอบนี้
      </a>
    </section>

    <!-- Catalog grid — multi-column on desktop, single column on mobile (D-05). -->
    <section id="catalog" class="pb-3xl">
      <EmptyState
        v-if="isEmpty"
        heading="ยังไม่เปิดรอบขาย"
        body="รอบถัดไปกำลังจะมา ฝากอีเมล/LINE ไว้เพื่อรับแจ้งเตือนได้"
      />
      <ul
        v-else
        class="grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3"
      >
        <li v-for="v in varieties" :key="v.id">
          <StoreVarietyCard :variety="v" :sold-out-label="SOLD_OUT_LABEL" @add="onAdd" />
        </li>
      </ul>
    </section>
  </div>
</template>
