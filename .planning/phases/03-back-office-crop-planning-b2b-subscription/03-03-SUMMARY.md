---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 03
subsystem: ui
tags: [vue, vite, tailwind, tanstack-query, tanstack-table, eden-treaty, rbac, jose, chartjs]

# Dependency graph
requires:
  - phase: 01-commerce-core
    provides: "POST /auth/staff (jose HS256 staff session), StaffRole set (owner/admin/grower/packer), requireRole guard, Eden App type"
  - phase: 03-01
    provides: "CORS_ORIGINS allowlist incl. localhost:5174 + saladee-admin.pages.dev; Phase-3 stub routers composed into App type"
provides:
  - "web-admin/ — new @saladee/web-admin desktop back-office SPA (Vue 3.5 + Vite 8 + Tailwind 4 CSS-first), builds to static dist/"
  - "Staff login → POST /auth/staff, session store (module-singleton reactive, sessionStorage-mirrored, role decoded from token)"
  - "RBAC-gated sidebar nav (D-19, hidden not disabled) + router beforeEach nav-hide guard"
  - "DataTable.vue headless @tanstack/vue-table wrapper (sortable, status/action slots, skeleton rows)"
  - "AppShell.vue (240px sidebar + toolbar) and 12 routed stub views for Wave-2/3 slices to fill"
  - "VueQueryPlugin installed app-wide (D-18); chart.js/vue-chartjs/papaparse deps pre-installed for later slices"
affects: [03-crop-planning-slices, 03-b2b, 03-subscriptions, 03-packing, 03-reports, 03-dashboard, 03-settings]

# Tech tracking
tech-stack:
  added: ["@tanstack/vue-query 5.101.2", "@tanstack/vue-table 8.21.3", "chart.js 4.5.1", "vue-chartjs 5.3.3", "papaparse 5.5.4", "vue-tsc 3.1.1", "@types/papaparse 5.3.16"]
  patterns: ["module-singleton reactive store (no Pinia, NFR-08)", "route meta.roles as RBAC source of truth; nav derived from router table", "headless TanStack Table + hand-built Vue markup (D-18)", "client-side JWT role decode for COSMETIC nav gating only (server is authority)"]

key-files:
  created:
    - web-admin/package.json
    - web-admin/vite.config.ts
    - web-admin/tsconfig.json
    - web-admin/index.html
    - web-admin/src/api.ts
    - web-admin/src/main.ts
    - web-admin/src/style.css
    - web-admin/src/router.ts
    - web-admin/src/App.vue
    - web-admin/src/stores/session.ts
    - web-admin/src/components/AppShell.vue
    - web-admin/src/components/DataTable.vue
    - web-admin/src/views/Login.vue
    - web-admin/src/views/Dashboard.vue
    - web-admin/src/views/VarietyParams.vue
    - web-admin/src/views/PlantingMix.vue
    - web-admin/src/views/PlantingBatches.vue
    - web-admin/src/views/HarvestCalendar.vue
    - web-admin/src/views/HarvestLog.vue
    - web-admin/src/views/B2BApprovals.vue
    - web-admin/src/views/StandingOrders.vue
    - web-admin/src/views/Subscriptions.vue
    - web-admin/src/views/Packing.vue
    - web-admin/src/views/Reports.vue
    - web-admin/src/views/Settings.vue
  modified:
    - package.json  # add web-admin to root workspaces

key-decisions:
  - "web-admin dev/preview pinned to port 5174 (strictPort) — the distinct admin origin already whitelisted in CORS_ORIGINS by 03-01; web/ keeps 5173"
  - "Role for nav gating is decoded client-side from the session JWT payload (unverified) — safe because it is cosmetic; server requireRole re-verifies every request"
  - "session store mirrors cart.ts (module-singleton reactive + sessionStorage guard) instead of Pinia to keep dependency count low (NFR-08)"
  - "Nav built by scanning router.getRoutes() filtered by meta.roles so the RBAC contract has one source of truth (router meta), no drift"

