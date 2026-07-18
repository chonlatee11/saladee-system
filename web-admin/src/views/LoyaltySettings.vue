<script setup lang="ts">
// Loyalty settings (04-03 / CUST-03, D-11). Reuses the Phase-3 hot-config settings
// form shape to edit the loyalty ECONOMICS — how many points an order earns per 100
// baht subtotal, and the baht value of one point on redeem — and save WITHOUT a
// redeploy. Single column, max-width 640 (UI-SPEC Forms); ONE accent primary CTA;
// inline validation; a saved confirmation. These are NON-secret hot values persisted
// through the SAME allow-listed settings endpoint (secrets stay env-only, T-03-31);
// the server requireRole("owner","admin") is the authority (D-19).
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ref, watch } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

interface LoyaltyHot {
  loyaltyEarnRate: number;
  loyaltyPointBaht: number;
}

function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

const qc = useQueryClient();

const { data, isLoading, isError } = useQuery({
  queryKey: ["settings", "loyalty"],
  queryFn: async () => {
    const { data, error } = await api.settings.get({ headers: authHeaders() });
    if (error) throw error;
    return data as unknown as LoyaltyHot;
  },
});

const form = ref<LoyaltyHot>({ loyaltyEarnRate: 1, loyaltyPointBaht: 1 });
const validationError = ref<string | null>(null);
const saved = ref(false);

watch(
  data,
  (s) => {
    if (!s) return;
    form.value = { loyaltyEarnRate: s.loyaltyEarnRate, loyaltyPointBaht: s.loyaltyPointBaht };
    saved.value = false;
    validationError.value = null;
  },
  { immediate: true },
);

const save = useMutation({
  mutationFn: async (patch: LoyaltyHot) => {
    const { data, error } = await api.settings.put(patch, { headers: authHeaders() });
    if (error) throw error;
    return data;
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "loyalty"] }),
});

function validate(): boolean {
  const f = form.value;
  if (f.loyaltyEarnRate < 0) {
    validationError.value = "อัตราสะสมแต้มต้องไม่ติดลบ";
    return false;
  }
  if (f.loyaltyPointBaht < 0) {
    validationError.value = "มูลค่าต่อแต้มต้องไม่ติดลบ";
    return false;
  }
  validationError.value = null;
  return true;
}

async function submit(): Promise<void> {
  saved.value = false;
  if (!validate()) return;
  try {
    await save.mutateAsync({
      loyaltyEarnRate: form.value.loyaltyEarnRate,
      loyaltyPointBaht: form.value.loyaltyPointBaht,
    });
    saved.value = true;
  } catch {
    validationError.value = "บันทึกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section class="max-w-[640px]">
    <h1 class="mb-lg text-[28px] font-semibold">สะสมแต้ม</h1>

    <div v-if="isLoading" class="space-y-md">
      <div v-for="n in 2" :key="n" class="h-10 animate-pulse rounded-md bg-surface" />
    </div>

    <p v-else-if="isError" class="text-[14px] text-destructive">
      โหลดการตั้งค่าสะสมแต้มไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <form v-else class="space-y-lg" @submit.prevent="submit">
      <div class="grid grid-cols-2 gap-md">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">แต้มที่ได้ต่อ 100 บาท</span>
          <input
            v-model.number="form.loyaltyEarnRate"
            type="number"
            min="0"
            step="0.1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>

        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">มูลค่าต่อ 1 แต้ม (บาท)</span>
          <input
            v-model.number="form.loyaltyPointBaht"
            type="number"
            min="0"
            step="0.1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
      </div>

      <p class="text-[13px] text-muted">
        ลูกค้าจะได้ {{ form.loyaltyEarnRate }} แต้มต่อการซื้อทุก 100 บาท และแลก 1 แต้ม =
        {{ form.loyaltyPointBaht }} บาทตอนชำระเงิน
      </p>

      <p v-if="validationError" class="text-[14px] text-destructive">{{ validationError }}</p>
      <p v-else-if="saved" class="text-[14px] text-positive">บันทึกการตั้งค่าแล้ว</p>

      <button
        type="submit"
        :disabled="save.isPending.value"
        class="flex h-10 items-center justify-center gap-xs rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
      >
        <span
          v-if="save.isPending.value"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
        />
        บันทึกการตั้งค่า
      </button>
    </form>
  </section>
</template>
