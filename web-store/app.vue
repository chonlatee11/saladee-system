<script setup lang="ts">
// Store shell (04-08). A thin desktop-first frame: a centered store-max header +
// the routed page. Tokens/typography come from assets/style.css (shared @theme).
</script>

<template>
  <div class="min-h-[100dvh] bg-canvas">
    <header class="border-b border-hairline bg-canvas">
      <div class="store-max flex items-center justify-between px-md py-md">
        <NuxtLink to="/" class="text-[20px] font-semibold text-accent">Saladee</NuxtLink>
        <span class="text-[14px] font-normal text-muted">ผักสลัดสด ส่งตรงจากฟาร์ม</span>
      </div>
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>
