<script setup lang="ts">
// B2B standing orders (CUST-05 / D-09/D-10). Staff manage the recurring per-round
// baskets of approved B2B accounts: create a basket for an approved customer (the
// one primary action "บันทึกออเดอร์ประจำ"), edit it, or cancel it (destructive
// confirm). The ACTUAL round-open reservation of these baskets runs through
// publishQuota (reserveStanding) — before B2C opens — so this screen records the
// demand and surfaces the OVERFLOW flags (destructive severity) when standing demand
// exceeds the forecast quota (D-10): the system never auto-decides. Empty state per
// UI-SPEC copy.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import DataTable from "../components/DataTable.vue";
import { useVarieties } from "../composables/useCrop";
import {
  type StandingItemInput,
  useB2bCustomers,
  useCancelStandingOrder,
  useCreateStandingOrder,
  useOverflowFlags,
  useStandingOrders,
  useUpdateStandingOrder,
} from "../composables/useB2b";

interface StandingItem {
  id: string;
  varietyId: string;
  plantsPerRound: number;
}
interface StandingRow {
  id: string;
  customerId: string;
  active: boolean;
  createdAt: string;
  items: StandingItem[];
}
interface OverflowFlag {
  id: string;
  varietyId: string;
  varietyName: string;
  shortfall: number;
  source: string;
}
interface CustomerRow {
  id: string;
  name: string | null;
  b2bStatus: "pending" | "approved" | "rejected";
}
interface VarietyRow {
  id: string;
  name: string;
}

const { data: standing, isLoading, isError } = useStandingOrders();
const { data: flags } = useOverflowFlags();
const { data: customers } = useB2bCustomers();
const { data: varieties } = useVarieties();
const createOrder = useCreateStandingOrder();
const updateOrder = useUpdateStandingOrder();
const cancelOrder = useCancelStandingOrder();

// Row shape fed to the table: StandingRow plus precomputed display labels.
interface DisplayRow extends StandingRow {
  customerLabel: string;
  basketLabel: string;
}

const overflow = computed<OverflowFlag[]>(() => (flags.value ?? []) as unknown as OverflowFlag[]);
const approvedCustomers = computed<CustomerRow[]>(() =>
  ((customers.value ?? []) as unknown as CustomerRow[]).filter((c) => c.b2bStatus === "approved"),
);
const varietyList = computed<VarietyRow[]>(() => (varieties.value ?? []) as unknown as VarietyRow[]);

const customerName = (id: string): string =>
  ((customers.value ?? []) as unknown as CustomerRow[]).find((c) => c.id === id)?.name ?? id.slice(0, 8);
const varietyName = (id: string): string =>
  varietyList.value.find((v) => v.id === id)?.name ?? id.slice(0, 8);
const totalPlants = (r: StandingRow): number =>
  r.items.reduce((sum, it) => sum + it.plantsPerRound, 0);

// Display labels are joined INTO the row data (not resolved in column accessorFn
// closures): TanStack Table memoizes accessor results per row, so a lookup living
// outside the data prop freezes the id-prefix fallback when the varieties/customers
// queries resolve after first render. Because this computed reads varieties.value
// and customers.value, a late-resolving query produces a NEW array → DataTable's
// data prop changes → the per-row value cache is rebuilt with real names.
const rows = computed<DisplayRow[]>(() =>
  ((standing.value ?? []) as unknown as StandingRow[]).map((r) => ({
    ...r,
    customerLabel: customerName(r.customerId),
    basketLabel:
      r.items.map((it) => `${varietyName(it.varietyId)} ×${it.plantsPerRound}`).join(", ") || "—",
  })),
);

const columns: ColumnDef<DisplayRow, unknown>[] = [
  { id: "customer", header: "ลูกค้า", accessorKey: "customerLabel" },
  { id: "basket", header: "ตะกร้าประจำรอบ", accessorKey: "basketLabel" },
  { id: "total", header: "รวม (ต้น/รอบ)", accessorFn: (r) => totalPlants(r), meta: { numeric: true } },
  { id: "active", header: "สถานะ", accessorKey: "active" },
];

// ── Create / edit modal (shared form) ────────────────────────────────────────
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formCustomerId = ref("");
// WR-02: rows carry a stable client-side _key so Vue keys the v-for by identity,
// not array index — splice-delete then no longer reuses the wrong row's DOM/state.
type FormRow = StandingItemInput & { _key: number };
let rowUid = 0;
function newRow(varietyId = varietyList.value[0]?.id ?? "", plantsPerRound = 0): FormRow {
  return { _key: ++rowUid, varietyId, plantsPerRound };
}
const formItems = ref<FormRow[]>([]);
const formError = ref<string | null>(null);

