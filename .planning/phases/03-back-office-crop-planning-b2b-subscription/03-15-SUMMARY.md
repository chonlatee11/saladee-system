---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 15
subsystem: web-admin
tags: [vue, tanstack-table, tanstack-query, b2b, standing-orders, uat-gap]
requires:
  - phase: 03-06
    provides: StandingOrders.vue admin view with useStandingOrders/useB2bCustomers/useVarieties queries
provides:
  - Reactive name resolution for the standing-orders table (customerLabel/basketLabel joined into row data)
affects: []
tech-stack:
  added: []
  patterns:
    - "TanStack Table memoizes accessor results per row — display lookups over async query data must live INSIDE the reactive data prop (row objects), never in accessorFn closures, or late-resolving queries leave stale fallbacks frozen on screen"
key-files:
  created: []
  modified:
    - web-admin/src/views/StandingOrders.vue
decisions:
  - "Join display labels into a DisplayRow (extends StandingRow with customerLabel/basketLabel) computed from the standing+varieties+customers queries, so any query resolving late produces new row objects and invalidates TanStack's per-row value cache"
metrics:
  duration: ~3 min
  completed: 2026-07-11
status: complete
---

# Phase 3 Plan 15: Standing-Order Basket Readable Names Summary

Standing-orders table now resolves variety/customer names reactively by joining customerLabel/basketLabel into the rows computed (DisplayRow), replacing accessorFn closures that TanStack Table froze on UUID prefixes when lookups resolved after first render.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Join variety/customer display names into the reactive rows computed | 9788dc3 | web-admin/src/views/StandingOrders.vue |

## What Was Done

Closed UAT gap #3 (minor, test 4): the ตะกร้าประจำรอบ column rendered raw UUID prefixes ("6fb95842 ×20") instead of variety names.

**Root cause:** the "customer" and "basket" columns resolved names via `accessorFn` closures over the `useVarieties()`/`useB2bCustomers()` query results. TanStack Table caches accessor values per row, so cells rendered before those queries resolved kept the 8-char id-prefix fallback permanently.

**Fix in `web-admin/src/views/StandingOrders.vue`:**

1. Added `DisplayRow` interface = `StandingRow` + `customerLabel: string` + `basketLabel: string`.
2. Rewrote the `rows` computed to return `DisplayRow[]`: each standing order gets `customerLabel` (customer name ?? 8-char id prefix while unresolved) and `basketLabel` ("{name} ×{plantsPerRound}" joined with ", ", or "—" when empty). Because the computed reads `varieties.value` and `customers.value`, a late-resolving query produces a NEW array → DataTable's `data` prop changes → TanStack's per-row value cache is rebuilt with real names.
3. Repointed columns: `id: "customer"` → `accessorKey: "customerLabel"`; `id: "basket"` → `accessorKey: "basketLabel"`. Dropped both accessorFn closures. "total" and "active" columns unchanged.
4. Deleted the now-unused `basketSummary` helper (inlined into the rows computed). Kept `customerName` (still used by the cancel-confirm modal) and `varietyName` (used by the rows computed).
5. Added a comment on the rows computed explaining WHY labels live in row data (per-row accessor memoization).

## Verification

- `cd web-admin && bun run typecheck` — exit 0
- `cd web-admin && bun run build` — exit 0 (built in 555ms)
- `grep -c "basketLabel"` = 3 (≥2), `grep -c "customerLabel"` = 3 (≥2), `grep -c 'accessorKey: "basketLabel"'` = 1
- Behavior check (names shown after data loads with dev seed) deferred to the phase UAT re-walk per plan.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — the 8-char id-prefix fallback inside the label join is the plan-specified transient state while lookups load, not a stub.

## Threat Flags

None — display-only refactor, no new endpoints, inputs, or data exposure (T-03-15-01 accepted per plan threat model).

## Self-Check: PASSED

- web-admin/src/views/StandingOrders.vue — FOUND
- Commit 9788dc3 — FOUND