patterns-established:
  - "Route meta shape AdminRouteMeta { roles, title, icon, group, public } — slices add views, never edit router.ts"
  - "AppShell default slot receives the active view; App.vue picks bare (public) vs shell (authenticated) chrome"
  - "DataTable exposes cell:<colId>, row-actions slots + meta.numeric for right-aligned tabular numerics"

requirements-completed: [ADM-02]

coverage:
  - id: D1
    description: "web-admin package builds to static dist/ (Vue 3.5 + Vite 8 + Tailwind 4 CSS-first), mirroring web/ conventions"
    requirement: "ADM-02"
    verification:
      - kind: automated_ui
        ref: "cd web-admin && bun run build"
        status: pass
      - kind: unit
        ref: "cd web-admin && bunx vue-tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "Staff login posts to /auth/staff, stores session, redirects to role home; RBAC-gated sidebar shows only in-role menus (owner/admin all, grower crop-only, packer pack-only); direct-URL out-of-role redirects + server 403"
    requirement: "ADM-02"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint: bun run dev :5174 + API :3000, login owner/grower/packer, verify nav + direct-URL redirect + server 403"
        status: unknown
    human_judgment: true
    rationale: "RBAC visibility + live login + cross-origin auth against a running API with seeded staff accounts requires a human in the loop (checkpoint:human-verify, gate=blocking). Automated build/typecheck cannot exercise the login round-trip or server 403."

# Metrics
duration: ~30min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 03: web-admin Back-office Scaffold Summary

**New `web-admin/` desktop SPA (Vue 3.5 + Vite 8 + Tailwind 4) with staff jose-session login, RBAC-gated sidebar (D-19), headless TanStack DataTable, and 12 routed stub views for Wave-2/3 slices to fill.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-07T15:26Z (approx)
- **Completed:** 2026-07-07T15:56Z
- **Tasks:** 2 auto tasks done; Task 3 = human-verify checkpoint (pending)
- **Files created:** 25 · **Files modified:** 1 (root package.json)

## Accomplishments
- Scaffolded `@saladee/web-admin` mirroring `web/` — Vite v4 CSS-first Tailwind, Eden `treaty<App>()` typed client, VueQueryPlugin app-wide (D-18). Builds clean to static `dist/` and passes `vue-tsc`.
- Staff auth: `stores/session.ts` (module-singleton reactive, sessionStorage-mirrored) + functional `Login.vue` posting to `/auth/staff`; role decoded from the session JWT for cosmetic nav gating (server `requireRole` is the authority — T-03-05).
- RBAC sidebar (D-19): `router.ts` registers every Phase-3 route with `meta.roles`; `AppShell.vue` renders only in-role nav (hidden, not disabled); `beforeEach` guard bounces unauthenticated → /login and out-of-role direct-URL → role home.
- `DataTable.vue`: headless `@tanstack/vue-table` wrapper (sortable neutral-caret headers, 40px rows, Secondary hover, right-aligned tabular numerics, status-badge + row-action slots, skeleton loading).
- 12 stub views with Thai UI-SPEC empty-state copy — slices fill the real screens without touching router.ts (conflict-free parallel Wave-2/3).

## Task Commits

1. **Task 1: web-admin package + api/main/style + session store** - `05df127` (feat)
2. **Task 2: router + RBAC AppShell + DataTable + Login + 12 stub views** - `89ad49f` (feat)
3. **Deviation: pin dev/preview port 5174** - `1b0998c` (fix)

