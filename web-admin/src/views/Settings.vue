<script setup lang="ts">
// System settings (ADM-03 / D-22). Edit the operator's HOT config — hold window,
// confidence haircut %, B2B quota ceiling %, and the free-shipping threshold /
// per-zone delivery fees — and save WITHOUT a redeploy. Single column, max-width
// 640 (UI-SPEC Forms); one accent primary CTA "บันทึกการตั้งค่า"; inline
// destructive validation; a saved confirmation. SECURITY: NO secret field is ever
// shown or sent — payee id, slip-verify key, LINE/JWT/R2 secrets live in env only
// (T-03-31); this form only ever moves the hot values the API exposes.
import { computed, ref, watch } from "vue";
import { type HotSettings, useSaveSettings, useSettings } from "../composables/useSettings";

const { data, isLoading, isError } = useSettings();
const save = useSaveSettings();

// Editable hot-value form. Money is edited in baht for humans, stored in satang.
const form = ref({
  holdWindowSeconds: 1800,
  haircutDefaultPct: 90,
  b2bQuotaCeilingPct: 100,
  freeShippingThresholdBaht: 500,
});
// The loaded delivery config (zones/methods) is preserved verbatim on save; only
// the free-shipping threshold is edited here.
const delivery = ref<HotSettings["delivery"] | null>(null);
const validationError = ref<string | null>(null);
const saved = ref(false);

watch(
  data,
  (s) => {
    if (!s) return;
    form.value = {
      holdWindowSeconds: s.holdWindowSeconds,
      haircutDefaultPct: s.haircutDefaultPct,
      b2bQuotaCeilingPct: s.b2bQuotaCeilingPct,
      freeShippingThresholdBaht: Math.round(s.delivery.freeShippingThresholdSatang / 100),
    };
    delivery.value = s.delivery;
    saved.value = false;
    validationError.value = null;
  },
  { immediate: true },
);

const holdWindowMinutes = computed(() => Math.round(form.value.holdWindowSeconds / 60));

function fail(msg: string): boolean {
  validationError.value = msg;
  return false;
}

function validate(): boolean {
  const f = form.value;
  if (f.holdWindowSeconds < 60) return fail("เวลาถือครองคิวอาร์ต้องอย่างน้อย 60 วินาที");
  if (f.haircutDefaultPct < 0 || f.haircutDefaultPct > 100)
    return fail("อัตราหักความมั่นใจต้องอยู่ระหว่าง 0–100%");
  if (f.b2bQuotaCeilingPct < 0 || f.b2bQuotaCeilingPct > 100)
    return fail("เพดานโควตา B2B ต้องอยู่ระหว่าง 0–100%");
  if (f.freeShippingThresholdBaht < 0) return fail("ยอดขั้นต่ำส่งฟรีต้องไม่ติดลบ");
  validationError.value = null;
  return true;
}

async function submit(): Promise<void> {
  saved.value = false;
  if (!validate()) return;
  try {
    const patch: Record<string, unknown> = {
      holdWindowSeconds: form.value.holdWindowSeconds,
      haircutDefaultPct: form.value.haircutDefaultPct,
      b2bQuotaCeilingPct: form.value.b2bQuotaCeilingPct,
    };
    if (delivery.value) {
      patch.delivery = {
        ...delivery.value,
        freeShippingThresholdSatang: Math.round(form.value.freeShippingThresholdBaht * 100),
      };
    }
    await save.mutateAsync(patch);
    saved.value = true;
  } catch {
    validationError.value = "บันทึกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section class="max-w-[640px]">
    <h1 class="mb-lg text-[28px] font-semibold">ตั้งค่าระบบ</h1>

    <!-- loading -->
    <div v-if="isLoading" class="space-y-md">
      <div v-for="n in 4" :key="n" class="h-10 animate-pulse rounded-md bg-surface" />
    </div>

    <!-- error -->
    <p v-else-if="isError" class="text-[14px] text-destructive">
      โหลดการตั้งค่าไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- edit form -->
    <form v-else class="space-y-lg" @submit.prevent="submit">
      <div class="grid grid-cols-2 gap-md">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">เวลาถือครองคิวอาร์ (วินาที)</span>
          <input
            v-model.number="form.holdWindowSeconds"
            type="number"
            min="60"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
          <span class="mt-xs block text-[12px] text-muted">≈ {{ holdWindowMinutes }} นาที</span>
        </label>

        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">อัตราหักความมั่นใจ (%)</span>
          <input
            v-model.number="form.haircutDefaultPct"
            type="number"
            min="0"
            max="100"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>

        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">เพดานโควตา B2B (%)</span>
          <input
            v-model.number="form.b2bQuotaCeilingPct"
            type="number"
            min="0"
            max="100"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>

        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">ยอดขั้นต่ำส่งฟรี (บาท)</span>
          <input
            v-model.number="form.freeShippingThresholdBaht"
            type="number"
            min="0"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
      </div>

      <!-- delivery zones (fees) — read-only reference; edit fee config in delivery.ts -->
      <div v-if="delivery" class="rounded-lg border border-hairline bg-canvas p-md">
        <p class="mb-sm text-[14px] font-semibold text-ink">โซนจัดส่ง</p>
        <ul class="space-y-xs">
          <li
            v-for="z in delivery.zones"
            :key="z.id"
            class="flex items-center justify-between text-[14px] text-muted"
          >
            <span>{{ z.nameTh }}</span>
            <span class="tabular text-ink">
              {{ Object.values(z.fees).filter((f) => f != null).length }} วิธีจัดส่ง
            </span>
          </li>
        </ul>
      </div>

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
