<script setup lang="ts">
// Owner dashboard (03-10 / ADM-01, D-23). Five at-a-glance cards fed by ONE
// staff-gated aggregate (useDashboard → GET /dashboard): the 4 criterion cards
// (ยอดขาย · ค้างชำระ · ใกล้หมดรอบ · ผลผลิตรอบหน้า) plus the B2B/subscription card
// (standing + subscription due this round + overflow warning). Money arrives as
// integer satang and is formatted to baht only here (display seam, D-13). States
// per UI-SPEC: loading skeleton · populated · no-open-round empty · error.
import { computed } from "vue";
import { useDashboard } from "../composables/useDashboard";

interface NearSoldOut {
  varietyId: string;
  variety: string;
  remaining: number;
}
interface Forecast {
  varietyId: string;
  variety: string;
  plants: number;
}
interface OverflowFlag {
  id: string;
  varietyId: string;
  variety: string;
  shortfall: number;
  source: string;
}

const { data, isLoading, isError } = useDashboard();

const summary = computed(() => data.value ?? null);
const hasOpenRound = computed(() => summary.value?.hasOpenRound === true);
const nearSoldOut = computed<NearSoldOut[]>(
  () => (summary.value?.nearSoldOut ?? []) as unknown as NearSoldOut[],
);
const forecast = computed<Forecast[]>(
  () => (summary.value?.nextRoundForecast ?? []) as unknown as Forecast[],
);
const overflow = computed<OverflowFlag[]>(
  () => (summary.value?.overflowFlags ?? []) as unknown as OverflowFlag[],
);

/** Integer satang → "1,234" baht string (whole baht; tabular display). */
function baht(satang: number): string {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(
    Math.round(satang / 100),
  );
}
function num(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">แดชบอร์ด</h1>

    <!-- error -->
    <p v-if="isError" class="mb-md text-[14px] text-destructive">
      โหลดข้อมูลแดชบอร์ดไม่สำเร็จ โปรดลองใหม่อีกครั้ง
    </p>

    <!-- loading skeleton cards -->
    <div v-if="isLoading" class="grid grid-cols-1 gap-lg sm:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="i in 5"
        :key="i"
        class="h-[132px] animate-pulse rounded-lg border border-hairline bg-surface"
      />
    </div>

    <!-- no open round → empty state (UI-SPEC copy) -->
    <div
      v-else-if="!hasOpenRound"
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีรอบขายที่เปิดอยู่</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        สร้างรอบถัดไปหรือเผยแพร่จำนวนขายจากปฏิทินเก็บเกี่ยว
      </p>
      <router-link
        to="/planting-batches"
        class="mt-sm flex h-10 items-center rounded-md bg-accent px-lg text-[16px] font-semibold text-white"
      >
        ไปที่วางแผนการปลูก
      </router-link>
    </div>

    <!-- populated -->
    <div v-else class="grid grid-cols-1 gap-lg sm:grid-cols-2 xl:grid-cols-3">
      <!-- Card 1: sales today / this round -->
      <article class="rounded-lg border border-hairline bg-canvas p-lg">
        <p class="mb-sm text-[14px] text-muted">ยอดขาย</p>
        <div class="mb-xs flex items-baseline justify-between">
          <span class="text-[14px] text-muted">วันนี้</span>
          <span class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
            <span class="text-[28px]">฿</span>{{ baht(summary?.salesTodaySatang ?? 0) }}
          </span>
        </div>
        <div class="flex items-baseline justify-between">
          <span class="text-[14px] text-muted">รอบนี้</span>
          <span class="tabular text-[20px] font-semibold text-ink">
            ฿{{ baht(summary?.salesRoundSatang ?? 0) }}
          </span>
        </div>
      </article>

      <!-- Card 2: unpaid orders -->
      <article class="rounded-lg border border-hairline bg-canvas p-lg">
        <p class="mb-sm text-[14px] text-muted">ออเดอร์ค้างชำระ</p>
        <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
          {{ num(summary?.unpaidCount ?? 0) }}
          <span class="text-[14px] font-normal text-muted">รายการ</span>
        </p>
      </article>

      <!-- Card 3: near sold out this round -->
      <article class="rounded-lg border border-hairline bg-canvas p-lg">
        <p class="mb-sm text-[14px] text-muted">ใกล้หมดรอบ</p>
        <ul v-if="nearSoldOut.length > 0" class="flex flex-col gap-xs">
          <li
            v-for="n in nearSoldOut"
            :key="n.varietyId"
            class="flex items-baseline justify-between text-[15px] text-ink"
          >
            <span class="truncate">{{ n.variety }}</span>
            <span class="tabular font-semibold text-destructive">เหลือ {{ num(n.remaining) }}</span>
          </li>
        </ul>
        <p v-else class="text-[15px] text-muted">ยังไม่มีของใกล้หมดรอบ</p>
      </article>

      <!-- Card 4: next-round forecast yield -->
      <article class="rounded-lg border border-hairline bg-canvas p-lg">
        <p class="mb-sm text-[14px] text-muted">ผลผลิตคาดรอบหน้า</p>
        <ul v-if="forecast.length > 0" class="flex flex-col gap-xs">
          <li
            v-for="f in forecast"
            :key="f.varietyId"
            class="flex items-baseline justify-between text-[15px] text-ink"
          >
            <span class="truncate">{{ f.variety }}</span>
            <span class="tabular font-semibold">{{ num(f.plants) }} ต้น</span>
          </li>
        </ul>
        <p v-else class="text-[15px] text-muted">ยังไม่มีรอบถัดไปที่วางแผนไว้</p>
      </article>

      <!-- Card 5: B2B / subscription due + overflow (D-23) -->
      <article
        class="rounded-lg border p-lg sm:col-span-2 xl:col-span-1"
        :class="overflow.length > 0 ? 'border-destructive bg-negative-surface' : 'border-hairline bg-canvas'"
      >
        <p class="mb-sm text-[14px] text-muted">B2B / สมาชิก (ครบกำหนดรอบนี้)</p>
        <div class="mb-md flex gap-xl">
          <div>
            <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
              {{ num(summary?.standingDue ?? 0) }}
            </p>
            <p class="text-[13px] text-muted">ออเดอร์ประจำ</p>
          </div>
          <div>
            <p class="tabular text-[28px] font-semibold leading-[1.3] text-ink">
              {{ num(summary?.subsDue ?? 0) }}
            </p>
            <p class="text-[13px] text-muted">กล่องสมาชิก</p>
          </div>
        </div>

        <div v-if="overflow.length > 0">
          <p class="mb-xs text-[14px] font-semibold text-destructive">
            ออเดอร์ประจำ/สมาชิกเกินผลผลิตที่คาดไว้ — เพิ่มการปลูกหรือลดออเดอร์ก่อนเปิดขาย
          </p>
          <ul class="list-disc pl-lg text-[13px] text-ink">
            <li v-for="f in overflow" :key="f.id">{{ f.variety }}: ขาด {{ num(f.shortfall) }} ต้น</li>
          </ul>
        </div>
      </article>
    </div>
  </section>
</template>
