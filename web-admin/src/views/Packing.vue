<script setup lang="ts">
// Packing queue (ORD-03 / D-20 / D-21, 03-09). The packer's screen: pick a round,
// see its PAID orders grouped by round → route (deliveryMethod/deliveryZone), print
// the round's pack slip + a per-order label as Thai (Sarabun) PDFs, and mark each
// order packed (flips its to-pack/packed badge). The server packing endpoints are
// packer-gated (requireRole owner/admin/packer, D-19) — this view is cosmetic RBAC.
//
// Grouping is nested (round → route) so a plain DataTable can't own the whole shape;
// each route gets its own DataTable of orders while the round/route headers frame it.
// Single accent per page (UI-SPEC): the header "พิมพ์ใบแพ็ค (PDF)" is the one filled
// primary; mark-packed is a bordered action and label-print a muted link.
import type { ColumnDef } from "@tanstack/vue-table";
import { computed, ref, watch } from "vue";
import DataTable from "../components/DataTable.vue";
import {
  openLabelSlip,
  openPackSlip,
  useMarkPacked,
  usePackingQueue,
  useRounds,
} from "../composables/usePacking";

interface QueueOrder {
  id: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  deliveryMethod: string | null;
  deliveryZone: string | null;
  subtotalSatang: number;
  deliveryFeeSatang: number | null;
  packedAt: string | null;
}
interface QueueRoute {
  deliveryMethod: string | null;
  deliveryZone: string | null;
  orders: QueueOrder[];
}
interface QueueGroup {
  roundId: string;
  roundName: string;
  routes: QueueRoute[];
}
interface RoundRow {
  id: string;
  name: string;
}

// ── Round selector (feeds the queue) ─────────────────────────────────────────
const { data: roundsData } = useRounds();
const roundOptions = computed<RoundRow[]>(
  () => (roundsData.value ?? []) as unknown as RoundRow[],
);
const roundId = ref<string | undefined>(undefined);
// Default to the first round once the list loads (only if nothing picked yet).
watch(
  roundOptions,
  (list) => {
    if (!roundId.value && list.length > 0) roundId.value = list[0]?.id;
  },
  { immediate: true },
);

// ── Queue for the chosen round ───────────────────────────────────────────────
const { data: queueData, isLoading, isError } = usePackingQueue(roundId);
const groups = computed<QueueGroup[]>(
  () => (queueData.value ?? []) as unknown as QueueGroup[],
);
const hasOrders = computed(() =>
  groups.value.some((g) => g.routes.some((r) => r.orders.length > 0)),
);

// Human label for a route (method + zone) used in the section header.
const METHOD_LABEL: Record<string, string> = {
  delivery: "จัดส่ง",
  pickup: "รับเอง",
};
function routeLabel(r: QueueRoute): string {
  const method = r.deliveryMethod ? (METHOD_LABEL[r.deliveryMethod] ?? r.deliveryMethod) : "ไม่ระบุวิธีส่ง";
  const zone = r.deliveryZone ?? "ไม่ระบุโซน";
  return `${method} · ${zone}`;
}

// ── mark-packed + PDF actions ────────────────────────────────────────────────
const markPacked = useMarkPacked();
const actionError = ref<string | null>(null);

