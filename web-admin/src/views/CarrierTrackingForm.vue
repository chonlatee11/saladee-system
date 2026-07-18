<script setup lang="ts">
// Carrier tracking form (04-05 / DEL-05, D-22). Staff pick an order that needs
// delivery, choose a carrier (Grab / Lalamove / general) via the ONE approved
// selected-tile ring pattern (ring-2 ring-accent), enter the waybill and set the
// delivery status. Saving pushes a LINE status update to the customer (server seam).
// ONE accent primary CTA — "บันทึกเลขพัสดุ"; the current status renders as a badge
// (never a button) using the UI-SPEC binding palette. Empty-state copy per UI-SPEC.
// The server requireRole("owner","admin") is the real authority (T-04-15).
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { useSession } from "../stores/session";

type DeliveryStatus = "pending" | "handed_to_carrier" | "in_transit" | "delivered" | "failed";

interface TrackingRow {
  id: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  deliveryMethod: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  deliveryStatus: DeliveryStatus | null;
  status: string;
  createdAt: string;
}

// Binding palette (UI-SPEC §Delivery Status Enum) — rendered as a badge, not a button.
const STATUS_META: Record<DeliveryStatus, { label: string; badge: string }> = {
  pending: { label: "รอจัดส่ง", badge: "bg-neutral-surface text-muted" },
  handed_to_carrier: { label: "ส่งให้ขนส่งแล้ว", badge: "bg-warning-surface text-warning" },
  in_transit: { label: "กำลังจัดส่ง", badge: "bg-warning-surface text-warning" },
  delivered: { label: "จัดส่งสำเร็จ", badge: "bg-positive-surface text-positive" },
  failed: { label: "จัดส่งไม่สำเร็จ", badge: "bg-negative-surface text-negative" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META) as DeliveryStatus[];

// Carrier tiles — selected-tile ring pattern. "general" reveals a free-text field.
const CARRIERS = [
  { key: "Grab", label: "Grab" },
  { key: "Lalamove", label: "Lalamove" },
  { key: "general", label: "ทั่วไป / อื่นๆ" },
] as const;

function authHeaders(): Record<string, string> {
  const { state } = useSession();
  return state.token ? { authorization: `Bearer ${state.token}` } : {};
}

const qc = useQueryClient();

const { data, isLoading, isError } = useQuery({
  queryKey: ["tracking"],
  queryFn: async () => {
    const { data, error } = await api.tracking.get({ headers: authHeaders() });
    if (error) throw error;
    return data as unknown as { orders: TrackingRow[] };
  },
});

const rows = computed<TrackingRow[]>(() => data.value?.orders ?? []);

// ── Selected order + edit form ───────────────────────────────────────────────
const selectedId = ref<string | null>(null);
const selected = computed<TrackingRow | null>(
  () => rows.value.find((r) => r.id === selectedId.value) ?? null,
);

const carrierChoice = ref<(typeof CARRIERS)[number]["key"]>("Grab");
const carrierCustom = ref("");
const trackingNumber = ref("");
const deliveryStatus = ref<DeliveryStatus>("handed_to_carrier");
const formError = ref<string | null>(null);
const savedOk = ref(false);

// Prefill the form whenever a different order is picked.
watch(selected, (row) => {
  formError.value = null;
  savedOk.value = false;
  if (!row) return;
  if (row.carrier === "Grab" || row.carrier === "Lalamove") {
    carrierChoice.value = row.carrier;
    carrierCustom.value = "";
  } else if (row.carrier) {
    carrierChoice.value = "general";
    carrierCustom.value = row.carrier;
  } else {
    carrierChoice.value = "Grab";
    carrierCustom.value = "";
  }
  trackingNumber.value = row.trackingNumber ?? "";
  deliveryStatus.value = row.deliveryStatus ?? "handed_to_carrier";
});

function resolvedCarrier(): string {
  return carrierChoice.value === "general" ? carrierCustom.value.trim() : carrierChoice.value;
}

const save = useMutation({
  mutationFn: async () => {
    const orderId = selectedId.value;
    if (!orderId) throw new Error("no order selected");
    const { data, error } = await api.tracking({ orderId }).patch(
      {
        carrier: resolvedCarrier(),
        trackingNumber: trackingNumber.value.trim(),
        deliveryStatus: deliveryStatus.value,
      },
      { headers: authHeaders() },
    );
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    savedOk.value = true;
    qc.invalidateQueries({ queryKey: ["tracking"] });
  },
});

function validate(): boolean {
  formError.value = null;
  savedOk.value = false;
  if (!selectedId.value) return ((formError.value = "กรุณาเลือกคำสั่งซื้อ"), false);
  if (!resolvedCarrier()) return ((formError.value = "กรุณาเลือกหรือกรอกผู้ให้บริการขนส่ง"), false);
  if (!trackingNumber.value.trim()) return ((formError.value = "กรุณากรอกเลขพัสดุ"), false);
  return true;
}

async function submit(): Promise<void> {
  if (!validate()) return;
  try {
    await save.mutateAsync();
  } catch {
    formError.value = "บันทึกเลขพัสดุไม่สำเร็จ โปรดลองใหม่อีกครั้ง";
  }
}
</script>

<template>
  <section class="max-w-[880px]">
    <h1 class="mb-lg text-[28px] font-semibold">ติดตามพัสดุ</h1>

    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดรายการคำสั่งซื้อไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- empty state -->
    <div
      v-if="!isLoading && rows.length === 0"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีเลขพัสดุ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เลือกผู้ให้บริการขนส่งและกรอกเลขพัสดุเพื่อเริ่มติดตาม
      </p>
    </div>

    <div v-else class="grid grid-cols-1 gap-lg md:grid-cols-[1fr_1.2fr]">
      <!-- Orders needing tracking -->
      <div class="rounded-lg border border-hairline bg-canvas p-md">
        <h2 class="mb-sm text-[16px] font-semibold text-ink">คำสั่งซื้อรอจัดส่ง</h2>
        <ul class="space-y-xs">
          <li v-for="row in rows" :key="row.id">
            <button
              type="button"
              class="w-full rounded-md border px-md py-sm text-left transition"
              :class="
                selectedId === row.id
                  ? 'border-accent bg-surface'
                  : 'border-hairline hover:bg-surface'
              "
              @click="selectedId = row.id"
            >
              <div class="flex items-center justify-between gap-sm">
                <span class="truncate text-[14px] font-medium text-ink">
                  {{ row.recipientName ?? "—" }} · {{ row.id.slice(0, 8) }}
                </span>
                <span
                  v-if="row.deliveryStatus"
                  class="shrink-0 rounded-full px-sm py-[2px] text-[12px] font-semibold"
                  :class="STATUS_META[row.deliveryStatus].badge"
                >
                  {{ STATUS_META[row.deliveryStatus].label }}
                </span>
                <span
                  v-else
                  class="shrink-0 rounded-full bg-neutral-surface px-sm py-[2px] text-[12px] font-semibold text-muted"
                >
                  ยังไม่มีเลขพัสดุ
                </span>
              </div>
              <p v-if="row.trackingNumber" class="mt-[2px] text-[12px] text-muted">
                {{ row.carrier }} · {{ row.trackingNumber }}
              </p>
            </button>
          </li>
        </ul>
      </div>

      <!-- Tracking form -->
      <div class="rounded-lg border border-hairline bg-canvas p-lg">
        <div
          v-if="!selected"
          class="flex h-full items-center justify-center text-center text-[14px] text-muted"
        >
          เลือกคำสั่งซื้อทางซ้ายเพื่อบันทึกเลขพัสดุ
        </div>

        <form v-else class="space-y-md" @submit.prevent="submit">
          <!-- Carrier pick — selected-tile ring pattern -->
          <div>
            <span class="mb-xs block text-[14px] text-muted">ผู้ให้บริการขนส่ง</span>
            <div class="grid grid-cols-3 gap-sm">
              <button
                v-for="c in CARRIERS"
                :key="c.key"
                type="button"
                class="rounded-md border border-hairline px-sm py-md text-[14px] font-medium text-ink"
                :class="carrierChoice === c.key ? 'ring-2 ring-accent' : ''"
                @click="carrierChoice = c.key"
              >
                {{ c.label }}
              </button>
            </div>
            <input
              v-if="carrierChoice === 'general'"
              v-model="carrierCustom"
              type="text"
              maxlength="64"
              placeholder="ชื่อผู้ให้บริการขนส่ง"
              class="mt-sm h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            />
          </div>

          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">เลขพัสดุ</span>
            <input
              v-model="trackingNumber"
              type="text"
              maxlength="128"
              placeholder="เช่น GRB-12345"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            />
          </label>

          <label class="block">
            <span class="mb-xs block text-[14px] text-muted">สถานะการจัดส่ง</span>
            <select
              v-model="deliveryStatus"
              class="h-10 w-full rounded-md border border-hairline px-sm text-[16px] outline-none focus:border-accent"
            >
              <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">
                {{ STATUS_META[s].label }}
              </option>
            </select>
          </label>

          <!-- Current status badge (read-only reflection) -->
          <div class="flex items-center gap-sm">
            <span class="text-[14px] text-muted">สถานะปัจจุบัน:</span>
            <span
              class="rounded-full px-sm py-[2px] text-[12px] font-semibold"
              :class="STATUS_META[deliveryStatus].badge"
            >
              {{ STATUS_META[deliveryStatus].label }}
            </span>
          </div>

          <p v-if="formError" class="text-[14px] text-destructive">{{ formError }}</p>
          <p v-else-if="savedOk" class="text-[14px] text-positive">บันทึกเลขพัสดุแล้ว</p>

          <button
            type="submit"
            :disabled="save.isPending.value"
            class="flex h-10 items-center justify-center gap-xs rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:opacity-60"
          >
            <span
              v-if="save.isPending.value"
              class="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
            />
            บันทึกเลขพัสดุ
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
