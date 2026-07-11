<script setup lang="ts">
// Sales reports / analytics (03-11 / MKT-04, D-24). A filter strip (period · channel
// · product · round) over ONE staff-gated aggregate (useReports → GET /reports)
// feeding four charts — sales by channel, best-sellers, repeat customers vs total,
// AOV — plus a "ส่งออก CSV" primary action. Money arrives as integer satang and is
// formatted to baht only here (display seam, D-13). CSV is built with papaparse
// `unparse` (RFC-4180 escaping — Thai product names / commas / quotes / newlines
// are handled by the library; NEVER a hand-rolled join — D-24 / T-03-30). States
// per UI-SPEC: loading · populated · no-data-in-range empty · error.
import Papa from "papaparse";
import { computed, ref } from "vue";
import ReportChart from "../components/ReportChart.vue";
import { useVarieties } from "../composables/useCrop";
import { useRounds } from "../composables/usePacking";
import {
  CHANNEL_COLORS,
  type Channel,
  capSeries,
  categoricalColor,
  type ReportsFilters,
  useReports,
} from "../composables/useReports";

const filters = ref<ReportsFilters>({ from: "", to: "", channel: "", product: "", round: "" });

const { data, isLoading, isError, isFetching } = useReports(filters);
const { data: varieties } = useVarieties();
const { data: rounds } = useRounds();

interface SeriesRow {
  key: string;
  label: string;
  valueSatang: number;
  count: number;
}
interface BestSeller {
  varietyId: string;
  variety: string;
  qty: number;
  valueSatang: number;
}

const report = computed(() => data.value ?? null);
const series = computed<SeriesRow[]>(() => (report.value?.series ?? []) as unknown as SeriesRow[]);
const bestSellers = computed<BestSeller[]>(
  () => (report.value?.bestSellers ?? []) as unknown as BestSeller[],
);

// A range has data when there is at least one realised order.
const hasData = computed(() => (report.value?.orderCount ?? 0) > 0);

/** Integer satang → whole-baht string. */
function baht(satang: number): string {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(
    Math.round(satang / 100),
  );
}
function num(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}

// ── Chart 1: sales by channel (fixed channel↔color) ───────────────────────────
const channelChart = computed(() => ({
  labels: series.value.map((s) => s.label),
  values: series.value.map((s) => s.valueSatang),
  colors: series.value.map((s) => CHANNEL_COLORS[s.key as Channel] ?? "#9AA69A"),
}));

// ── Chart 2: best-sellers by quantity (cap 6 → "อื่น ๆ") ──────────────────────
const bestChart = computed(() => {
  const capped = capSeries(bestSellers.value.map((b) => ({ label: b.variety, value: b.qty })));
  return {
    labels: capped.map((p) => p.label),
    values: capped.map((p) => p.value),
    colors: capped.map((_, i) => categoricalColor(i)),
  };
});

// ── Chart 3: repeat vs one-time customers ─────────────────────────────────────
const repeatChart = computed(() => {
  const repeat = report.value?.repeatCustomers ?? 0;
  const total = report.value?.orderCount ?? 0;
  const oneTime = Math.max(total - repeat, 0);
  return {
    labels: ["ลูกค้าซื้อซ้ำ", "ซื้อครั้งเดียว"],
    values: [repeat, oneTime],
    colors: ["#2E7D32", "#9AA69A"],
  };
});

