<script setup lang="ts">
// STUB (03-03 scaffold). Crop-planning slice replaces this with the variety
// parameters edit form (CROP-01: days-to-harvest, survival/haircut %, harvest
// window, shelf-life). Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">ค่าพันธุ์ผัก</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีค่าพันธุ์ผัก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        กำหนดวันโตเก็บเกี่ยว อัตรารอด/หัก และอายุเก็บรักษาของแต่ละพันธุ์ที่นี่
      </p>
    </div>
  </section>
</template>
