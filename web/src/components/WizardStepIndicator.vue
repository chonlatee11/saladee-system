<script setup lang="ts">
// Checkout wizard step indicator (02-08 / UI-SPEC step-indicator color rule, D-16).
// The active + completed steps use the accent color; upcoming steps use the neutral
// hairline border. Accent here is the "wizard progress" affordance from the UI-SPEC
// reserved list (item 3) — it does NOT steal the single primary-CTA accent per screen.
import { computed } from "vue";

const props = defineProps<{ steps: string[]; current: number }>();

const items = computed(() =>
  props.steps.map((label, i) => {
    const n = i + 1;
    return {
      n,
      label,
      state: n < props.current ? "done" : n === props.current ? "active" : "upcoming",
    } as const;
  }),
);
</script>

<template>
  <ol class="flex items-center gap-xs" aria-label="ขั้นตอนการสั่งซื้อ">
    <li v-for="(item, i) in items" :key="item.n" class="flex flex-1 items-center gap-xs">
      <div class="flex min-w-0 flex-col items-center gap-xs">
        <span
          class="flex h-[28px] w-[28px] items-center justify-center rounded-full text-[14px] font-semibold"
          :class="
            item.state === 'upcoming'
              ? 'border border-hairline text-muted'
              : 'bg-accent text-white'
          "
          :aria-current="item.state === 'active' ? 'step' : undefined"
        >
          <span v-if="item.state === 'done'" aria-hidden="true">✓</span>
          <span v-else>{{ item.n }}</span>
        </span>
        <span
          class="text-center text-[14px] leading-[1.5]"
          :class="item.state === 'upcoming' ? 'text-muted' : 'font-semibold text-ink'"
        >
          {{ item.label }}
        </span>
      </div>
      <span
        v-if="i < items.length - 1"
        class="h-px flex-1"
        :class="item.state === 'done' ? 'bg-accent' : 'bg-hairline'"
        aria-hidden="true"
      />
    </li>
  </ol>
</template>
