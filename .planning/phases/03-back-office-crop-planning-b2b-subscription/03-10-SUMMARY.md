---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 10
subsystem: ui
tags: [dashboard, drizzle, aggregate, elysia, tanstack-query, vue, rbac]

# Dependency graph
requires:
  - phase: 03-01
    provides: dashboard.ts stub + index.ts composition (DI factory backbone)
  - phase: 03-03
    provides: web-admin scaffold (router, session store, DataTable, brand tokens)
  - phase: 03-06
    provides: quota_overflow_flags + standing orders (B2B card source)
provides:
  - "Staff-gated GET /dashboard aggregate (5 owner-dashboard cards, read-only over existing tables)"
  - "web-admin Dashboard.vue (4 criterion cards + B2B/subscription card) + useDashboard composable"
affects: [reports, verify-work, 03-ship]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side Drizzle sql aggregate mirroring prices.ts /resolve computed GET"
    - "Single-fetch dashboard summary via one TanStack Query composable"
    - "Integer-satang money kept server-side; formatted to baht only at the Vue display seam"

key-files:
  created:
    - api/tests/dashboard.test.ts
    - web-admin/src/composables/useDashboard.ts
  modified:
    - api/src/routes/dashboard.ts
    - web-admin/src/views/Dashboard.vue

key-decisions:
  - "near-sold-out threshold = remaining ≤ 20% of quota, integer-safe: (quota−reserved)*5 ≤ quota (no float)"
  - "current round = explicit ?roundId else latest OPEN round; next-round forecast = newest round other than current"
  - "sales counts only realised statuses (paid|packing|shipping|done); awaiting_payment/created never count as revenue"
  - "added hasOpenRound + roundId to response (Rule 2) so the view can render the UI-SPEC no-open-round empty state"

patterns-established:
  - "Dashboard aggregate route: one staff-gated GET returning all cards; every card a parameterised Drizzle aggregate"
  - "subsDue via NOT EXISTS against subscription_skips + subscription_orders (due = active, not skipped, not generated)"

requirements-completed: [ADM-01, ADM-02]

coverage:
  - id: D1
    description: "Staff-gated GET /dashboard returns 5 aggregate cards (sales today/round, unpaid count, near-sold-out, next-round forecast, subs/standing due + overflow flags)"
    requirement: "ADM-01"
    verification:
      - kind: integration
        ref: "api/tests/dashboard.test.ts#5 cards reflect the seeded round state; money is integer satang"
        status: pass
      - kind: integration
        ref: "api/tests/dashboard.test.ts#no open round → hasOpenRound:false empty summary"
        status: pass
    human_judgment: false
  - id: D2
    description: "dashboard endpoint RBAC — owner/admin only (T-03-26): no token 401, customer 403, admin 200"
    requirement: "ADM-02"
    verification:
      - kind: integration
        ref: "api/tests/dashboard.test.ts#RBAC gate — dashboard is staff-only (T-03-26)"
        status: pass
    human_judgment: false
  - id: D3
    description: "web-admin Dashboard.vue renders 5 cards + loading skeleton / no-open-round empty / error states per UI-SPEC"
    requirement: "ADM-01"
    verification:
      - kind: automated_ui
        ref: "web-admin: bunx vue-tsc --noEmit (clean)"
        status: pass
      - kind: manual_procedural
        ref: "03-10 Task 3 checkpoint:human-verify — visual check of numbers/overflow/empty state"
        status: unknown
    human_judgment: true
    rationale: "Visual correctness of KPI values vs live round data, overflow warning styling, and empty state requires a human eye (Task 3 blocking checkpoint, not yet run)"

# Metrics
duration: 22min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 10: Owner Dashboard Summary

**Staff-gated GET /dashboard server aggregate (sales, unpaid, near-sold-out, next-round forecast, B2B/subscription due + overflow) driving a 5-card Vue owner dashboard — read-only over existing tables, no new stock counter.**

## Performance

- **Duration:** ~22 min
- **Completed:** 2026-07-11
- **Tasks:** 2 auto (Task 3 = deferred human-verify checkpoint)
- **Files modified:** 4 (2 created, 2 filled)

## Accomplishments
- Filled the 03-01 `dashboard.ts` stub with ONE `requireRole("owner","admin")` GET returning all 5 cards as parameterised Drizzle aggregates over `orders`, `round_stock`, `rounds`, `quota_overflow_flags`, `standing_orders`, `subscriptions` — no second stock counter, no writes.
- Money kept integer satang end-to-end; formatted to baht only in the Vue view (D-13 display seam).
- `Dashboard.vue`: 4 criterion cards + B2B/subscription card (standing + subs due, overflow warning in destructive surface) with loading skeleton, no-open-round empty state (UI-SPEC copy + link to planting), and error states.
- `dashboard.test.ts`: aggregate shape + no-open-round + full RBAC ladder (401/403/200) — 5 pass.

## Task Commits

1. **Task 1: dashboard aggregate route (staff-gated)** - `8784e36` (feat)
2. **Task 2: web-admin dashboard view (5 cards)** - `0cac0e8` (feat)

## Files Created/Modified
- `api/src/routes/dashboard.ts` - Staff-gated GET /dashboard; 5-card aggregate (sql + count + NOT EXISTS), integer satang, parameterised (T-03-27).
- `api/tests/dashboard.test.ts` - Integration test: aggregate shape, no-open-round, RBAC.
- `web-admin/src/composables/useDashboard.ts` - TanStack Query wrapping the Eden GET /dashboard with staff Bearer.
- `web-admin/src/views/Dashboard.vue` - 5-card dashboard with loading/empty/error states.

## Decisions Made
- near-sold-out threshold = remaining ≤ 20% of quota, expressed integer-safe as `(quota−reserved)*5 ≤ quota` (no float, PG-portable).
- "current round" = explicit `?roundId`, else the latest OPEN round; "next round" (forecast) = the newest round other than current.
- Sales aggregate counts only realised statuses (`paid|packing|shipping|done`); `awaiting_payment`/`created` feed the unpaid card, never revenue.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `hasOpenRound` + `roundId` to the response**
- **Found during:** Task 1
- **Issue:** The plan behavior shape omitted a flag the UI-SPEC no-open-round empty state needs to distinguish "open round with zero sales" from "no round at all".
- **Fix:** Response now includes `hasOpenRound` and `roundId`; the view keys its empty state off `hasOpenRound`.
- **Files modified:** api/src/routes/dashboard.ts, web-admin/src/views/Dashboard.vue
- **Verification:** `no open round → hasOpenRound:false` test passes.
- **Committed in:** `8784e36` / `0cac0e8`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Necessary for the required UI-SPEC empty state. No scope creep.

## Issues Encountered
- Skeleton card used a non-existent `bg-secondary` token; corrected to `bg-surface` (`--color-surface`) from the brand token set before commit.

## User Setup Required
None - no external service configuration required.

## Deferred Checkpoints
- **Task 3 (checkpoint:human-verify, blocking):** Visual verification of the dashboard — login as admin, confirm numbers match the current round (sales, unpaid), near-sold-out + next-round forecast cards, overflow warning when a flag exists (03-06), and the no-open-round empty state. Resume signal: "approved". Both implementation tasks are complete and automated verification is green; this is a pure visual sign-off for the orchestrator/user.

## Next Phase Readiness
- ADM-01/ADM-02 delivered end-to-end (dashboard). Ready for phase verify/ship after the human-verify visual check.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*

## Self-Check: PASSED
- All 4 source/test files present; both task commits (8784e36, 0cac0e8) in git log.
