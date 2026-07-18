<script setup lang="ts">
// Store shell (04-08). A thin desktop-first frame: a centered store-max header +
// the routed page. Tokens/typography come from assets/style.css (shared @theme).
// 04-09: a cart link (line count) that routes to the guest checkout page.
import { useCart } from "~/stores/cart";

const cart = useCart();
</script>

<template>
  <div class="min-h-[100dvh] bg-canvas">
    <header class="border-b border-hairline bg-canvas">
      <div class="store-max flex items-center justify-between px-md py-md">
        <NuxtLink to="/" class="text-[20px] font-semibold text-accent">Saladee</NuxtLink>
        <div class="flex items-center gap-md">
          <span class="hidden text-[14px] font-normal text-muted sm:inline"
            >ผักสลัดสด ส่งตรงจากฟาร์ม</span
          >
          <ClientOnly>
            <NuxtLink
              to="/checkout"
              class="flex min-h-[44px] items-center gap-xs rounded-lg border border-hairline px-md text-[16px] font-semibold text-ink"
            >
              ตะกร้า
              <span
                v-if="cart.lineCount.value > 0"
                class="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-xs text-[14px] font-semibold text-canvas"
                >{{ cart.lineCount.value }}</span
              >
            </NuxtLink>
          </ClientOnly>
        </div>
      </div>
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>
