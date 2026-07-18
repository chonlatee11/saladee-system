<script setup lang="ts">
// Store catalog card — mirrors web/src/components/VarietyCard.vue (02-05) with the
// same tokens/markup, adapted for the Nuxt SSR store: NuxtLink into the SSR product
// page (/p/[id]) instead of the LIFF router, and the store add-to-cart copy
// "ใส่ตะกร้า" (04-UI-SPEC store copy). Money is DISPLAYED from server values only
// (unitPriceSatang resolved by the api); the emitted `add` line carries ids + qty
// only (T-02-17). Cart wiring lands in Plan 09; here `add` just surfaces the intent.
import { computed, ref } from "vue";
import QtyStepper from "./QtyStepper.vue";

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
export interface VarietyCardModel {
  id: string;
  name: string;
  imageUrl: string | null;
  gallery?: string[];
  rounds: Round[];
}

const props = defineProps<{ variety: VarietyCardModel; soldOutLabel: string }>();
const emit = defineEmits<{
  (e: "add", line: { roundId: string; varietyId: string; saleUnitId: string; qty: number }): void;
}>();

// The catalog returns only open rounds; the customer buys the first (current) round.
const round = computed<Round | null>(() => props.variety.rounds[0] ?? null);
const pack = computed<Pack | null>(() => round.value?.prices.b2c?.packs[0] ?? null);
const soldOut = computed(() => round.value?.soldOut ?? true);
// Whole-baht display from server satang (Phase-1 prices are whole-baht, X.00).
const baht = computed(() => (pack.value ? Math.round(pack.value.unitPriceSatang / 100) : null));
const qty = ref(1);

function add(): void {
  if (!round.value || !pack.value || soldOut.value) return;
  emit("add", {
    roundId: round.value.roundId,
    varietyId: props.variety.id,
    saleUnitId: pack.value.saleUnitId,
    qty: qty.value,
  });
}
</script>

<template>
  <article class="rounded-xl bg-surface p-md">
    <NuxtLink :to="`/p/${variety.id}`" class="flex items-center gap-md">
      <img
        v-if="variety.imageUrl"
        :src="variety.imageUrl"
        :alt="variety.name"
        class="h-16 w-16 shrink-0 rounded-lg object-cover"
      />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-[20px] font-semibold leading-[1.35] text-ink">
          {{ variety.name }}
        </h3>
        <p v-if="baht !== null" class="text-[16px] font-semibold text-ink">
          ฿{{ baht }}
          <span class="text-[14px] font-normal text-muted">/ {{ pack?.label }}</span>
        </p>
      </div>
    </NuxtLink>

    <div class="mt-md flex items-center justify-between gap-md">
      <span
        v-if="soldOut"
        class="rounded-md px-sm py-xs text-[14px] font-semibold text-destructive"
        style="background-color: color-mix(in srgb, var(--color-destructive) 10%, transparent)"
      >
        {{ soldOutLabel }}
      </span>
      <template v-else>
        <QtyStepper v-model="qty" :min="1" :max="99" />
        <button
          type="button"
          class="min-h-[44px] rounded-lg border border-ink px-md py-sm text-[16px] font-semibold text-ink"
          @click="add"
        >
          ใส่ตะกร้า
        </button>
      </template>
    </div>
  </article>
</template>
