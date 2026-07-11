---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 11
subsystem: reports
tags: [reports, analytics, chartjs, vue-chartjs, papaparse, drizzle, aggregate, rbac, csv]

# Dependency graph
requires:
  - phase: 03-01
    provides: "Phase-3 stub routers (reports.ts) composed into App type; requireRole staff guard"
  - phase: 03-03
    provides: "web-admin SPA scaffold (Vue 3.5 + Vite 8 + Tailwind 4), TanStack Query app-wide, chart.js/vue-chartjs/papaparse pre-installed, chart-* CSS tokens, RBAC nav, DataTable"
provides:
  - "GET /reports staff-gated aggregate — sales-by-channel series, best-sellers, repeat-customers, AOV (integer satang), filterable by from/to/channel/product/round"
  - "web-admin Reports view: filter strip + 4 Chart.js charts (fixed channel↔color palette) + summary cards + CSV export via papaparse"
  - "useReports composable + fixed CHANNEL_COLORS / categorical palette / cap-6 rollup helpers"
  - "ReportChart.vue reusable vue-chartjs bar/line/pie wrapper (UI-SPEC type scale)"
affects: [03-reports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server aggregates as raw parameterised Drizzle sql via db.execute (channel derived per-order, grouped in an outer select) — read-only, no new stock counter"
    - "Drizzle expands JS arrays into a (…) tuple → use `in`, not `= ANY`, for status list filters"
    - "Reactive TanStack Query: filters ref passed into queryKey re-fetches on strip change; placeholderData keeps prior charts during load"
    - "Fixed channel↔color mapping lives in one module (useReports) so every chart colours a channel identically"
    - "CSV export client-side via papaparse.unparse (RFC-4180 escaping) + UTF-8 BOM for Excel Thai — never a hand-rolled join"

key-files:
  created:
    - api/tests/reports.test.ts
    - web-admin/src/components/ReportChart.vue
    - web-admin/src/composables/useReports.ts
  modified:
    - api/src/routes/reports.ts
    - web-admin/src/views/Reports.vue

key-decisions:
  - "channel = 'subscription' when the order is present in subscription_orders, else the order tier; b2c/b2b filters exclude subscription orders so the three channels never double-count"
  - "Only realised statuses (paid|packing|shipping|done) count as sales; created/awaiting_payment/cancelled excluded — mirrors dashboard.ts SOLD_STATUSES"
  - "AOV = Σsubtotal / Σorders as integer satang (rounded); money formatted to baht only at the display seam (D-13)"
  - "CSV built client-side from the shaped JSON (MVP — A5); best-seller Thai names / commas escaped by papaparse, never hand-rolled (T-03-30)"
  - "ReportChart options typed `any` — one options object is shared across Bar/Line/Pie whose Chart.js generics differ; shape is runtime-correct"

requirements-completed: [MKT-04]

# Metrics
duration: ~35min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 11: Sales Reports / Analytics Summary

**Staff-gated `GET /reports` server aggregate (sales-by-channel, best-sellers, repeat-customers, AOV — integer satang, Drizzle-parameterised filters) feeding a web-admin Reports view with four Chart.js charts on the fixed channel↔color palette, a period/channel/product/round filter strip, and Thai-safe CSV export via papaparse.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-11T00:50Z
- **Completed:** 2026-07-11
- **Tasks:** 2 auto tasks done + verified; Task 3 = human-verify checkpoint (pending, gate=blocking)
- **Files created:** 3 · **Files modified:** 2

## Accomplishments

- **`api/src/routes/reports.ts`** (stub → filled): ONE staff-gated `GET /reports`. All figures are read-only, Drizzle-**parameterised** aggregates via `db.execute(sql\`…\`)` over existing tables (orders, order_lines, subscription_orders, varieties) — no new stock counter, no writes.
  - `series[]` — realised sales grouped by channel (b2c/b2b/subscription; channel derived per order, grouped in an outer select), value in integer satang + count.
  - `bestSellers[]` — top-20 varieties by qty (value alongside).
  - `repeatCustomers` — customers with >1 realised order in range.
  - `aovSatang` + `totalSatang` + `orderCount` — AOV = Σsubtotal / Σorders.
  - Filters: `from`/`to` (inclusive day range), `channel`, `product` (varietyId via EXISTS), `round` — all TypeBox-validated + bound as parameters. `requireRole("owner","admin")`.
- **`api/tests/reports.test.ts`**: 6 tests racing real PostgreSQL 17 via `makeReportsRoutes(db)` DI — channel split, best-seller ranking, repeat-customer count, AOV/totals, channel filter, empty range, RBAC (401/403/200). All green.
- **`web-admin/src/composables/useReports.ts`**: reactive TanStack Query (filters ref in queryKey ⇒ re-fetch on change, `placeholderData` keeps prior charts); owns the fixed `CHANNEL_COLORS` (B2C `#2E7D32` / B2B `#1565C0` / Subscription `#B26A00`), the 6-slot categorical palette + `#9AA69A` "อื่น ๆ" grey, and `capSeries` cap-6 rollup.
- **`web-admin/src/components/ReportChart.vue`**: reusable vue-chartjs (Chart.js 4) bar/line/pie wrapper — title 20px/600, axis + legend 14px (UI-SPEC), per-point colours passed from the fixed palette, satang→baht tooltip/axis formatter.
- **`web-admin/src/views/Reports.vue`** (stub → filled): filter strip (period/channel/product/round, reusing `useVarieties` + `useRounds`) + three summary cards (ยอดขายรวม/AOV/จำนวนออเดอร์) + four charts (sales by channel, best-sellers, repeat vs one-time, value by channel) + primary `ส่งออก CSV` action (papaparse `unparse` + UTF-8 BOM). States: loading skeleton · populated · no-data-in-range empty · error — all Thai per UI-SPEC.

## Task Commits

1. **Task 1: reports aggregate route + tests** — `a805b69` (feat)
2. **Task 2: Reports view + ReportChart + CSV export** — `01feb4e` (feat)

## Files Created/Modified

- `api/src/routes/reports.ts` — filled stub: staff-gated aggregate GET, parameterised filters, integer satang
- `api/tests/reports.test.ts` — 6 integration tests (aggregate shape, filters, RBAC)
- `web-admin/src/composables/useReports.ts` — reactive query + fixed palette / cap-6 helpers
- `web-admin/src/components/ReportChart.vue` — vue-chartjs bar/line/pie wrapper
- `web-admin/src/views/Reports.vue` — filter strip + charts + summary cards + CSV export

## Verification

- **`cd api && bun test tests/reports.test.ts`** → 6 pass / 0 fail (28 expect calls).
- **`cd web-admin && bun run build`** → clean (Reports chunk lazy-loaded per route).
- **`cd web-admin && bunx vue-tsc --noEmit`** → clean.
- Biome: safe-formatted; remaining warnings are `noUnusedVariables` / `useVueMultiWordComponentNames` false-positives on `<script setup>` bindings (Biome does not parse Vue templates) — consistent with existing views (Dashboard.vue et al).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `= ANY(array)` → `in` for the realised-status filter**
- **Found during:** Task 1 (first test run — every admin call returned 500).
- **Issue:** Drizzle expands a JS array param into a `($1,$2,…)` tuple, so `o.status::text = ANY(($1,$2,$3,$4))` is invalid SQL (ANY over a row tuple).
- **Fix:** Switched to `o.status::text in ${[...SOLD_STATUSES]}` (Drizzle's tuple expansion is exactly the valid form for `in`).
- **Files modified:** api/src/routes/reports.ts
- **Verification:** all 6 reports tests green.
- **Committed in:** a805b69 (Task 1 commit)

**2. [Rule 3 - Blocking] Loosened ReportChart options/tooltip typing to `any`**
- **Found during:** Task 2 (`vue-tsc` failed — the shared options object cannot satisfy Bar/Line/Pie Chart.js generics simultaneously; tooltip `parsed` is `number | null`).
- **Issue:** One options object is passed to three components with divergent Chart.js option types → TS2322.
- **Fix:** Typed `options` computed and the tooltip `label` callback param as `any` (runtime shape is correct) with `biome-ignore` justification.
- **Files modified:** web-admin/src/components/ReportChart.vue
- **Verification:** `vue-tsc --noEmit` clean; build clean.
- **Committed in:** 01feb4e (Task 2 commit)

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). No scope creep.

## Threat Surface

- **T-03-28 (Elevation — reports endpoint):** mitigated — `requireRole("owner","admin")`; grower/packer/customer → 403, no token → 401 (RBAC tests green).
- **T-03-29 (Tampering — SQL injection in filters):** mitigated — every filter value bound as a Drizzle parameter (`${…}`); no user input string-concatenated; TypeBox validates filter shapes (date/uuid/union).
- **T-03-30 (Tampering — CSV injection / Thai mangle):** mitigated — CSV built with `papaparse.unparse` (RFC-4180 quoting/escaping) + UTF-8 BOM; never a hand-rolled join.
- No new security surface beyond the plan's threat register.

## Known Stubs

None — the view is wired end-to-end to the live aggregate (no placeholder/mock data).

## User Setup Required

None for the code. The Task-3 checkpoint needs a running API (:3000) + web-admin dev (:5174) with seeded staff + some realised orders across channels to exercise the charts/CSV live.

## Next Phase Readiness

- **PENDING human verification (Task 3, gate=blocking):** with API + web-admin running, log in as admin → "รายงาน": change period/channel filters (charts update, channel colours stable: B2C green / B2B blue / Subscription amber), inspect best-sellers / AOV / repeat customers, click "ส่งออก CSV" and confirm Thai columns / embedded commas open correctly, and confirm a no-data range shows the empty state. Automated tests + build + typecheck are green; only the live visual/CSV round-trip is unverified.

## Self-Check: PASSED
- All 3 created files present on disk (reports.test.ts, ReportChart.vue, useReports.ts); both modified files updated (reports.ts, Reports.vue).
- Both task commits found in git log: a805b69, 01feb4e.
- Automated verification green: reports.test 6/6 ✓, web-admin build ✓, vue-tsc ✓.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*