## Files Created/Modified
- `web-admin/package.json` / `vite.config.ts` / `tsconfig.json` / `index.html` - package config mirroring web/, dev/preview pinned to :5174
- `web-admin/src/api.ts` - Eden `treaty<App>()` bound to api contract
- `web-admin/src/main.ts` - bootstrap (no LIFF) + VueQueryPlugin
- `web-admin/src/style.css` - `@theme` re-using web/ tokens + desktop/status/chart tokens
- `web-admin/src/stores/session.ts` - staff token+role store, client-side role decode
- `web-admin/src/router.ts` - all routes + meta.roles + nav-hide guard + firstRouteForRole
- `web-admin/src/App.vue` - bare-vs-shell chrome + Suspense boundary
- `web-admin/src/components/AppShell.vue` - 240px RBAC sidebar + toolbar + sign-out
- `web-admin/src/components/DataTable.vue` - headless TanStack Table wrapper
- `web-admin/src/views/*.vue` - Login (functional) + 12 stubs
- `package.json` (root) - added `web-admin` to workspaces

## Decisions Made
- Port 5174 (strictPort) for the admin app — already in CORS_ORIGINS from 03-01; keeps web/ on 5173, no clash, no preflight bypass.
- Client-side JWT role decode (unverified) for nav gating only — cosmetic, server re-verifies (T-03-05).
- No Pinia — module-singleton reactive store like cart.ts (NFR-08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added web-admin to root workspaces**
- **Found during:** Task 1 (package scaffold)
- **Issue:** Root `package.json` declares `workspaces: ["api","web"]`; a new package nested in the repo but not listed would confuse Bun's workspace resolution during `bun install`.
- **Fix:** Added `"web-admin"` to the workspaces array.
- **Files modified:** package.json
- **Verification:** `bun install` in web-admin resolves 60 packages cleanly; build + typecheck pass.
- **Committed in:** 05df127 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Pinned dev/preview port to 5174**
- **Found during:** Task 2 / checkpoint prep
- **Issue:** Vite defaults to 5173 (same as web/). If web/ runs, admin silently bumps to a random port that may be outside CORS_ORIGINS → preflight blocks every admin mutation (Pitfall 6).
- **Fix:** `server.port=5174, strictPort` + `preview.port=5174` — the distinct admin origin 03-01 already whitelisted.
- **Files modified:** web-admin/vite.config.ts
- **Verification:** Confirmed `localhost:5174` present in `api/src/env.ts` CORS_ORIGINS default.
- **Committed in:** 1b0998c

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both necessary for correct install + cross-origin auth. No scope creep.

## Issues Encountered
- First Task-2 commit no-op'd because a `git add` pathspec (`web-admin/bun.lock`, which doesn't exist — the lockfile is the root `bun.lock`) aborted the whole `git add`, staging nothing. Re-ran `git add web-admin/src/` and committed successfully (`89ad49f`). No content lost.

## Threat Surface
- T-03-05 (customer token → staff page): mitigated — session accepts only StaffRole; a customer token decodes to `role=null` and Login rejects it; router guard + server requireRole enforce.
- T-03-06 (CORS preflight): mitigated — admin origin :5174 + saladee-admin.pages.dev already in CORS_ORIGINS (03-01).
- No new security surface beyond the plan's threat register.

## User Setup Required
None for the scaffold. The Task-3 checkpoint needs a running API (:3000) and at least one seeded staff account per role (owner/grower/packer) to exercise RBAC live.

## Next Phase Readiness
- Scaffold ready: Wave-2/3 slices add/replace their `src/views/*.vue` only — router.ts, nav, package.json are frozen and conflict-free.
- **PENDING human verification (Task 3, gate=blocking):** run `cd web-admin && bun run dev` (:5174) with the API up, then confirm login + RBAC nav + direct-URL 403 per the plan's how-to-verify. Automated build + typecheck are green; the live login/RBAC round-trip is the only unverified item.

## Self-Check: PASSED
- All 25 created files present on disk (spot-checked package/api/router/DataTable/AppShell/session/Login + views; 13 view files total).
- All 3 task commits found in git log: 05df127, 89ad49f, 1b0998c.
- Automated verification green: `bun run build` ✓, `vue-tsc --noEmit` ✓.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
