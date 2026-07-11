<script setup lang="ts">
// Harvest calendar → publish sellable qty (CROP-04 / D-03/04). The grower reviews the
// DRAFT sellable qty the system computed from the planting batches (03-04 forecast) and
// gates it behind ONE primary action "เผยแพร่จำนวนขายรอบนี้" (never auto — D-03). Publish
// is the round-open orchestrator server-side: it reserves standing orders before B2C and
// fires the subscription generator (all in the API). The grower may also hand-set a
// sellable qty ("แก้ไขจำนวนขายเอง") which is flagged manual and kept permanently across
// re-publish. States per UI-SPEC: draft (warning) · published (positive) · manual-override.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref, watch } from "vue";
import DataTable from "../components/DataTable.vue";
import { useVarieties } from "../composables/useCrop";
import {
  useHarvestCalendar,
  useOverrideQuota,
  usePublishQuota,
  useRounds,
} from "../composables/useHarvest";

interface CalendarRow {
  varietyId: string;
  varietyName: string | null;
  draftQuota: number | null;
  publishedQuota: number | null;
  reservedPlants: number;
  isManualOverride: boolean;
  state: "draft" | "published" | "manual-override";
}
interface RoundRow {
  id: string;
  name: string;
  status: string;
  harvestDate: string | null;
}
interface VarietyRow {
  id: string;
  name: string;
}

const { data: rounds, isLoading: roundsLoading } = useRounds();
const { data: varieties } = useVarieties();
const roundList = computed<RoundRow[]>(() => (rounds.value ?? []) as unknown as RoundRow[]);
const varietyList = computed<VarietyRow[]>(
  () => (varieties.value ?? []) as unknown as VarietyRow[],
);

const selectedRoundId = ref<string | null>(null);
// Default to the first round with a harvest date once the list loads.
watch(
  roundList,
  (list) => {
    if (!selectedRoundId.value && list.length > 0) {
      selectedRoundId.value = (list.find((r) => r.harvestDate) ?? list[0])?.id ?? null;
    }
  },
  { immediate: true },
);

const { data: calendar, isLoading, isError } = useHarvestCalendar(selectedRoundId);
const publish = usePublishQuota();
const override = useOverrideQuota();

const rows = computed<CalendarRow[]>(
  () => (calendar.value?.rows ?? []) as unknown as CalendarRow[],
);
const isPublished = computed(() => calendar.value?.isPublished ?? false);

function varietyName(row: CalendarRow): string {
  return (
    row.varietyName ??
    varietyList.value.find((v) => v.id === row.varietyId)?.name ??
    row.varietyId.slice(0, 8)
  );
}
function sellableQty(row: CalendarRow): number | null {
  return row.publishedQuota ?? row.draftQuota;
}

const columns: ColumnDef<CalendarRow, unknown>[] = [
  { id: "variety", header: "พันธุ์ผัก", accessorFn: (r) => varietyName(r) },
  {
    id: "sellable",
    header: "จำนวนขาย (ต้น)",
    accessorFn: (r) => sellableQty(r) ?? "—",
    meta: { numeric: true },
  },
  { id: "reserved", header: "จองแล้ว (ต้น)", accessorKey: "reservedPlants", meta: { numeric: true } },
  { id: "state", header: "สถานะ", accessorKey: "state" },
];

// ── Publish action ───────────────────────────────────────────────────────────
const publishError = ref<string | null>(null);
async function onPublish(): Promise<void> {
  if (!selectedRoundId.value) return;
  publishError.value = null;
  try {
    await publish.mutateAsync(selectedRoundId.value);
  } catch {
    publishError.value = "ยังเผยแพร่ไม่ได้ โปรดตรวจสอบจำนวนขายที่ระบบคำนวณไว้ก่อนกดเผยแพร่";
  }
}

