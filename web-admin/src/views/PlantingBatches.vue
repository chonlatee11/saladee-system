<script setup lang="ts">
// STUB (03-03 scaffold). Crop-planning slice replaces this with the planting-batches
// table (batch → variety → plant date → computed harvest date → round) + edit/delete
// (CROP-02/07). Kept so the router import resolves and the build passes.
</script>

<template>
  <section>
    <h1 class="mb-lg text-[28px] font-semibold">แบตช์การปลูก</h1>
    <div
      class="flex flex-col items-center justify-center gap-sm rounded-lg border border-hairline bg-canvas p-3xl text-center"
    >
      <p class="text-[20px] font-semibold text-ink">ยังไม่มีแบตช์การปลูก</p>
      <p class="max-w-[420px] text-[14px] text-muted">
        กด "สร้างแบตช์จากสูตรปลูก" ในวันจันทร์ที่ปลูกเพื่อเริ่มรอบนี้
      </p>
    </div>
  </section>
</template>
