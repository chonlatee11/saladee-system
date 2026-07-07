<script setup lang="ts">
// STUB (03-03 scaffold). Crop-planning slice replaces this with the harvest calendar
// → publish sellable qty flow (draft/reviewing/published/manual-override, D-03/04).
// Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">ปฏิทินเก็บเกี่ยว</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีรอบที่ถึงกำหนดเก็บเกี่ยว</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อแบตช์ถึงกำหนด ระบบจะคำนวณจำนวนขายให้ตรวจสอบและเผยแพร่ที่นี่
      </p>
    </div>
  </section>
</template>