// ── CSV export via papaparse (Thai-safe escaping — never hand-rolled) ──────────
function exportCsv() {
  const rows = [
    ["ประเภทรายงาน", "รายการ", "จำนวน", "มูลค่า (บาท)"],
    ...series.value.map((s) => ["ยอดขายตามช่องทาง", s.label, String(s.count), baht(s.valueSatang)]),
    ...bestSellers.value.map((b) => ["สินค้าขายดี", b.variety, String(b.qty), baht(b.valueSatang)]),
    ["สรุป", "ลูกค้าซื้อซ้ำ", String(report.value?.repeatCustomers ?? 0), ""],
    ["สรุป", "มูลค่าเฉลี่ยต่อออเดอร์ (AOV)", "", baht(report.value?.aovSatang ?? 0)],
    [
      "สรุป",
      "ยอดขายรวม",
      String(report.value?.orderCount ?? 0),
      baht(report.value?.totalSatang ?? 0),
    ],
  ];
  const csv = Papa.unparse(rows);
  // BOM so Excel opens Thai UTF-8 correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saladee-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section>
    <div class="mb-lg flex items-center justify-between gap-md">
      <h1 class="text-[28px] font-semibold">รายงาน</h1>
      <button
        type="button"
        :disabled="!hasData"
        class="flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        @click="exportCsv"
      >
        ส่งออก CSV
      </button>
    </div>

    <!-- Filter strip: period · channel · product · round -->
    <div class="mb-lg flex flex-wrap items-end gap-md rounded-lg border border-hairline bg-surface p-md">
      <label class="flex flex-col gap-xs text-[13px] text-muted">
        ตั้งแต่วันที่
        <input
          v-model="filters.from"
          type="date"
          class="h-9 rounded-md border border-hairline bg-canvas px-sm text-[14px] text-ink"
        />
      </label>
      <label class="flex flex-col gap-xs text-[13px] text-muted">
        ถึงวันที่
        <input
          v-model="filters.to"
          type="date"
          class="h-9 rounded-md border border-hairline bg-canvas px-sm text-[14px] text-ink"
        />
      </label>
      <label class="flex flex-col gap-xs text-[13px] text-muted">
        ช่องทาง
        <select
          v-model="filters.channel"
          class="h-9 rounded-md border border-hairline bg-canvas px-sm text-[14px] text-ink"
        >
          <option value="">ทุกช่องทาง</option>
          <option value="b2c">ค้าปลีก (B2C)</option>
          <option value="b2b">ค้าส่ง (B2B)</option>
          <option value="subscription">สมาชิก (Subscription)</option>
        </select>
      </label>
      <label class="flex flex-col gap-xs text-[13px] text-muted">
        สินค้า
        <select
          v-model="filters.product"
          class="h-9 rounded-md border border-hairline bg-canvas px-sm text-[14px] text-ink"
        >
          <option value="">ทุกสินค้า</option>
          <option v-for="v in varieties ?? []" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-xs text-[13px] text-muted">
        รอบ
        <select
          v-model="filters.round"
          class="h-9 rounded-md border border-hairline bg-canvas px-sm text-[14px] text-ink"
        >
          <option value="">ทุกรอบ</option>
          <option v-for="r in rounds ?? []" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <span v-if="isFetching" class="pb-2 text-[13px] text-muted">กำลังโหลด…</span>
    </div>

    <!-- error -->
    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดข้อมูลรายงานไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- loading skeleton -->
    <div v-else-if="isLoading" class="grid grid-cols-1 gap-lg lg:grid-cols-2">
      <div
        v-for="i in 4"
        :key="i"
        class="h-[340px] animate-pulse rounded-lg border border-hairline bg-surface"
      />
    </div>

    <!-- no data in range → empty state (UI-SPEC copy) -->
    <div
      v-else-if="!hasData"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ไม่มีข้อมูลในช่วงที่เลือก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        ลองขยายช่วงเวลาหรือเปลี่ยนตัวกรองช่องทาง/สินค้า
      </p>
    </div>

    <!-- populated -->
    <div v-else class="flex flex-col gap-lg">
      <!-- Summary cards: AOV + totals -->
      <div class="grid grid-cols-1 gap-lg sm:grid-cols-3">
        <article class="rounded-lg border border-hairline bg-canvas p-lg">
          <p class="mb-sm text-[14px] text-muted">ยอดขายรวม</p>
          <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
            ฿{{ baht(report?.totalSatang ?? 0) }}
          </p>
        </article>
        <article class="rounded-lg border border-hairline bg-canvas p-lg">
          <p class="mb-sm text-[14px] text-muted">มูลค่าเฉลี่ยต่อออเดอร์ (AOV)</p>
          <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
            ฿{{ baht(report?.aovSatang ?? 0) }}
          </p>
        </article>
        <article class="rounded-lg border border-hairline bg-canvas p-lg">
          <p class="mb-sm text-[14px] text-muted">จำนวนออเดอร์</p>
          <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
            {{ num(report?.orderCount ?? 0) }}
            <span class="text-[14px] font-normal text-muted">รายการ</span>
          </p>
        </article>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-1 gap-lg lg:grid-cols-2">
        <div class="rounded-lg border border-hairline bg-canvas p-lg">
          <ReportChart
            type="bar"
            title="ยอดขายตามช่องทาง"
            :labels="channelChart.labels"
            :values="channelChart.values"
            :colors="channelChart.colors"
            series-label="ยอดขาย (บาท)"
            :format="baht"
          />
        </div>
        <div class="rounded-lg border border-hairline bg-canvas p-lg">
          <ReportChart
            type="bar"
            title="สินค้าขายดี (ตามจำนวน)"
            :labels="bestChart.labels"
            :values="bestChart.values"
            :colors="bestChart.colors"
            series-label="จำนวนที่ขาย"
          />
        </div>
        <div class="rounded-lg border border-hairline bg-canvas p-lg">
          <ReportChart
            type="pie"
            title="ลูกค้าซื้อซ้ำ"
            :labels="repeatChart.labels"
            :values="repeatChart.values"
            :colors="repeatChart.colors"
          />
        </div>
        <div class="rounded-lg border border-hairline bg-canvas p-lg">
          <ReportChart
            type="bar"
            title="มูลค่าตามช่องทาง"
            :labels="channelChart.labels"
            :values="channelChart.values"
            :colors="channelChart.colors"
            series-label="มูลค่า (บาท)"
            :format="baht"
          />
        </div>
      </div>
    </div>
  </section>
</template>
