<script setup lang="ts">
// Actual-harvest log (CROP-05 / INV-10, D-04/05). The grower confirms a batch's real
// harvest (plants + grams + waste) via ONE primary action "บันทึกการเก็บเกี่ยว". The
// server auto-derives the lot code + best-before (harvestDate + shelf-life) — shown
// read-only — and returns the actual-vs-forecast delta (warning if off; the system NEVER
// auto-tunes the variety params — the grower adjusts them by hand if a trend repeats).
// 1 batch = 1 lot: an already-logged batch is not offered again. States per UI-SPEC:
// log form · delta warning · logged history · empty.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { usePlantingBatches } from "../composables/useCrop";
import { useHarvestLogs, useLogHarvest } from "../composables/useHarvest";

interface BatchRow {
  id: string;
  varietyName: string;
  plantDate: string;
  plantCount: number;
  projectedHarvestDate: string;
  expectedPlants: number;
}
interface LogRow {
  id: string;
  batchId: string;
  varietyName: string;
  lotCode: string;
  harvestedAt: string;
  actualPlants: number;
  actualGrams: number;
  wasteGrams: number;
  bestBefore: string;
  expectedPlants: number;
  delta: number;
}

const { data: batches } = usePlantingBatches();
const { data: logs, isLoading, isError } = useHarvestLogs();
const logHarvest = useLogHarvest();

const logList = computed<LogRow[]>(() => (logs.value ?? []) as unknown as LogRow[]);
const loggedBatchIds = computed(() => new Set(logList.value.map((l) => l.batchId)));
// Only batches not yet confirmed can be logged (1 batch = 1 lot).
const loggableBatches = computed<BatchRow[]>(() =>
  ((batches.value ?? []) as unknown as BatchRow[]).filter((b) => !loggedBatchIds.value.has(b.id)),
);

const columns: ColumnDef<LogRow, unknown>[] = [
  { id: "variety", header: "พันธุ์ผัก", accessorKey: "varietyName" },
  { id: "lot", header: "ล็อต", accessorKey: "lotCode" },
  {
    id: "harvested",
    header: "วันเก็บเกี่ยว",
    accessorFn: (r) => r.harvestedAt.slice(0, 10),
  },
  {
    id: "bestBefore",
    header: "ควรใช้ก่อน",
    accessorFn: (r) => r.bestBefore.slice(0, 10),
  },
  { id: "actual", header: "เก็บได้ (ต้น)", accessorKey: "actualPlants", meta: { numeric: true } },
  { id: "delta", header: "เทียบคาดการณ์", accessorKey: "delta", meta: { numeric: true } },
];

function deltaCopy(delta: number): string {
  if (delta === 0) return "ตรงตามที่คาด";
  const word = delta < 0 ? "น้อย" : "มาก";
  return `เก็บเกี่ยวได้${word}กว่าที่คาด ${Math.abs(delta)} ต้น — ปรับค่าพันธุ์ผักเองได้หากแนวโน้มนี้เกิดซ้ำ`;
}

// ── Log-harvest modal ─────────────────────────────────────────────────────────
const showForm = ref(false);
const formBatchId = ref("");
const formHarvestedAt = ref(new Date().toISOString().slice(0, 10));
const formActualPlants = ref(0);
const formActualGrams = ref(0);
const formWasteGrams = ref(0);
const formError = ref<string | null>(null);

const selectedBatch = computed<BatchRow | null>(
  () => loggableBatches.value.find((b) => b.id === formBatchId.value) ?? null,
);

function openForm(): void {
  formBatchId.value = loggableBatches.value[0]?.id ?? "";
  formHarvestedAt.value = new Date().toISOString().slice(0, 10);
  formActualPlants.value = selectedBatch.value?.expectedPlants ?? 0;
  formActualGrams.value = 0;
  formWasteGrams.value = 0;
  formError.value = null;
  showForm.value = true;
}

