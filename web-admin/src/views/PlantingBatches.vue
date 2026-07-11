<script setup lang="ts">
// Planting batches (CROP-02/03). Add a batch, see the DataTable of batch →
// variety → plant date → computed harvest date → expected plants (harvest/yield
// are server-computed via forecast.ts), edit a row, and delete with a destructive
// confirm modal (UI-SPEC). Empty state per UI-SPEC copy.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import {
  useCreateBatch,
  useDeleteBatch,
  usePlantingBatches,
  useUpdateBatch,
  useVarieties,
} from "../composables/useCrop";
import { fmtDate } from "../lib/date";

interface BatchRow {
  id: string;
  varietyId: string;
  varietyName: string;
  plantDate: string;
  plantCount: number;
  bed: string | null;
  projectedHarvestDate: string;
  expectedPlants: number;
}

const { data: batches, isLoading, isError } = usePlantingBatches();
const { data: varieties } = useVarieties();
const createBatch = useCreateBatch();
const updateBatch = useUpdateBatch();
const deleteBatch = useDeleteBatch();

// Eden infers Date for timestamptz columns and at runtime hands back Date
// objects (NOT ISO strings), so date fields go through the shared fmtDate() which
// accepts Date | string — cast through unknown to bridge the declared string type.
const rows = computed<BatchRow[]>(() => (batches.value ?? []) as unknown as BatchRow[]);

const columns: ColumnDef<BatchRow, unknown>[] = [
  { accessorKey: "varietyName", header: "พันธุ์ผัก" },
  { id: "plantDate", header: "วันปลูก", accessorFn: (r) => fmtDate(r.plantDate) },
  {
    id: "projectedHarvestDate",
    header: "วันเก็บคาด",
    accessorFn: (r) => fmtDate(r.projectedHarvestDate),
  },
  { accessorKey: "plantCount", header: "จำนวนปลูก (ต้น)", meta: { numeric: true } },
  { accessorKey: "expectedPlants", header: "ผลผลิตคาด (ต้น)", meta: { numeric: true } },
  { accessorKey: "bed", header: "แปลง/ถาด" },
];

// ── Add-batch form ─────────────────────────────────────────────────────────
const showAdd = ref(false);
const addForm = ref({ varietyId: "", plantDate: "", plantCount: 0, bed: "" });
const addError = ref<string | null>(null);

function openAdd(): void {
  addForm.value = {
    varietyId: (varieties.value ?? [])[0]?.id ?? "",
    plantDate: new Date().toISOString().slice(0, 10),
    plantCount: 0,
    bed: "",
  };
  addError.value = null;
  showAdd.value = true;
}
async function submitAdd(): Promise<void> {
  addError.value = null;
  if (!addForm.value.varietyId || !addForm.value.plantDate) {
    addError.value = "เลือกพันธุ์ผักและวันปลูกก่อน";
    return;
  }
  try {
    await createBatch.mutateAsync({
      varietyId: addForm.value.varietyId,
      plantDate: addForm.value.plantDate,
      plantCount: addForm.value.plantCount,
      bed: addForm.value.bed || null,
    });
    showAdd.value = false;
  } catch {
    addError.value = "บันทึกแบตช์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// ── Edit modal ───────────────────────────────────────────────────────────────
const editRow = ref<BatchRow | null>(null);
const editForm = ref({ plantDate: "", plantCount: 0, bed: "" });
const editError = ref<string | null>(null);

function openEdit(row: BatchRow): void {
  editRow.value = row;
  editForm.value = {
    plantDate: fmtDate(row.plantDate),
    plantCount: row.plantCount,
    bed: row.bed ?? "",
  };
  editError.value = null;
}
async function submitEdit(): Promise<void> {
  if (!editRow.value) return;
  editError.value = null;
  try {
    await updateBatch.mutateAsync({
      id: editRow.value.id,
      plantDate: editForm.value.plantDate,
      plantCount: editForm.value.plantCount,
      bed: editForm.value.bed || null,
    });
    editRow.value = null;
  } catch {
    editError.value = "แก้ไขแบตช์ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// ── Delete-confirm modal (destructive) ───────────────────────────────────────
const deleteTarget = ref<BatchRow | null>(null);
async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  try {
    await deleteBatch.mutateAsync(deleteTarget.value.id);
  } finally {
    deleteTarget.value = null;
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">แบตช์การปลูก</h1>
      <button
        type="button"
        class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
        @click="openAdd"
      >
        เพิ่มแบตช์การปลูก
      </button>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดแบตช์การปลูกไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีแบตช์การปลูก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        กด "สร้างแบตช์จากสูตรปลูก" ในวันจันทร์ที่ปลูกเพื่อเริ่มรอบนี้ หรือเพิ่มแบตช์เดี่ยวที่นี่
      </p>
    </div>

    <!-- table -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #row-actions="{ row }">
        <button
          type="button"
          class="text-[14px] text-muted hover:text-ink"
          @click="openEdit(row as BatchRow)"
        >
          แก้ไข
        </button>
        <button
          type="button"
          class="ml-md text-[14px] text-destructive hover:underline"
          @click="deleteTarget = row as BatchRow"
        >
          ลบ
        </button>
      </template>
    </DataTable>

    <!-- Add modal -->
    <div
      v-if="showAdd"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="showAdd = false"
    >
      <form
        class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitAdd"
      >
        <h2 class="mb-lg text-[20px] font-semibold">เพิ่มแบตช์การปลูก</h2>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">พันธุ์ผัก</span>
          <select
            v-model="addForm.varietyId"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          >
            <option v-for="v in varieties ?? []" :key="v.id" :value="v.id">{{ v.name }}</option>
          </select>
        </label>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">วันปลูก</span>
          <input
            v-model="addForm.plantDate"
            type="date"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">จำนวนปลูก (ต้น)</span>
          <input
            v-model.number="addForm.plantCount"
            type="number"
            min="0"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">แปลง/ถาด (ไม่บังคับ)</span>
          <input
            v-model="addForm.bed"
            type="text"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
        <p v-if="addError" class="mb-md text-[14px] text-destructive">{{ addError }}</p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="showAdd = false"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            :disabled="createBatch.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึกแบตช์
          </button>
        </div>
      </form>
    </div>

    <!-- Edit modal -->
    <div
      v-if="editRow"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="editRow = null"
    >
      <form
        class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitEdit"
      >
        <h2 class="mb-lg text-[20px] font-semibold">แก้ไขแบตช์: {{ editRow.varietyName }}</h2>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">วันปลูก</span>
          <input
            v-model="editForm.plantDate"
            type="date"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">จำนวนปลูก (ต้น)</span>
          <input
            v-model.number="editForm.plantCount"
            type="number"
            min="0"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">แปลง/ถาด</span>
          <input
            v-model="editForm.bed"
            type="text"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
        <p v-if="editError" class="mb-md text-[14px] text-destructive">{{ editError }}</p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="editRow = null"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            :disabled="updateBatch.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึกการแก้ไข
          </button>
        </div>
      </form>
    </div>

    <!-- Delete-confirm modal (destructive on the right, neutral dismiss left) -->
    <div
      v-if="deleteTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="deleteTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ลบแบตช์การปลูก</h2>
        <p class="mb-lg text-[16px] text-ink">
          ลบแบตช์ "{{ deleteTarget.varietyName }}" ใช่ไหม? ผลผลิตที่คาดไว้จะถูกถอดออกจากรอบ
        </p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="deleteTarget = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="deleteBatch.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmDelete"
          >
            ลบ
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
