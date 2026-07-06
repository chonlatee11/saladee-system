<script setup lang="ts">
// ติดตามออเดอร์ — member order history + reorder (02-09, CUST-04 / LINE-02 / D-19/D-20).
// Entered from the Rich Menu "ติดตามออเดอร์" (/orders). MEMBER-ONLY: a guest (no
// session token) sees the login gate; a logged-in member sees their own orders with
// status badges and a per-order "สั่งซ้ำ" (reorder) action.
//
// Reorder calls POST /me/orders/:id/reorder — the server RE-PRICES at the current
// round and flags sold-out/absent items (D-20) — then loads the returned proposed
// cart into the store, surfaces the unavailable warning, and routes to /checkout for
// confirmation. It never blindly duplicates the old order.
//
// State inventory (UI-SPEC): async — the loading state is owned by the App.vue
// <Suspense> fallback; this screen owns guest-gate · has-items · empty · error.
// A `sessionToken` + `loader`/`reorderFn` are injectable so the view test runs
// DOM-free with mocked data (mirrors the 02-05 CatalogView test pattern).
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { ensureLineLogin, getSessionToken } from "../liff";
import { applyReorderToCart, type ReorderResponse } from "../lib/reorder";
import { orderStatusBadgeClass, orderStatusLabel } from "../lib/order-status";
import { useCart } from "../stores/cart";
import BusyOverlay from "../components/BusyOverlay.vue";
import EmptyState from "../components/EmptyState.vue";

interface OrderSummary {
  id: string;
  status: string;
  tier: string;
  totalSatang: number;
  createdAt: string;
}
interface HistoryResult {
  data: { orders: OrderSummary[] } | null;
  error: unknown | null;
}
interface ReorderResult {
  data: ReorderResponse | null;
  error: unknown | null;
}

const props = defineProps<{
  sessionToken?: string | null;
  loader?: () => Promise<HistoryResult>;
  reorderFn?: (id: string) => Promise<ReorderResult>;
}>();

const router = useRouter();
const cart = useCart();

// The member session token (injectable for tests; else read from storage).
const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);

function authHeaders() {
  return { authorization: `Bearer ${token ?? ""}` };
}

const defaultLoader = (): Promise<HistoryResult> =>
  api.me.orders.get({ headers: authHeaders() }) as unknown as Promise<HistoryResult>;
const defaultReorder = (id: string): Promise<ReorderResult> =>
  (api.me.orders({ id }).reorder.post({}, { headers: authHeaders() }) as unknown) as Promise<ReorderResult>;

// Async setup: only members fetch. Guests short-circuit to the login gate below.
let errored = false;
let orders: OrderSummary[] = [];
if (isMember) {
  const res = await (props.loader ?? defaultLoader)().catch(
    () => ({ data: null, error: { network: true } }) as HistoryResult,
  );
  errored = res.error != null;
  orders = res.data?.orders ?? [];
}
const isEmpty = isMember && !errored && orders.length === 0;

const reorderMessage = ref<string | null>(null);
const reorderBusy = ref(false);

function baht(satang: number): string {
  return `฿${Math.round(satang / 100)}`;
}

async function onLogin(): Promise<void> {
  await ensureLineLogin();
}

async function onReorder(id: string): Promise<void> {
  if (reorderBusy.value) return;
  reorderBusy.value = true;
  reorderMessage.value = null;
  try {
    const res = await (props.reorderFn ?? defaultReorder)(id);
    if (res.error != null || !res.data) {
      reorderMessage.value = "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง";
      return;
    }
    const { message } = applyReorderToCart(res.data, cart);
    reorderMessage.value = message;
    await router.push("/checkout");
  } finally {
    reorderBusy.value = false;
  }
}
</script>

<template>
  <section class="p-md">
    <!-- Blocks input while a reorder resolves stock/prices and routes to checkout. -->
    <BusyOverlay :show="reorderBusy" label="กำลังเตรียมคำสั่งซื้อ…" />
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">ติดตามออเดอร์</h1>

    <!-- Guest gate (D-19): history + reorder need a LINE login. -->
    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อดูประวัติ"
      body="ประวัติและการสั่งซ้ำใช้ได้เมื่อเข้าสู่ระบบด้วย LINE"
    >
      <button
        type="button"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
        @click="onLogin"
      >
        เข้าสู่ระบบด้วย LINE
      </button>
    </EmptyState>

    <!-- Error -->
    <div
      v-else-if="errored"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <!-- Empty (member, no orders) -->
    <EmptyState
      v-else-if="isEmpty"
      heading="ยังไม่มีคำสั่งซื้อ"
      body="เริ่มสั่งผักสลัดสดรอบนี้ได้เลย แล้วประวัติจะแสดงที่นี่"
    >
      <RouterLink
        to="/"
        class="rounded-lg bg-accent px-lg py-sm text-[16px] font-semibold text-white"
      >
        สั่งผักรอบนี้
      </RouterLink>
    </EmptyState>

    <!-- Member order list -->
    <template v-else>
      <p
        v-if="reorderMessage"
        class="mb-md rounded-lg bg-destructive/10 px-md py-sm text-[15px] text-destructive"
        role="alert"
      >
        {{ reorderMessage }}
      </p>
      <ul class="flex flex-col gap-md">
        <li
          v-for="o in orders"
          :key="o.id"
          class="rounded-xl border border-border p-md"
        >
          <div class="flex items-center justify-between gap-md">
            <RouterLink
              :to="`/orders/${o.id}`"
              class="text-[16px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              คำสั่งซื้อ #{{ o.id.slice(0, 8) }}
            </RouterLink>
            <span
              class="rounded-full px-sm py-[2px] text-[13px] font-medium"
              :class="orderStatusBadgeClass(o.status)"
            >
              {{ orderStatusLabel(o.status) }}
            </span>
          </div>
          <div class="mt-sm flex items-center justify-between gap-md">
            <span class="text-[15px] text-muted">รวม {{ baht(o.totalSatang) }}</span>
            <button
              type="button"
              class="rounded-lg bg-accent px-md py-sm text-[15px] font-semibold text-white disabled:opacity-60"
              :disabled="reorderBusy"
              @click="onReorder(o.id)"
            >
              สั่งซ้ำ
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
