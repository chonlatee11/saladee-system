<script setup lang="ts">
// รายละเอียดผัก — the variety detail screen (02-05, route "/variety/:id"). Shows the
// variety's photo/name/description plus its care content (storageTips / washingTips,
// D-24) and an add-to-cart CTA. A care block is HIDDEN when its field is null (D-24).
// Care/description text is rendered via Vue text interpolation (auto-escaped) — never
// v-html — so server-supplied copy cannot inject markup into the LINE WebView (T-02-18).
//
// The api has no per-variety detail route, so this reads the public /catalog and
// selects the variety by id (the catalog already carries the care fields). Loading is
// owned by the App.vue <Suspense> fallback; this screen owns content + error/not-found.
import { ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { useCart, type CartLine } from "../stores/cart";
import QtyStepper from "../components/QtyStepper.vue";

interface Pack {
  saleUnitId: string;
  label: string;
  unitPriceSatang: number;
}
interface Round {
  roundId: string;
  soldOut: boolean;
  prices: { b2c: { packs: Pack[] } | null };
}
interface Variety {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  storageTips: string | null;
  washingTips: string | null;
  rounds: Round[];
}
interface CatalogResult {
  data: { varieties: Variety[] } | null;
  error: unknown | null;
}

const props = defineProps<{ loader?: () => Promise<CatalogResult> }>();
const route = useRoute();
const id = String(route.params.id ?? "");
const cart = useCart();
const load = props.loader ?? (() => api.catalog.get() as unknown as Promise<CatalogResult>);

const res = await load().catch(() => ({ data: null, error: { network: true } }) as CatalogResult);
const errored = res.error != null;
const variety = (res.data?.varieties ?? []).find((v) => v.id === id) ?? null;
const round = variety?.rounds[0] ?? null;
const pack = round?.prices.b2c?.packs[0] ?? null;
const soldOut = round?.soldOut ?? true;
const baht = pack ? Math.round(pack.unitPriceSatang / 100) : null;
const qty = ref(1);

function add(): void {
  if (!variety || !round || !pack || soldOut) return;
  const line: CartLine = {
    roundId: round.roundId,
    varietyId: variety.id,
    saleUnitId: pack.saleUnitId,
    qty: qty.value,
  };
  cart.add(line);
}
</script>

<template>
  <section class="p-md">
    <div
      v-if="errored || !variety"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <template v-else>
      <img
        v-if="variety.imageUrl"
        :src="variety.imageUrl"
        :alt="variety.name"
        class="mb-md aspect-square w-full rounded-xl object-cover"
      />
      <h1 class="text-[28px] font-semibold leading-[1.3] text-ink">{{ variety.name }}</h1>
      <p v-if="variety.description" class="mt-sm text-[16px] leading-[1.6] text-muted">
        {{ variety.description }}
      </p>

      <!-- Care content (D-24) — each block hidden when its field is null. -->
      <div v-if="variety.storageTips" class="mt-lg rounded-xl bg-surface p-md">
        <h2 class="text-[20px] font-semibold leading-[1.35] text-ink">วิธีเก็บรักษา</h2>
        <p class="mt-sm text-[16px] leading-[1.6] text-ink">{{ variety.storageTips }}</p>
      </div>
      <div v-if="variety.washingTips" class="mt-md rounded-xl bg-surface p-md">
        <h2 class="text-[20px] font-semibold leading-[1.35] text-ink">วิธีล้าง</h2>
        <p class="mt-sm text-[16px] leading-[1.6] text-ink">{{ variety.washingTips }}</p>
      </div>

      <!-- Price + add-to-cart: the single primary action here uses the accent CTA. -->
      <div class="mt-lg flex items-center justify-between gap-md">
        <p v-if="baht !== null" class="text-[20px] font-semibold text-ink">
          ฿{{ baht }}
          <span class="text-[14px] font-normal text-muted">/ {{ pack?.label }}</span>
        </p>
        <span
          v-if="soldOut"
          class="rounded-md px-sm py-xs text-[14px] font-semibold text-destructive"
          style="background-color: color-mix(in srgb, var(--color-destructive) 10%, transparent)"
        >
          หมดรอบนี้
        </span>
      </div>

      <div v-if="!soldOut" class="mt-md flex items-center justify-between gap-md">
        <QtyStepper v-model="qty" :min="1" :max="99" />
        <button
          type="button"
          class="min-h-[48px] flex-1 rounded-lg bg-accent px-md text-[16px] font-semibold text-canvas"
          @click="add"
        >
          เพิ่มลงตะกร้า
        </button>
      </div>
    </template>
  </section>
</template>
