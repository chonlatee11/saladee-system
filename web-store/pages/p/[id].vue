<script setup lang="ts">
// SSR product page (04-08, D-06). Server-renders one variety from the SAME public
// GET /catalog payload (D-04 one round model, D-27/28 gallery), emits meta/OG tags
// and product JSON-LD (@nuxtjs/seo: useSeoMeta + useSchemaOrg/defineProduct) so the
// page is crawlable and rich-result eligible. 404s when the id is not in the open
// round. Add-to-cart intent is surfaced only (cart lands in Plan 09).
import StoreVarietyCard, { type VarietyCardModel } from "~/components/StoreVarietyCard.vue";
import { useCart, type CartLine } from "~/stores/cart";

interface CatalogPayload {
  varieties: VarietyCardModel[];
  boxes: unknown[];
}

const route = useRoute();
const id = String(route.params.id);
const api = useApi();

const { data: catalog } = await useAsyncData<CatalogPayload>(`catalog:p:${id}`, async () => {
  const { data, error } = await api.catalog.get();
  if (error || !data) return { varieties: [], boxes: [] };
  return data as unknown as CatalogPayload;
});

const variety = computed<VarietyCardModel | null>(
  () => catalog.value?.varieties.find((v) => v.id === id) ?? null,
);

// Unknown / closed-round product → real 404 (SSR status, not a soft empty page).
if (!variety.value) {
  throw createError({ statusCode: 404, statusMessage: "ไม่พบสินค้านี้ในรอบขายปัจจุบัน" });
}

const v = variety.value;
const gallery = computed<string[]>(() => v.gallery ?? (v.imageUrl ? [v.imageUrl] : []));
const pack = computed(() => v.rounds[0]?.prices.b2c?.packs[0] ?? null);
const baht = computed(() => (pack.value ? Math.round(pack.value.unitPriceSatang / 100) : null));
const soldOut = computed(() => v.rounds[0]?.soldOut ?? true);
const cover = computed(() => v.imageUrl ?? gallery.value[0] ?? undefined);

// Meta / OG (D-06) — real product imagery, not a generated OG image.
useSeoMeta({
  title: () => `${v.name} | Saladee`,
  description: () => `สั่ง ${v.name} ผักสลัดสดจากรอบเก็บเกี่ยวปัจจุบัน ส่งตรงจากฟาร์ม`,
  ogTitle: () => v.name,
  ogDescription: () => `${v.name} — ผักสลัดสดรอบนี้ ส่งตรงจากฟาร์ม`,
  ogType: "product" as never,
  ogImage: () => cover.value,
});

// Cart wiring (04-09): add the emitted line (ids + qty only, T-04-29) to the shared cart.
const cart = useCart();
function onAdd(line: CartLine): void {
  cart.add(line);
}

// Product JSON-LD (D-06) via nuxt-schema-org — rich-result eligible structured data.
useSchemaOrg([
  defineProduct({
    name: v.name,
    image: gallery.value,
    offers: baht.value !== null
      ? [
          {
            price: baht.value,
            priceCurrency: "THB",
            availability: soldOut.value ? "OutOfStock" : "InStock",
          },
        ]
      : [],
  }),
]);
</script>

<template>
  <div class="store-max px-md py-lg">
    <NuxtLink to="/" class="text-[14px] font-normal text-muted">&larr; กลับไปหน้ารวมผัก</NuxtLink>

    <div class="mt-md grid grid-cols-1 gap-xl md:grid-cols-2">
      <!-- Gallery (cover + thumbnails, D-27/28) -->
      <div class="flex flex-col gap-md">
        <img
          v-if="cover"
          :src="cover"
          :alt="v.name"
          class="aspect-square w-full rounded-xl object-cover"
        />
        <div v-if="gallery.length > 1" class="flex flex-wrap gap-sm">
          <img
            v-for="(url, i) in gallery"
            :key="i"
            :src="url"
            :alt="`${v.name} ${i + 1}`"
            class="h-16 w-16 rounded-lg border border-hairline object-cover"
          />
        </div>
      </div>

      <!-- Detail + buy control -->
      <div class="flex flex-col gap-md">
        <h1 class="text-[28px] font-semibold leading-[1.25] text-ink">{{ v.name }}</h1>
        <p v-if="baht !== null" class="text-[20px] font-semibold text-ink">
          ฿{{ baht }}
          <span class="text-[14px] font-normal text-muted">/ {{ pack?.label }}</span>
        </p>
        <p class="text-[16px] leading-[1.6] text-muted">
          ผักสลัดสดจากรอบเก็บเกี่ยวปัจจุบัน จำนวนตรงกับผลผลิตจริง ส่งตรงจากฟาร์ม
        </p>
        <StoreVarietyCard :variety="v" sold-out-label="หมดรอบนี้" @add="onAdd" />
      </div>
    </div>
  </div>
</template>
