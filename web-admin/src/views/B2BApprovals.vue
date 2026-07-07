<script setup lang="ts">
// STUB (03-03 scaffold). B2B slice replaces this with the account-approval list
// (pending → approve/reject-confirm, D-08). Kept so the router import resolves and
// the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">อนุมัติบัญชี B2B</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ไม่มีคำขอสมัคร B2B ที่รออนุมัติ</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        คำขอใหม่จากลูกค้าจะแสดงที่นี่เพื่อรออนุมัติ
      </p>
    </div>
  </section>
</template>
