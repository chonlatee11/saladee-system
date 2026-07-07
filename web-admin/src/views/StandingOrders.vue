<script setup lang="ts">
// STUB (03-03 scaffold). B2B slice replaces this with the standing-orders table
// (reserved-from-forecast, overflow flag, edit/cancel, D-09/10). Kept so the router
// import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">ออเดอร์ประจำ</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีออเดอร์ประจำ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        ออเดอร์ประจำของบัญชี B2B ที่อนุมัติแล้วจะถูกจองจากผลผลิตที่คาดไว้และแสดงที่นี่
      </p>
    </div>
  </section>
</template>
