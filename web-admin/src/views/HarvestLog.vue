<script setup lang="ts">
// STUB (03-03 scaffold). Crop-planning slice replaces this with the actual-harvest
// log form (qty + auto lot + best-before, actual-vs-forecast delta, D-05/INV-10).
// Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">บันทึกการเก็บเกี่ยว</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีแบตช์ที่ถึงกำหนดเก็บเกี่ยว</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        แบตช์จะปรากฏที่นี่เมื่อถึงวันเก็บเกี่ยวที่คำนวณไว้
      </p>
    </div>
  </section>
</template>
