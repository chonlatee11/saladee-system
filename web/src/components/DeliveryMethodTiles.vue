<script setup lang="ts">
// Delivery-method tiles (02-08 / UI-SPEC delivery step, D-12/13/14/15).
//
// Each of the four methods renders as a tile. A method is DISABLED when it is not in
// the server's `allowedMethods` (freshness gating, D-13) or when the zone does not
// offer it (no fee in the quote). The per-method flat fee comes straight from the
// server quote (T-02-30 — never client-computed); a ฿0 fee shows the free-shipping-
// applied state (D-15). The chosen tile gets the accent ring + check (UI-SPEC accent
// reserved item 2). When any method is freshness-blocked the strictest-set copy is
// shown so the customer knows why (D-13).
import { computed } from "vue";
import {
  type DeliveryMethod,
  DELIVERY_METHODS,
  METHOD_LABEL,
  baht,
} from "../lib/checkout";

const props = defineProps<{
  allowedMethods: DeliveryMethod[];
  fees: Partial<Record<DeliveryMethod, number>>;
  modelValue: DeliveryMethod | null;
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: DeliveryMethod): void }>();

interface Tile {
  method: DeliveryMethod;
  label: string;
  fee: number | undefined;
  freshnessBlocked: boolean;
  disabled: boolean;
}

const tiles = computed<Tile[]>(() =>
  DELIVERY_METHODS.map((method) => {
    const freshnessBlocked = !props.allowedMethods.includes(method);
    const fee = props.fees[method];
    return {
      method,
      label: METHOD_LABEL[method],
      fee,
      freshnessBlocked,
      disabled: freshnessBlocked || fee === undefined,
    };
  }),
);

// Any freshness-blocked method → show the strictest-set explanation once (D-13).
const anyFreshnessBlocked = computed(() => tiles.value.some((t) => t.freshnessBlocked));
const allowedLabels = computed(() =>
  props.allowedMethods.map((m) => METHOD_LABEL[m]).join(" / "),
);

function feeLabel(fee: number | undefined): string {
  if (fee === undefined) return "ไม่ให้บริการในเขตนี้";
  if (fee === 0) return "ส่งฟรี";
  return `฿${baht(fee)}`;
}

function select(tile: Tile): void {
  if (tile.disabled) return;
  emit("update:modelValue", tile.method);
}
</script>

<template>
  <div class="flex flex-col gap-sm">
    <p
      v-if="anyFreshnessBlocked && allowedMethods.length > 0"
      class="rounded-lg bg-warning-surface px-md py-sm text-[14px] leading-[1.5] text-warning"
      role="note"
    >
      ผักในตะกร้าต้องส่งแบบ {{ allowedLabels }} เพื่อความสด — โปรดเลือกวิธีจัดส่งที่รองรับ
    </p>

    <button
      v-for="tile in tiles"
      :key="tile.method"
      type="button"
      class="flex min-h-[44px] items-center justify-between gap-md rounded-lg border bg-surface px-md py-sm text-left disabled:cursor-not-allowed disabled:opacity-40"
      :class="
        modelValue === tile.method
          ? 'border-accent ring-2 ring-accent'
          : 'border-hairline'
      "
      :disabled="tile.disabled"
      :aria-pressed="modelValue === tile.method"
      @click="select(tile)"
    >
      <span class="flex items-center gap-sm">
        <span
          class="flex h-[20px] w-[20px] items-center justify-center rounded-full border text-[14px]"
          :class="
            modelValue === tile.method
              ? 'border-accent bg-accent text-white'
              : 'border-hairline text-transparent'
          "
          aria-hidden="true"
          >✓</span
        >
        <span
          class="text-[16px] text-ink"
          :class="modelValue === tile.method ? 'font-semibold' : ''"
          >{{ tile.label }}</span
        >
      </span>
      <span
        class="shrink-0 text-[14px]"
        :class="tile.fee === 0 ? 'font-semibold text-accent' : 'text-muted'"
        >{{ feeLabel(tile.fee) }}</span
      >
    </button>
  </div>
</template>
