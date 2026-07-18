<script setup lang="ts">
// Points-redeem entry at LIFF checkout (04-10 / D-14, CUST-03). MEMBER-ONLY: the
// parent mounts this only for a logged-in member (a guest never earns/redeems —
// Pitfall 5). SECURITY: this sends a bounded points COUNT only; POST /orders caps it
// against the payable amount and resolves the baht value server-side (04-03). The
// balance shown is the server ledger SUM (GET /loyalty/balance), fetched by the parent.
import { computed, ref } from "vue";
import QtyStepper from "./QtyStepper.vue";

const props = defineProps<{
  modelValue: number;
  // The member's server-resolved points balance (ledger SUM) — the redeem ceiling.
  balance: number;
  // Baht value of one point on redeem (loyaltyPointBaht), for the display hint only.
  pointBaht?: number;
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: number): void }>();

const on = ref(props.modelValue > 0);
const baht = computed(() => Math.round(props.balance * (props.pointBaht ?? 1)));

function toggle(): void {
  on.value = !on.value;
  // Turning off clears the redeem; turning on starts at the full balance.
  emit("update:modelValue", on.value ? props.balance : 0);
}

function setPoints(n: number): void {
  emit("update:modelValue", n);
}
</script>

<template>
  <div v-if="balance > 0" class="flex flex-col gap-sm">
    <label class="flex min-h-[44px] cursor-pointer items-start gap-sm py-sm">
      <input
        type="checkbox"
        class="mt-xs h-[20px] w-[20px] shrink-0 accent-accent"
        :checked="on"
        @change="toggle"
      />
      <span class="text-[14px] leading-[1.5] text-ink">
        แต้มสะสม <span class="font-semibold">{{ balance }}</span> แต้ม
        <span class="text-muted">(= {{ baht }} บาท)</span> — ใช้แต้มลดราคา
      </span>
    </label>

    <div v-if="on" class="flex items-center justify-between gap-md rounded-lg bg-surface p-md">
      <span class="text-[14px] text-ink">จำนวนแต้มที่ใช้</span>
      <QtyStepper
        :model-value="modelValue"
        :min="0"
        :max="balance"
        @update:model-value="setPoints"
      />
    </div>
  </div>
</template>