async function onMarkPacked(orderId: string): Promise<void> {
  actionError.value = null;
  try {
    await markPacked.mutateAsync(orderId);
  } catch {
    actionError.value = "ทำเครื่องหมายว่าแพ็คแล้วไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
async function onPrintPackSlip(): Promise<void> {
  if (!roundId.value) return;
  actionError.value = null;
  try {
    await openPackSlip(roundId.value);
  } catch {
    actionError.value = "เปิดใบแพ็ค (PDF) ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
async function onPrintLabel(orderId: string): Promise<void> {
  actionError.value = null;
  try {
    await openLabelSlip(orderId);
  } catch {
    actionError.value = "เปิดป้ายส่ง (PDF) ไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}

// Columns for the per-route order table (row-actions slot carries the buttons).
const columns: ColumnDef<QueueOrder, unknown>[] = [
  { id: "recipient", header: "ผู้รับ", accessorFn: (o) => o.recipientName ?? "—" },
  { id: "phone", header: "โทร", accessorFn: (o) => o.recipientPhone ?? "—" },
  { id: "address", header: "ที่อยู่", accessorFn: (o) => o.recipientAddress ?? "—" },
  { id: "packed", header: "สถานะ", accessorKey: "packedAt" },
];
</script>

<template>
  <section>
    <div class="mb-lg flex flex-wrap items-center justify-between gap-md">
      <h1 class="text-[28px] font-semibold">คิวแพ็ค</h1>
      <div class="flex items-center gap-sm">
        <label class="flex items-center gap-xs">
          <span class="text-[14px] text-muted">รอบส่ง</span>
          <select
            v-model="roundId"
            class="h-10 rounded-md border border-hairline px-sm text-[15px] outline-none focus:border-accent"
          >
            <option v-for="r in roundOptions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <button
          type="button"
          :disabled="!roundId || !hasOrders"
          class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          @click="onPrintPackSlip"
        >
          พิมพ์ใบแพ็ค (PDF)
        </button>
      </div>
    </div>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดคิวแพ็คไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>
    <p v-if="actionError" class="mb-md text-[14px] text-destructive">{{ actionError }}</p>

    <p class="mb-md text-[14px] text-muted">
      รายการที่จ่ายเงินแล้วในรอบนี้ จัดกลุ่มตามเส้นทางส่ง — พิมพ์ใบแพ็ค/ป้ายส่งแล้วทำเครื่องหมายเมื่อแพ็คเสร็จ
    </p>

    <!-- loading -->
    <DataTable
      v-if="isLoading"
      :columns="columns"
      :data="[]"
      :loading="true"
    />

    <!-- empty: nothing to pack (UI-SPEC copy) -->
    <div
      v-else-if="!hasOrders"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีรายการที่ต้องแพ็ค</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อถึงรอบแพ็ค รายการที่จ่ายเงินแล้วจะจัดกลุ่มตามเส้นทางส่งที่นี่
      </p>
    </div>

    <!-- queue: round → route groups -->
    <template v-else>
      <div v-for="g in groups" :key="g.roundId" class="mb-xl">
        <h2 class="mb-md text-[20px] font-semibold text-ink">{{ g.roundName }}</h2>
        <div v-for="route in g.routes" :key="`${g.roundId}:${route.deliveryMethod}:${route.deliveryZone}`" class="mb-lg">
          <div class="mb-sm flex items-center gap-sm">
            <span class="text-[15px] font-semibold text-ink">{{ routeLabel(route) }}</span>
            <span class="rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-muted">
              {{ route.orders.length }} ออเดอร์
            </span>
          </div>

          <DataTable :columns="columns" :data="route.orders">
            <template #cell:packed="{ row }">
              <span
                v-if="(row as QueueOrder).packedAt"
                class="rounded-full bg-positive-surface px-sm py-[2px] text-[12px] font-semibold text-positive"
              >
                แพ็คแล้ว
              </span>
              <span
                v-else
                class="rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-muted"
              >
                รอแพ็ค
              </span>
            </template>

            <template #row-actions="{ row }">
              <button
                v-if="!(row as QueueOrder).packedAt"
                type="button"
                :disabled="markPacked.isPending.value"
                class="rounded-md border border-hairline px-md py-[6px] text-[14px] text-ink hover:border-accent disabled:opacity-60"
                @click="onMarkPacked((row as QueueOrder).id)"
              >
                ทำเครื่องหมายว่าแพ็คแล้ว
              </button>
              <button
                type="button"
                class="ml-md text-[14px] text-muted hover:text-ink"
                @click="onPrintLabel((row as QueueOrder).id)"
              >
                ป้ายส่ง (PDF)
              </button>
            </template>
          </DataTable>
        </div>
      </div>
    </template>
  </section>
</template>
