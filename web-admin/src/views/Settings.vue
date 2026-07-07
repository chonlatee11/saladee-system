<script setup lang="ts">
// STUB (03-03 scaffold). Settings slice replaces this with the editable system
// settings (rounds, daily prices, delivery fee/zones, hold window, haircut %, B2B
// quota ceiling — secrets stay env-only, D-22). Kept so the router import resolves
// and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">ตั้งค่าระบบ</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีการตั้งค่าให้แก้ไข</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        การตั้งค่ารอบขาย ราคา ค่าส่ง และเพดานโควตา B2B จะแก้ไขได้ที่นี่
      </p>
    </div>
  </section>
</template>
