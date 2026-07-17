<script setup lang="ts">
// Coupon composer (04-03 / MKT-01). The staff creates discount coupons and sees the
// roster in a DataTable, then deactivates one through a destructive confirm dialog
// (UI-SPEC §Destructive confirmations). ONE accent primary CTA — "สร้างคูปอง"; every
// other control stays neutral. The server requireRole("owner","admin") is the real
// authority (T-04-10); the Bearer here just lets the staff request through. Money is
// edited in baht for humans and sent as the coupon POLICY only — the redemption math
// lives server-side (services/coupon.ts). Empty-state copy per UI-SPEC.
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import { api } from "../api";
import DataTable from "../components/DataTable.vue";
import { useSession } from "../stores/session";

interface CouponRow {
  id: string;
  code: string;
  discountKind: "percent" | "baht";
  discountValue: number;
  minSubtotalSatang: number;
  globalLimit: number | null;
  globalUsed: number;
  active: boolean;
  expiresAt: string | null;
}

function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

const qc = useQueryClient();

const { data, isLoading, isError } = useQuery({
  queryKey: ["coupons"],
  queryFn: async () => {
    const { data, error } = await api.coupons.get({ headers: authHeaders() });
    if (error) throw error;
    return data as unknown as { coupons: CouponRow[] };
  },
});

const rows = computed<CouponRow[]>(() => data.value?.coupons ?? []);

const columns: ColumnDef<CouponRow, unknown>[] = [
  { accessorKey: "code", header: "โค้ด" },
  { id: "discount", header: "ส่วนลด", accessorKey: "discountValue" },
  { id: "minSubtotal", header: "ยอดขั้นต่ำ", accessorKey: "minSubtotalSatang", meta: { numeric: true } },
  { id: "usage", header: "การใช้งาน", accessorKey: "globalUsed", meta: { numeric: true } },
  { id: "active", header: "สถานะ", accessorKey: "active" },
];

function discountLabel(row: CouponRow): string {
  return row.discountKind === "percent" ? `${row.discountValue}%` : `${row.discountValue} บาท`;
}
function bahtLabel(satang: number): string {
  return satang > 0 ? `${Math.round(satang / 100)} บาท` : "—";
}
function usageLabel(row: CouponRow): string {
  return row.globalLimit === null ? `${row.globalUsed} / ไม่จำกัด` : `${row.globalUsed} / ${row.globalLimit}`;
}

// ── Create form (one accent CTA) ─────────────────────────────────────────────
const form = ref({
  code: "",
  discountKind: "percent" as "percent" | "baht",
  discountValue: 10,
  minSubtotalBaht: 0,
  globalLimit: "" as number | "",
  expiresAt: "",
});
const formError = ref<string | null>(null);
const createdOk = ref(false);

const create = useMutation({
  mutationFn: async () => {
    const body: Record<string, unknown> = {
      code: form.value.code.trim(),
      discountKind: form.value.discountKind,
      discountValue: form.value.discountValue,
      minSubtotalSatang: Math.round(form.value.minSubtotalBaht * 100),
    };
    if (form.value.globalLimit !== "") body.globalLimit = Number(form.value.globalLimit);
    if (form.value.expiresAt) body.expiresAt = new Date(form.value.expiresAt).toISOString();
    const { data, error } = await api.coupons.post(body, { headers: authHeaders() });
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    createdOk.value = true;
    form.value.code = "";
    qc.invalidateQueries({ queryKey: ["coupons"] });
  },
});

function validate(): boolean {
  formError.value = null;
  createdOk.value = false;
  const f = form.value;
  if (!f.code.trim()) return ((formError.value = "กรุณากรอกโค้ดคูปอง"), false);
  if (f.discountValue < 1) return ((formError.value = "ส่วนลดต้องมากกว่า 0"), false);
  if (f.discountKind === "percent" && f.discountValue > 100)
    return ((formError.value = "ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100"), false);
  if (f.minSubtotalBaht < 0) return ((formError.value = "ยอดขั้นต่ำต้องไม่ติดลบ"), false);
  return true;
}

async function submit(): Promise<void> {
  if (!validate()) return;
  try {
    await create.mutateAsync();
  } catch {
    formError.value = "สร้างคูปองไม่สำเร็จ — โค้ดอาจซ้ำหรือข้อมูลไม่ถูกต้อง";
  }
}

// ── Deactivate confirm (destructive) ─────────────────────────────────────────
const deactivateTarget = ref<CouponRow | null>(null);
const actionError = ref<string | null>(null);

