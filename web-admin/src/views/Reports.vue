<script setup lang="ts">
// STUB (03-03 scaffold). Reports slice replaces this with the filter strip + charts
// (best-sellers, repeat customers, AOV, by channel/product/round) + CSV export
// (D-24). Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">รายงาน</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ไม่มีข้อมูลในช่วงที่เลือก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        ลองขยายช่วงเวลาหรือเปลี่ยนตัวกรองช่องทาง/สินค้า
      </p>
    </div>
  </section>
</template>
