<script setup lang="ts">
// Subscription admin roster (SALE-03 / D-12/13/14/16). Staff see every vegetable-box
// member as a DataTable (member · package · frequency · latest round), each with a
// status badge (active = positive, paused = neutral, cancelled = negative) and a
// substitution-made flag when the last generated box was filled around a sold-out
// variety (D-16). One primary action per row (pause/resume — accent) plus a
// destructive cancel through a confirm modal (UI-SPEC §Destructive confirmations).
// Empty state per UI-SPEC copy. All copy Thai; accent = the single primary/row.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import {
  useCancelSubscription,
  usePauseSubscription,
  useResumeSubscription,
  useSubscriptions,
} from "../composables/useSubscriptions";

interface SubRow {
  id: string;
  customerId: string;
  customerName: string | null;
  packageCode: string;
  packageValueSatang: number;
  frequency: string;
  status: "active" | "paused" | "cancelled";
  latestRoundName: string | null;
  substitutionMade: boolean;
}

const { data: subs, isLoading, isError } = useSubscriptions();
const pause = usePauseSubscription();
const resume = useResumeSubscription();
const cancel = useCancelSubscription();

const rows = computed<SubRow[]>(() => (subs.value ?? []) as unknown as SubRow[]);
const activeCount = computed(() => rows.value.filter((s) => s.status === "active").length);

function baht(satang: number): string {
  return (satang / 100).toLocaleString("th-TH");
}
const FREQUENCY_TH: Record<string, string> = {
  weekly: "รายสัปดาห์",
  biweekly: "ทุก 2 สัปดาห์",
  monthly: "รายเดือน",
};

const columns: ColumnDef<SubRow, unknown>[] = [
  { accessorKey: "customerName", header: "สมาชิก" },
  { id: "package", header: "แพ็กเกจ" },
  { id: "frequency", header: "ความถี่" },
  { id: "latestRoundName", header: "รอบล่าสุด" },
  { id: "status", header: "สถานะ", accessorKey: "status" },
];

// ── Cancel-confirm modal (destructive) ───────────────────────────────────────
const cancelTarget = ref<SubRow | null>(null);
const actionError = ref<string | null>(null);

async function doPause(row: SubRow): Promise<void> {
  actionError.value = null;
  try {
    await pause.mutateAsync(row.id);
  } catch {
    actionError.value = "หยุดสมาชิกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
async function doResume(row: SubRow): Promise<void> {
  actionError.value = null;
  try {
    await resume.mutateAsync(row.id);
  } catch {
    actionError.value = "กลับมารับต่อไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
async function confirmCancel(): Promise<void> {
  if (!cancelTarget.value) return;
  actionError.value = null;
  try {
    await cancel.mutateAsync(cancelTarget.value.id);
  } catch {
    actionError.value = "ยกเลิกสมาชิกไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  } finally {
    cancelTarget.value = null;
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">สมาชิกกล่องผัก</h1>
      <span class="text-[14px] text-muted">{{ activeCount }} สมาชิกที่ยังรับกล่อง</span>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดรายชื่อสมาชิกไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>
    <p v-if="actionError" class="mb-md text-[14px] text-destructive">{{ actionError }}</p>

    <!-- empty state (UI-SPEC copy) -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีสมาชิกกล่องผัก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อลูกค้าสมัครสมาชิก รายการและรอบที่จะสร้างอัตโนมัติจะแสดงที่นี่
      </p>
    </div>

    <!-- roster table -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:package="{ row }">
        <span class="font-semibold text-ink">{{ (row as SubRow).packageCode }}</span>
        <span class="ml-sm text-[13px] text-muted">฿{{ baht((row as SubRow).packageValueSatang) }}</span>
      </template>

      <template #cell:frequency="{ row }">
        {{ FREQUENCY_TH[(row as SubRow).frequency] ?? (row as SubRow).frequency }}
      </template>

      <template #cell:latestRoundName="{ row }">
        <span v-if="(row as SubRow).latestRoundName">{{ (row as SubRow).latestRoundName }}</span>
        <span v-else class="text-muted">—</span>
        <span
          v-if="(row as SubRow).substitutionMade"
          class="ml-sm rounded-full bg-warning-surface px-sm py-[2px] text-[12px] font-semibold text-warning"
          title="กล่องรอบล่าสุดมีการปรับผักแทนชนิดที่หมด"
        >
          ปรับผักแล้ว
        </span>
      </template>

      <template #cell:status="{ row }">
        <span
          v-if="(row as SubRow).status === 'active'"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          กำลังรับกล่อง
        </span>
        <span
          v-else-if="(row as SubRow).status === 'paused'"
          class="rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-neutral"
        >
          หยุดชั่วคราว
        </span>
        <span
          v-else
          class="rounded-full bg-negative-surface px-sm py-[2px] text-[12px] font-semibold text-destructive"
        >
          ยกเลิกแล้ว
        </span>
      </template>

      <template #row-actions="{ row }">
        <template v-if="(row as SubRow).status === 'active'">
          <button
            type="button"
            :disabled="pause.isPending.value"
            class="h-8 rounded-md bg-accent px-md text-[14px] font-semibold text-white disabled:opacity-60"
            @click="doPause(row as SubRow)"
          >
            หยุดชั่วคราว
          </button>
          <button
            type="button"
            class="ml-md text-[14px] text-destructive hover:underline"
            @click="cancelTarget = row as SubRow"
          >
            ยกเลิกสมาชิก
          </button>
        </template>
        <template v-else-if="(row as SubRow).status === 'paused'">
          <button
            type="button"
            :disabled="resume.isPending.value"
            class="h-8 rounded-md bg-accent px-md text-[14px] font-semibold text-white disabled:opacity-60"
            @click="doResume(row as SubRow)"
          >
            กลับมารับต่อ
          </button>
          <button
            type="button"
            class="ml-md text-[14px] text-destructive hover:underline"
            @click="cancelTarget = row as SubRow"
          >
            ยกเลิกสมาชิก
          </button>
        </template>
        <span v-else class="text-[14px] text-muted">—</span>
      </template>
    </DataTable>

    <!-- Cancel-confirm modal (destructive on the right, neutral dismiss left) -->
    <div
      v-if="cancelTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="cancelTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ยกเลิกสมาชิก</h2>
        <p class="mb-lg text-[16px] text-ink">
          ยกเลิกกล่องผักของสมาชิก "{{ cancelTarget.customerName ?? "รายนี้" }}" ใช่ไหม? รอบถัดไปจะไม่ถูกสร้าง
        </p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="cancelTarget = null"
          >
            ไม่ใช่
          </button>
          <button
            type="button"
            :disabled="cancel.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmCancel"
          >
            ยืนยันยกเลิก
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