const deactivate = useMutation({
  mutationFn: async (id: string) => {
    const { data, error } = await api.coupons({ id }).deactivate.patch({}, { headers: authHeaders() });
    if (error) throw error;
    return data;
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
});

async function confirmDeactivate(): Promise<void> {
  if (!deactivateTarget.value) return;
  actionError.value = null;
  try {
    await deactivate.mutateAsync(deactivateTarget.value.id);
  } catch {
    actionError.value = "ปิดใช้งานคูปองไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  } finally {
    deactivateTarget.value = null;
  }
}
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">คูปอง</h1>

    <!-- Create form — the single accent CTA lives here -->
    <form
      class="mb-xl max-w-[640px] space-y-md rounded-lg border border-hairline bg-canvas p-lg"
      @submit.prevent="submit"
    >
      <div class="grid grid-cols-2 gap-md">
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">โค้ดคูปอง</span>
          <input
            v-model="form.code"
            type="text"
            maxlength="64"
            placeholder="เช่น SALAD10"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] uppercase outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">ชนิดส่วนลด</span>
          <select
            v-model="form.discountKind"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          >
            <option value="percent">เปอร์เซ็นต์ (%)</option>
            <option value="baht">บาท</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">มูลค่าส่วนลด</span>
          <input
            v-model.number="form.discountValue"
            type="number"
            min="1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">ยอดขั้นต่ำ (บาท)</span>
          <input
            v-model.number="form.minSubtotalBaht"
            type="number"
            min="0"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">จำกัดจำนวนรวม (เว้นว่าง = ไม่จำกัด)</span>
          <input
            v-model="form.globalLimit"
            type="number"
            min="1"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] tabular outline-none focus:border-accent"
          />
        </label>
        <label class="block">
          <span class="mb-xs block text-[14px] text-muted">วันหมดอายุ (เว้นว่าง = ไม่หมดอายุ)</span>
          <input
            v-model="form.expiresAt"
            type="date"
            class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
          />
        </label>
      </div>

      <p v-if="formError" class="text-[14px] text-destructive">{{ formError }}</p>
      <p v-else-if="createdOk" class="text-[14px] text-positive">สร้างคูปองแล้ว</p>

      <button
        type="submit"
        :disabled="create.isPending.value"
        class="flex h-10 items-center justify-center gap-xs rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
      >
        <span
          v-if="create.isPending.value"
          class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
        />
        สร้างคูปอง
      </button>
    </form>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดรายการคูปองไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>
    <p v-if="actionError" class="mb-md text-[14px] text-destructive">{{ actionError }}</p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีคูปอง</p>
      <p class="max-w-[420px] text-[14px] text-muted">สร้างคูปองส่วนลดแรกเพื่อกระตุ้นยอดขาย</p>
    </div>

    <!-- coupon roster -->
    <DataTable v-else :columns="columns" :data="rows" :loading="isLoading">
      <template #cell:discount="{ row }">{{ discountLabel(row as CouponRow) }}</template>
      <template #cell:minSubtotal="{ row }">{{ bahtLabel((row as CouponRow).minSubtotalSatang) }}</template>
      <template #cell:usage="{ row }">{{ usageLabel(row as CouponRow) }}</template>
      <template #cell:active="{ row }">
        <span
          v-if="(row as CouponRow).active"
          class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
        >
          ใช้งานอยู่
        </span>
        <span
          v-else
          class="rounded-full bg-surface px-sm py-[2px] text-[12px] font-semibold text-muted"
        >
          ปิดใช้งาน
        </span>
      </template>

      <template #row-actions="{ row }">
        <button
          v-if="(row as CouponRow).active"
          type="button"
          class="text-[14px] text-destructive hover:underline"
          @click="deactivateTarget = row as CouponRow"
        >
          ปิดใช้งาน
        </button>
        <span v-else class="text-[14px] text-muted">—</span>
      </template>
    </DataTable>

    <!-- Deactivate-confirm modal (destructive confirm on the right) -->
    <div
      v-if="deactivateTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg"
      @click.self="deactivateTarget = null"
    >
      <div class="w-full max-w-[480px] rounded-lg border border-hairline bg-canvas p-xl">
        <h2 class="mb-md text-[20px] font-semibold">ปิดใช้งานคูปอง</h2>
        <p class="mb-lg text-[16px] text-ink">
          ปิดใช้งานคูปอง "{{ deactivateTarget.code }}"? ลูกค้าจะใช้โค้ดนี้ไม่ได้อีก
        </p>
        <div class="flex justify-end gap-sm">
          <button
            type="button"
            class="h-10 rounded-md border border-hairline px-lg text-[14px] text-ink"
            @click="deactivateTarget = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="deactivate.isPending.value"
            class="h-10 rounded-md bg-destructive px-lg text-[16px] font-semibold text-white disabled:opacity-60"
            @click="confirmDeactivate"
          >
            ปิดใช้งาน
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
