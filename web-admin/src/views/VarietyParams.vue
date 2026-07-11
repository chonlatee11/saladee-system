<script setup lang="ts">
// Variety yield parameters (CROP-01 / D-01). Pick a variety, edit its
// days-to-harvest / survival% / harvest-window / shelf-life, and save. Single
// column, max-width 640 (UI-SPEC Forms); one accent primary CTA
// "บันทึกค่าพันธุ์ผัก"; inline destructive validation; a saved confirmation.
import { computed, ref, watch } from "vue";
import { type VarietyParams, useSaveVarietyParams, useVarieties } from "../composables/useCrop";

const { data: varieties, isLoading, isError } = useVarieties();
const save = useSaveVarietyParams();

const selectedId = ref<string>("");
const form = ref<VarietyParams>({
  daysToHarvest: 30,
  survivalPct: 90,
  harvestWindowDays: 1,
  shelfLifeDays: 7,
});
const validationError = ref<string | null>(null);
const saved = ref(false);

// When the variety list arrives (or the selection changes) load that variety's
// current params into the form so the operator edits real values.
watch(
  [varieties, selectedId],
  () => {
    const list = varieties.value ?? [];
    if (list.length > 0 && !selectedId.value) selectedId.value = list[0]?.id ?? "";
    const v = list.find((x) => x.id === selectedId.value);
    if (v) {
      form.value = {
        daysToHarvest: v.daysToHarvest,
        survivalPct: v.survivalPct,
        harvestWindowDays: v.harvestWindowDays,
        shelfLifeDays: v.shelfLifeDays,
      };
    }
    saved.value = false;
    validationError.value = null;
  },
  { immediate: true },
);

const selectedName = computed(
  () => (varieties.value ?? []).find((v) => v.id === selectedId.value)?.name ?? "",
);

function validate(): boolean {
  const f = form.value;
  if (f.daysToHarvest < 1) return fail("วันโตเก็บเกี่ยวต้องมากกว่า 0");
  if (f.survivalPct < 0 || f.survivalPct > 100) return fail("อัตรารอดต้องอยู่ระหว่าง 0–100%");
  if (f.harvestWindowDays < 1) return fail("ช่วงเก็บเกี่ยวต้องมากกว่า 0 วัน");
  if (f.shelfLifeDays < 1) return fail("อายุเก็บรักษาต้องมากกว่า 0 วัน");
  validationError.value = null;
  return true;
}
function fail(msg: string): boolean {
  validationError.value = msg;
  return false;
}

async function submit(): Promise<void> {
  saved.value = false;
  if (!selectedId.value || !validate()) return;
  try {
    await save.mutateAsync({ id: selectedId.value, params: { ...form.value } });
    saved.value = true;
  } catch {
    validationError.value = "บันทึกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section class="max-w-[640px]">
    <h1 class="mb-lg text-[28px] font-semibold">ค่าพันธุ์ผัก</h1>

    <!-- loading -->
    <div v-if="isLoading" class="space-y-md">
      <div v-for="n in 4" :key="n" class="h-10 animate-pulse rounded-md bg-surface" />
    </div>

    <!-- error -->
    <p v-else-if="isError" class="text-[14px] text-destructive">
      โหลดรายชื่อพันธุ์ผักไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- empty (no varieties in catalog yet) -->
    <div
      v-else-if="(varieties ?? []).length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีพันธุ์ผักในระบบ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เพิ่มพันธุ์ผักในแคตตาล็อกก่อน จึงจะตั้งค่าพารามิเตอร์การปลูกได้ที่นี่
      </p>
    </div>

    <!-- edit form -->
    <form v-else class="space-y-lg" @submit.prevent="submit">
      <label class="block">
        <span class="mb-xs block text-[14px] text-muted">พันธุ์ผัก</span>
        <select
          v-model="selectedId"
          class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
        >
          <option v-for="v in varieties ?? []" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
      </label>

      <div class="grid grid-cols-2 gap-md">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">วันโตเก็บเกี่ยว (วัน)</span>
          <input
            v-model.number="form.daysToHarvest"
            type="number"
            min="1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">อัตรารอด/หัก (%)</span>
          <input
            v-model.number="form.survivalPct"
            type="number"
            min="0"
            max="100"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">ช่วงเก็บเกี่ยว (วัน)</span>
          <input
            v-model.number="form.harvestWindowDays"
            type="number"
            min="1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">อายุเก็บรักษา (วัน)</span>
          <input
            v-model.number="form.shelfLifeDays"
            type="number"
            min="1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
      </div>

      <p v-if="validationError" class="text-[14px] text-destructive">{{ validationError }}</p>
      <p v-else-if="saved" class="text-[14px] text-positive">
        บันทึกค่าพันธุ์ "{{ selectedName }}" แล้ว
      </p>

      <button
        type="submit"
        :disabled="save.isPending.value"
        class="flex h-10 items-center justify-center gap-xs rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
      >
        <span
          v-if="save.isPending.value"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
        />
        บันทึกค่าพันธุ์ผัก
      </button>
    </form>
  </section>
</template>
