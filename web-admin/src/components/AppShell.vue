<script setup lang="ts">
// Back-office app shell (03-UI-SPEC §Layout): persistent 240px left sidebar
// (Secondary surface) + top toolbar (breadcrumb + user/role chip + sign-out),
// content area = Dominant white. Nav items are RBAC-gated (D-19): only routes the
// CURRENT role may see are rendered — hidden, never disabled. The default slot
// receives the active view (router-view is slotted by App.vue).
import {
  BarChart3,
  Boxes,
  BoxSelect,
  CalendarDays,
  ClipboardCheck,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Repeat,
  Settings as SettingsIcon,
  Sprout,
  UserCheck,
} from "lucide-vue-next";
import { computed, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AdminRouteMeta } from "../router";
import { useSession } from "../stores/session";

const route = useRoute();
const router = useRouter();
const session = useSession();

// Map the meta.icon name (string, kept out of route meta as a value) to its
// lucide component so route meta stays plain/serializable.
const ICONS: Record<string, Component> = {
  LayoutDashboard,
  Sprout,
  FlaskConical,
  Boxes,
  CalendarDays,
  ClipboardCheck,
  UserCheck,
  Repeat,
  BoxSelect,
  PackageCheck,
  BarChart3,
  Settings: SettingsIcon,
};

interface NavItem {
  name: string;
  path: string;
  title: string;
  icon: Component;
  group: string;
}

// Build the nav from the router table, keeping ONLY items the current role sees.
const navGroups = computed(() => {
  const role = session.role.value;
  if (!role) return [] as { group: string; items: NavItem[] }[];

  const items: NavItem[] = router
    .getRoutes()
    .filter((r) => {
      const meta = r.meta as AdminRouteMeta;
      return meta.title && meta.roles?.includes(role);
    })
    .map((r) => {
      const meta = r.meta as AdminRouteMeta;
      return {
        name: String(r.name),
        path: r.path,
        title: meta.title as string,
        icon: ICONS[meta.icon as string] ?? LayoutDashboard,
        group: meta.group ?? "อื่น ๆ",
      };
    });

  // Preserve registration order while grouping by section header.
  const order: string[] = [];
  const byGroup = new Map<string, NavItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)?.push(item);
  }
  return order.map((group) => ({ group, items: byGroup.get(group) as NavItem[] }));
});

const currentTitle = computed(() => (route.meta as AdminRouteMeta).title ?? "");
const currentGroup = computed(() => (route.meta as AdminRouteMeta).group ?? "");

function signOut(): void {
  session.clear();
  void router.push({ name: "login" });
}
</script>

<template>
  <div class="flex min-h-dvh bg-canvas text-ink">
    <!-- Sidebar nav (240px, Secondary surface) -->
    <aside class="flex w-[240px] shrink-0 flex-col border-r border-hairline bg-surface">
      <div class="flex h-16 items-center px-lg text-[20px] font-semibold text-accent">Saladee</div>
      <nav class="flex-1 overflow-y-auto px-sm pb-lg">
        <div v-for="section in navGroups" :key="section.group" class="mb-md">
          <p class="px-sm py-xs text-[14px] font-semibold text-muted">{{ section.group }}</p>
          <RouterLink
            v-for="item in section.items"
            :key="item.name"
            :to="item.path"
            class="relative flex items-center gap-xs rounded-md px-sm py-sm text-[14px] text-ink hover:bg-canvas"
            active-class="bg-canvas font-semibold text-accent"
          >
            <span
              v-if="route.name === item.name"
              class="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-accent"
            />
            <component :is="item.icon" :size="18" :stroke-width="1.5" />
            <span>{{ item.title }}</span>
          </RouterLink>
        </div>
      </nav>
    </aside>

    <!-- Content column: toolbar + slotted view -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-surface px-lg"
      >
        <div class="flex items-center gap-xs text-[14px] text-muted">
          <span v-if="currentGroup">{{ currentGroup }}</span>
          <span v-if="currentGroup && currentTitle">/</span>
          <span class="font-semibold text-ink">{{ currentTitle }}</span>
        </div>
        <div class="flex items-center gap-md">
          <span
            v-if="session.role.value"
            class="rounded-full bg-canvas px-sm py-xs text-[14px] text-muted"
          >
            {{ session.role.value }}
          </span>
          <button
            type="button"
            class="flex items-center gap-xs rounded-md border border-hairline px-sm py-xs text-[14px] text-ink hover:bg-canvas"
            @click="signOut"
          >
            <LogOut :size="16" :stroke-width="1.5" />
            ออกจากระบบ
          </button>
        </div>
      </header>
      <main class="min-w-0 flex-1 overflow-y-auto p-lg">
        <slot />
      </main>
    </div>
  </div>
</template>
