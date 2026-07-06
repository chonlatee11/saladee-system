<script setup lang="ts">
// รายละเอียดคำสั่งซื้อ — single-order detail (02-09). Route /orders/:id — the
// deep-link target of the 02-07 Flex status notification. MEMBER-ONLY: shows the
// order's LIVE status, line summary, delivery, and total. A guest (no session) sees
// the login gate; an order that is not the caller's returns not-found.
//
// State inventory (UI-SPEC): async — loading is owned by the App.vue <Suspense>
// fallback; this screen owns guest-gate · loaded · not-found · error. A
// `sessionToken` + `loader` are injectable for the DOM-free view test.
import { useRoute } from "vue-router";
import { api } from "../api";
import { getSessionToken } from "../liff";
import { orderStatusBadgeClass, orderStatusLabel } from "../lib/order-status";
import EmptyState from "../components/EmptyState.vue";

interface OrderLine {
  id: string;
  varietyName: string | null;
  unitLabel: string | null;
  unitPriceSatang: number | null;
  qty: number;
}
interface OrderDetail {
  order: {
    id: string;
    status: string;
    totalSatang: number;
    subtotalSatang: number;
    deliveryFeeSatang: number | null;
    deliveryMethod: string | null;
    recipientName: string | null;
    recipientAddress: string | null;
    createdAt: string;
  };
  lines: OrderLine[];
}
interface DetailResult {
  data: OrderDetail | null;
  error: { status?: number } | null;
}

const props = defineProps<{
  sessionToken?: string | null;
  id?: string;
  loader?: () => Promise<DetailResult>;
}>();

const route = useRoute();
const orderId = props.id ?? String(route.params.id ?? "");
const token = props.sessionToken !== undefined ? props.sessionToken : getSessionToken();
const isMember = Boolean(token);

const defaultLoader = (): Promise<DetailResult> =>
  api.me
    .orders({ id: orderId })
    .get({ headers: { authorization: `Bearer ${token ?? ""}` } }) as unknown as Promise<DetailResult>;

let notFound = false;
let errored = false;
let detail: OrderDetail | null = null;
if (isMember) {
  const res = await (props.loader ?? defaultLoader)().catch(
    () => ({ data: null, error: { status: 0 } }) as DetailResult,
  );
  if (res.error != null) {
    if (res.error.status === 404) notFound = true;
    else errored = true;
  } else {
    detail = res.data;
    if (!detail) notFound = true;
  }
}

function baht(satang: number): string {
  return `฿${Math.round(satang / 100)}`;
}
</script>

<template>
  <section class="p-md">
    <h1 class="mb-md text-[28px] font-semibold leading-[1.3] text-ink">รายละเอียดคำสั่งซื้อ</h1>

    <EmptyState
      v-if="!isMember"
      heading="เข้าสู่ระบบเพื่อดูประวัติ"
      body="รายละเอียดคำสั่งซื้อใช้ได้เมื่อเข้าสู่ระบบด้วย LINE"
    />

    <EmptyState
      v-else-if="notFound"
      heading="ไม่พบคำสั่งซื้อ"
      body="คำสั่งซื้อนี้อาจถูกยกเลิกหรือไม่ใช่ของบัญชีนี้"
    />

    <div
      v-else-if="errored || !detail"
      class="flex flex-col items-center gap-md py-2xl text-center"
      role="alert"
    >
      <p class="text-[16px] text-ink">เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง</p>
    </div>

    <template v-else>
      <div class="mb-md flex items-center justify-between gap-md">
        <span class="text-[15px] text-muted">#{{ detail.order.id.slice(0, 8) }}</span>
        <span
          class="rounded-full px-sm py-[2px] text-[13px] font-medium"
          :class="orderStatusBadgeClass(detail.order.status)"
        >
          {{ orderStatusLabel(detail.order.status) }}
        </span>
      </div>

      <ul class="flex flex-col gap-sm">
        <li
          v-for="l in detail.lines"
          :key="l.id"
          class="flex items-center justify-between gap-md border-b border-border pb-sm"
        >
          <span class="text-[16px] text-ink">
            {{ l.varietyName }}
            <span v-if="l.unitLabel" class="text-muted">· {{ l.unitLabel }}</span>
          </span>
          <span class="text-[15px] text-muted">
            ×{{ l.qty }}
            <span v-if="l.unitPriceSatang != null"> · {{ baht(l.unitPriceSatang * l.qty) }}</span>
          </span>
        </li>
      </ul>

      <dl class="mt-md flex flex-col gap-[4px] text-[15px]">
        <div class="flex justify-between">
          <dt class="text-muted">ยอดสินค้า</dt>
          <dd class="text-ink">{{ baht(detail.order.subtotalSatang) }}</dd>
        </div>
        <div v-if="detail.order.deliveryFeeSatang != null" class="flex justify-between">
          <dt class="text-muted">ค่าจัดส่ง</dt>
          <dd class="text-ink">{{ baht(detail.order.deliveryFeeSatang) }}</dd>
        </div>
        <div class="flex justify-between font-semibold">
          <dt class="text-ink">รวมทั้งหมด</dt>
          <dd class="text-ink">{{ baht(detail.order.totalSatang) }}</dd>
        </div>
      </dl>

      <p v-if="detail.order.recipientName" class="mt-md text-[15px] text-muted">
        ผู้รับ: {{ detail.order.recipientName }}
        <span v-if="detail.order.recipientAddress"> · {{ detail.order.recipientAddress }}</span>
      </p>
    </template>
  </section>
</template>