async function submitForm(): Promise<void> {
  formError.value = null;
  if (!formBatchId.value) {
    formError.value = "เลือกแบตช์ที่จะบันทึกการเก็บเกี่ยว";
    return;
  }
  try {
    await logHarvest.mutateAsync({
      batchId: formBatchId.value,
      harvestedAt: new Date(`${formHarvestedAt.value}T00:00:00.000Z`).toISOString(),
      actualPlants: formActualPlants.value,
      actualGrams: formActualGrams.value,
      wasteGrams: formWasteGrams.value,
    });
    showForm.value = false;
  } catch {
    formError.value = "บันทึกการเก็บเกี่ยวไม่สำเร็จ (แบตช์นี้อาจบันทึกไปแล้ว) โปรดลองใหม่";
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">บันทึกการเก็บเกี่ยว</h1>
      <button
        v-if="loggableBatches.length > 0"
        type="button"
        class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
        @click="openForm"
      >
        บันทึกการเก็บเกี่ยว
      </button>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดประวัติการเก็บเกี่ยวไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- empty state -->
    <div
      v-if="!isLoading && logList.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีแบตช์ที่บันทึกการเก็บเกี่ยว</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อเก็บเกี่ยวแบตช์แล้ว บันทึกจำนวนจริงที่นี่ ระบบจะออกล็อตและวันควรใช้ก่อนให้อัตโนมัติ
      </p>
    </div>

    <!-- logged history -->
    <DataTable v-else :columns="columns" :data="logList" :loading="isLoading">
      <template #cell:delta="{ row }">
        <span
          v-if="(row as LogRow).delta === 0"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          ตรงตามคาด
        </span>
        <span
          v-else
          class="rounded-full bg-warning-surface px-sm py-[2px] text-[12px] font-semibold text-warning"
          :title="deltaCopy((row as LogRow).delta)"
        >
          {{ (row as LogRow).delta > 0 ? "+" : "" }}{{ (row as LogRow).delta }} ต้น
        </span>
      </template>
    </DataTable>

    <!-- Log-harvest modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="showForm = false"
    >
      <form
        class="max-h-[85vh] w-full max-w-[640px] overflow-y-auto rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitForm"
      >
        <h2 class="mb-lg text-[20px] font-semibold">บันทึกการเก็บเกี่ยว</h2>

        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">แบตช์</span>
          <select
            v-model="formBatchId"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            @change="formActualPlants = selectedBatch?.expectedPlants ?? 0"
          >
            <option v-for="b in loggableBatches" :key="b.id" :value="b.id">
              {{ b.varietyName }} · ปลูก {{ b.plantDate.slice(0, 10) }} · คาด {{ b.expectedPlants }} ต้น
            </option>
          </select>
        </label>

        <div class="mb-md grid grid-cols-2 gap-sm">
          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">วันที่เก็บเกี่ยว</span>
            <input
              v-model="formHarvestedAt"
              type="date"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            />
          </label>
          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">เก็บได้ (ต้น)</span>
            <input
              v-model.number="formActualPlants"
              type="number"
              min="0"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
            />
          </label>
          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">น้ำหนักรวม (กรัม)</span>
            <input
              v-model.number="formActualGrams"
              type="number"
              min="0"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
            />
          </label>
          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">ของเสีย (กรัม)</span>
            <input
              v-model.number="formWasteGrams"
              type="number"
              min="0"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
            />
          </label>
        </div>

        <!-- auto lot + best-before are computed server-side and shown on the history row -->
        <p class="mb-md text-[13px] text-muted">
          ระบบจะออกรหัสล็อตและคำนวณวัน "ควรใช้ก่อน" (วันเก็บเกี่ยว + อายุเก็บของพันธุ์) ให้อัตโนมัติ
        </p>

        <p
          v-if="selectedBatch"
          class="mb-md rounded-md bg-canvas px-md py-sm text-[13px] text-muted"
        >
          คาดการณ์จากพันธุ์: {{ selectedBatch.expectedPlants }} ต้น · ส่วนต่างจะแสดงหลังบันทึก
        </p>

        <p v-if="formError" class="mb-md text-[14px] text-destructive">{{ formError }}</p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="showForm = false"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            :disabled="logHarvest.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึก
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