// ── Manual-override modal ─────────────────────────────────────────────────────
const overrideTarget = ref<CalendarRow | null>(null);
const overrideQty = ref(0);
const overrideError = ref<string | null>(null);
function openOverride(row: CalendarRow): void {
  overrideTarget.value = row;
  overrideQty.value = sellableQty(row) ?? 0;
  overrideError.value = null;
}
async function submitOverride(): Promise<void> {
  if (!overrideTarget.value || !selectedRoundId.value) return;
  overrideError.value = null;
  try {
    await override.mutateAsync({
      roundId: selectedRoundId.value,
      varietyId: overrideTarget.value.varietyId,
      quotaPlants: overrideQty.value,
    });
    overrideTarget.value = null;
  } catch {
    overrideError.value = "บันทึกจำนวนขายเองไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">ปฏิทินเก็บเกี่ยว</h1>
      <button
        v-if="rows.length > 0"
        type="button"
        :disabled="publish.isPending.value || !selectedRoundId"
        class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
        @click="onPublish"
      >
        เผยแพร่จำนวนขายรอบนี้
      </button>
    </div>

    <!-- Round picker -->
    <label class="mb-lg block max-w-[360px]">
      <span class="mb-xs block text-[14px] text-muted">รอบขาย</span>
      <select
        v-model="selectedRoundId"
        class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
      >
        <option v-for="r in roundList" :key="r.id" :value="r.id">
          {{ r.name }}{{ r.harvestDate ? ` · เก็บเกี่ยว ${r.harvestDate}` : "" }}
        </option>
      </select>
    </label>

    <p v-if="publishError" class="mb-md text-[14px] text-destructive">{{ publishError }}</p>
    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดปฏิทินเก็บเกี่ยวไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <p v-if="!isPublished && rows.length > 0" class="mb-md text-[14px] text-muted">
      ระบบคำนวณจำนวนขายจากแบตช์ที่ถึงกำหนดเก็บเกี่ยว — ตรวจสอบแล้วกด "เผยแพร่จำนวนขายรอบนี้"
    </p>

    <!-- empty / no-due -->
    <div
      v-if="!isLoading && !roundsLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีรอบที่ถึงกำหนดเก็บเกี่ยว</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อแบตช์ถึงกำหนด ระบบจะคำนวณจำนวนขายให้ตรวจสอบและเผยแพร่ที่นี่
      </p>
    </div>

    <!-- calendar table -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:state="{ row }">
        <span
          v-if="(row as CalendarRow).state === 'published'"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          เผยแพร่แล้ว
        </span>
        <span
          v-else-if="(row as CalendarRow).state === 'manual-override'"
          class="rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-ink"
        >
          ตั้งจำนวนเอง
        </span>
        <span
          v-else
          class="rounded-full bg-warning-surface px-sm py-[2px] text-[12px] font-semibold text-warning"
        >
          รอเผยแพร่
        </span>
      </template>

      <template #row-actions="{ row }">
        <button
          type="button"
          class="text-[14px] text-muted hover:text-ink"
          @click="openOverride(row as CalendarRow)"
        >
          แก้ไขจำนวนขายเอง
        </button>
      </template>
    </DataTable>

    <!-- Manual-override modal -->
    <div
      v-if="overrideTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="overrideTarget = null"
    >
      <form
        class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitOverride"
      >
        <h2 class="mb-md text-[20px] font-semibold">แก้ไขจำนวนขายเอง</h2>
        <p class="mb-lg text-[14px] text-muted">
          จำนวนที่ตั้งเองจะถูกเก็บไว้ถาวร และจะไม่ถูกทับเมื่อเผยแพร่รอบนี้อีกครั้ง
        </p>
        <label class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">
            {{ overrideTarget ? varietyName(overrideTarget) : "" }} — จำนวนขาย (ต้น)
          </span>
          <input
            v-model.number="overrideQty"
            type="number"
            min="0"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <p v-if="overrideError" class="mb-md text-[14px] text-destructive">{{ overrideError }}</p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="overrideTarget = null"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            :disabled="override.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึก
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
