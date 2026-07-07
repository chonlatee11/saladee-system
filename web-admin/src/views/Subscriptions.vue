<script setup lang="ts">
// STUB (03-03 scaffold). Subscription slice replaces this with the subscriptions
// admin table (member · package · frequency · next-round, statuses, substitution
// flag, D-12/13/14/16). Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">สมาชิกกล่องผัก</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีสมาชิกกล่องผัก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        เมื่อลูกค้าสมัครสมาชิก รายการและรอบที่จะสร้างอัตโนมัติจะแสดงที่นี่
      </p>
    </div>
  </section>
</template>
