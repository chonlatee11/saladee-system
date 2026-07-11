<script setup lang="ts">
// B2B account approvals (CUST-02 / D-08). The staff sees the B2B roster (a
// DataTable with a status badge per account), approves an applicant with the one
// primary action ("อนุมัติบัญชี B2B" — accent), or rejects it through a destructive
// confirm modal (UI-SPEC §Destructive confirmations). Approved accounts show a
// positive badge; only an approved account may see wholesale prices (server-gated).
// Empty state per UI-SPEC copy.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { useApproveB2b, useB2bCustomers, useRejectB2b } from "../composables/useB2b";

interface B2bRow {
  id: string;
  name: string | null;
  phone: string | null;
  b2bStatus: "pending" | "approved" | "rejected";
  creditTerms: string | null;
}

const { data: customers, isLoading, isError } = useB2bCustomers();
const approve = useApproveB2b();
const reject = useRejectB2b();

const rows = computed<B2bRow[]>(() => (customers.value ?? []) as unknown as B2bRow[]);
const pendingCount = computed(() => rows.value.filter((c) => c.b2bStatus === "pending").length);

const columns: ColumnDef<B2bRow, unknown>[] = [
  { accessorKey: "name", header: "ชื่อลูกค้า" },
  { accessorKey: "phone", header: "เบอร์โทร" },
  { id: "b2bStatus", header: "สถานะ", accessorKey: "b2bStatus" },
  { accessorKey: "creditTerms", header: "เงื่อนไขเครดิต" },
];

// ── Reject-confirm modal (destructive) ───────────────────────────────────────
const rejectTarget = ref<B2bRow | null>(null);
const actionError = ref<string | null>(null);

async function doApprove(row: B2bRow): Promise<void> {
  actionError.value = null;
  try {
    await approve.mutateAsync(row.id);
  } catch {
    actionError.value = "อนุมัติบัญชีไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
async function confirmReject(): Promise<void> {
  if (!rejectTarget.value) return;
  actionError.value = null;
  try {
    await reject.mutateAsync(rejectTarget.value.id);
  } catch {
    actionError.value = "ปฏิเสธบัญชีไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  } finally {
    rejectTarget.value = null;
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">อนุมัติ B2B</h1>
      <span class="text-[14px] text-muted">{{ pendingCount }} คำขอรออนุมัติ</span>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดรายชื่อบัญชี B2B ไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>
    <p v-if="actionError" class="mb-md text-[14px] text-destructive">{{ actionError }}</p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ไม่มีคำขอสมัคร B2B ที่รออนุมัติ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        คำขอใหม่จากลูกค้าจะแสดงที่นี่เพื่อรออนุมัติ
      </p>
    </div>

    <!-- roster table -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:b2bStatus="{ row }">
        <span
          v-if="(row as B2bRow).b2bStatus === 'approved'"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          อนุมัติแล้ว
        </span>
        <span
          v-else-if="(row as B2bRow).b2bStatus === 'rejected'"
          class="rounded-full bg-negative-surface px-sm py-[2px] text-[12px] font-semibold text-destructive"
        >
          ปฏิเสธแล้ว
        </span>
        <span
          v-else
          class="rounded-full bg-warning-surface px-sm py-[2px] text-[12px] font-semibold text-warning"
        >
          รออนุมัติ
        </span>
      </template>

      <template #row-actions="{ row }">
        <template v-if="(row as B2bRow).b2bStatus === 'pending'">
          <button
            type="button"
            :disabled="approve.isPending.value"
            class="h-8 rounded-md bg-accent px-md text-[14px] font-semibold text-white disabled:opacity-60"
            @click="doApprove(row as B2bRow)"
          >
            อนุมัติบัญชี B2B
          </button>
          <button
            type="button"
            class="ml-md text-[14px] text-destructive hover:underline"
            @click="rejectTarget = row as B2bRow"
          >
            ปฏิเสธ
          </button>
        </template>
        <span v-else class="text-[14px] text-muted">—</span>
      </template>
    </DataTable>

    <!-- Reject-confirm modal (destructive on the right, neutral dismiss left) -->
    <div
      v-if="rejectTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="rejectTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ปฏิเสธบัญชี B2B</h2>
        <p class="mb-lg text-[16px] text-ink">
          ปฏิเสธคำขอของ "{{ rejectTarget.name ?? "ลูกค้า" }}" ใช่ไหม? ลูกค้าจะไม่เห็นราคาส่ง
        </p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="rejectTarget = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="reject.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmReject"
          >
            ปฏิเสธ
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