function openCreate(): void {
  editingId.value = null;
  formCustomerId.value = approvedCustomers.value[0]?.id ?? "";
  formItems.value = [newRow()];
  formError.value = null;
  showForm.value = true;
}
function openEdit(row: StandingRow): void {
  editingId.value = row.id;
  formCustomerId.value = row.customerId;
  formItems.value = row.items.map((it) => newRow(it.varietyId, it.plantsPerRound));
  if (formItems.value.length === 0) {
    formItems.value = [newRow()];
  }
  formError.value = null;
  showForm.value = true;
}
function addItem(): void {
  formItems.value.push(newRow());
}
function removeItem(i: number): void {
  formItems.value.splice(i, 1);
}
async function submitForm(): Promise<void> {
  formError.value = null;
  const items = formItems.value
    .filter((it) => it.varietyId && it.plantsPerRound > 0)
    .map(({ varietyId, plantsPerRound }) => ({ varietyId, plantsPerRound }));
  if (items.length === 0) {
    formError.value = "เพิ่มพันธุ์ผักและจำนวนอย่างน้อย 1 รายการ";
    return;
  }
  try {
    if (editingId.value) {
      await updateOrder.mutateAsync({ id: editingId.value, items });
    } else {
      if (!formCustomerId.value) {
        formError.value = "เลือกบัญชี B2B ที่อนุมัติแล้วก่อน";
        return;
      }
      await createOrder.mutateAsync({ customerId: formCustomerId.value, items });
    }
    showForm.value = false;
  } catch {
    formError.value = "บันทึกออเดอร์ประจำไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// ── Cancel-confirm modal (destructive) ───────────────────────────────────────
const cancelTarget = ref<StandingRow | null>(null);
async function confirmCancel(): Promise<void> {
  if (!cancelTarget.value) return;
  try {
    await cancelOrder.mutateAsync(cancelTarget.value.id);
  } finally {
    cancelTarget.value = null;
  }
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between">
      <h1 class="text-[28px] font-semibold">ออเดอร์ประจำ</h1>
      <button
        type="button"
        class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
        @click="openCreate"
      >
        บันทึกออเดอร์ประจำ
      </button>
    </div>

    <!-- Overflow flags (destructive severity, D-10) -->
    <div
      v-if="overflow.length > 0"
      class="mb-lg rounded-lg border border-destructive bg-negative-surface p-lg"
    >
      <p class="mb-sm text-[16px] font-semibold text-destructive">
        ออเดอร์ประจำรวมเกินผลผลิตที่คาดไว้รอบนี้ — เพิ่มการปลูกหรือลดออเดอร์ประจำก่อนเปิดขาย B2C
      </p>
      <ul class="list-disc pl-lg text-[14px] text-ink">
        <li v-for="f in overflow" :key="f.id">
          {{ f.varietyName }}: ขาด {{ f.shortfall }} ต้น
        </li>
      </ul>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดออเดอร์ประจำไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <p class="mb-md text-[14px] text-muted">
      ออเดอร์ประจำจะถูกจองจากผลผลิตที่คาดไว้ตอนเปิดรอบ — ก่อนเปิดขาย B2C
    </p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีออเดอร์ประจำ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        ออเดอร์ประจำของบัญชี B2B ที่อนุมัติแล้วจะถูกจองจากผลผลิตที่คาดไว้และแสดงที่นี่
      </p>
    </div>

    <!-- table -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:active="{ row }">
        <span
          v-if="(row as StandingRow).active"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          ใช้งาน
        </span>
        <span
          v-else
          class="rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-muted"
        >
          ยกเลิกแล้ว
        </span>
      </template>

      <template #row-actions="{ row }">
        <button
          type="button"
          class="text-[14px] text-muted hover:text-ink"
          @click="openEdit(row as StandingRow)"
        >
          แก้ไข
        </button>
        <button
          v-if="(row as StandingRow).active"
          type="button"
          class="ml-md text-[14px] text-destructive hover:underline"
          @click="cancelTarget = row as StandingRow"
        >
          ยกเลิก
        </button>
      </template>
    </DataTable>

    <!-- Create/Edit modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="showForm = false"
    >
      <form
        class="max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-lg border border-hairline bg-canvas p-xl"
        @submit.prevent="submitForm"
      >
        <h2 class="mb-lg text-[20px] font-semibold">
          {{ editingId ? "แก้ไขออเดอร์ประจำ" : "บันทึกออเดอร์ประจำ" }}
        </h2>

        <label v-if="!editingId" class="mb-md block">
          <span class="mb-xs block text-[14px] text-muted">บัญชี B2B (อนุมัติแล้ว)</span>
          <select
            v-model="formCustomerId"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          >
            <option v-for="c in approvedCustomers" :key="c.id" :value="c.id">
              {{ c.name ?? c.id.slice(0, 8) }}
            </option>
          </select>
        </label>

        <p class="mb-sm text-[14px] font-semibold text-ink">ตะกร้าประจำรอบ</p>
        <div v-for="(item, i) in formItems" :key="item._key" class="mb-sm flex items-end gap-sm">
          <label class="flex-1">
            <span class="mb-xs block text-[12px] text-muted">พันธุ์ผัก</span>
            <select
              v-model="item.varietyId"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[15px] outline-none focus:border-accent"
            >
              <option v-for="v in varietyList" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
          </label>
          <label class="w-[120px]">
            <span class="mb-xs block text-[12px] text-muted">จำนวน (ต้น)</span>
            <input
              v-model.number="item.plantsPerRound"
              type="number"
              min="0"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[15px] tabular outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            class="h-10 px-sm text-[14px] text-destructive hover:underline"
            :disabled="formItems.length === 1"
            @click="removeItem(i)"
          >
            ลบ
          </button>
        </div>
        <button
          type="button"
          class="mb-md text-[14px] text-muted hover:text-ink"
          @click="addItem"
        >
          + เพิ่มพันธุ์ผัก
        </button>

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
            :disabled="createOrder.isPending.value || updateOrder.isPending.value"
            class="h-10 rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            บันทึก
          </button>
        </div>
      </form>
    </div>

    <!-- Cancel-confirm modal (destructive) -->
    <div
      v-if="cancelTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="cancelTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ยกเลิกออเดอร์ประจำ</h2>
        <p class="mb-lg text-[16px] text-ink">
          ยกเลิกออเดอร์ประจำของ "{{ customerName(cancelTarget.customerId) }}" ใช่ไหม?
          รอบถัดไปจะไม่จองโควตาให้บัญชีนี้
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
            :disabled="cancelOrder.isPending.value"
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
