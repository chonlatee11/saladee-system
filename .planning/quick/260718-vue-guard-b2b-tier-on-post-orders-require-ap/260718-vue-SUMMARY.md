---
phase: quick
plan: 260718-vue
subsystem: orders / b2b-pricing
status: complete
tags: [security, authorization, b2b, orders, blocker-fix]
requires: [services/b2b.ts wholesaleVisible]
provides: [b2b write-path authorization gate]
affects: [POST /orders]
tech_stack:
  added: []
  patterns: ["reuse the single wholesaleVisible() approval rule across read AND write surfaces"]
key_files:
  created:
    - api/tests/order-b2b-tier-gate.test.ts
  modified:
    - api/src/routes/orders.ts
decisions:
  - "Gate only the tier=b2b branch — POST /orders stays OPEN for guest b2c checkout (D-03)"
  - "Guest + tier=b2b rejected, not silently downgraded to b2c"
  - "Same 403 not_b2b_approved code for guest and unapproved-member — discloses nothing"
  - "Fail CLOSED (no try/catch), unlike catalog.ts's deliberate fail-open gate (IN-03)"
metrics:
  duration: ~12m
  completed: 2026-07-18
  tasks: 3
  files_changed: 2
---

# Quick Task 260718-vue: Guard B2B Tier on POST /orders — Summary

Closed BLOCKER-01 from the v1.0 milestone audit: the wholesale price tier was gated on every READ surface and on no WRITE surface, so any unauthenticated caller could transact at wholesale prices by POSTing `{"tier":"b2b"}`. One guard in `POST /orders` now reuses the existing `wholesaleVisible()` rule, backed by a mutation-verified regression test.

## What Changed

**`api/src/routes/orders.ts`** — imports `wholesaleVisible` from `../services/b2b` and adds a guard immediately after `const tier = body.tier as Tier;`, above both price-resolution loops (single lines at `:291`, box components at `:361`):

- `tier === "b2b"` + no `customerId` in body (guest) → `403 { error: "not_b2b_approved" }`
- `tier === "b2b"` + `wholesaleVisible(database, customerId)` false → same `403`
- No try/catch — a DB error throws and fails closed; no order is created
- No `customers.b2bStatus` query added — the one rule in `services/b2b.ts:87` is reused, so `catalog.ts`, `/b2b/:id/prices`, `/me/b2b/prices` and `POST /orders` can never disagree

**`api/tests/order-b2b-tier-gate.test.ts`** (new, 5 cases) — `describe("b2b tier WRITE gate — BLOCKER-01, D-08 / T-03-21 / INV-02")`. Seeds a sellable line with BOTH a b2c (200 ฿/kg) and a b2b (120 ฿/kg) price row so the approved-path 201 assertion is meaningful rather than a false pass on `no_price`.

## Verification

| Check | Result |
|-------|--------|
| `grep -n wholesaleVisible api/src/routes/orders.ts` | hits at `:37` (import), `:246` (call) — was empty before |
| Guard precedes both price loops | call at `:246` < `eq(prices.tier, tier)` at `:291` and `:361` |
| `grep -c b2bStatus api/src/routes/orders.ts` | `0` — rule reused, not re-implemented |
| `bunx tsc --noEmit` | no errors in `src/`; 3 pre-existing errors in unrelated test files (`broadcast-flex`, `catalog.test`, `product-images`) — untouched by this change |
| **Full API suite (before)** | **383 pass / 0 fail**, 1218 expects, 65 files |
| **Full API suite (after)** | **388 pass / 0 fail**, 1231 expects, 66 files — 19.75s |

383 + 5 new = 388. Zero failures; no existing test broke (no test POSTed `tier: "b2b"` with a guest or unseeded customer).

**Mutation check:** replacing `if (tier === "b2b")` with `if (false)` makes 3 of 5 cases fail (guest, pending, rejected — all 201 instead of 403). The test genuinely pins the invariant rather than only exercising the happy path. File restored to the committed version afterwards (`git diff --stat` clean).

## Test Cases

| Case | Expected | Result |
|------|----------|--------|
| guest body + `tier=b2b` | 403 `not_b2b_approved`, order count unchanged | pass |
| member `b2b_status=pending` + `tier=b2b` | 403 `not_b2b_approved` | pass |
| member `b2b_status=rejected` + `tier=b2b` | 403 `not_b2b_approved` (same code) | pass |
| member `b2b_status=approved` + `tier=b2b` | 201, persisted `unit_price_satang` = b2b rate ≠ b2c rate | pass |
| control: `tier=b2c` + guest body | 201 at the b2c rate (gate did not widen) | pass |

## Deviations from Plan

None — plan executed exactly as written. All design decisions were pre-settled and followed verbatim (reuse `wholesaleVisible`, gate only the b2b branch, reject guests rather than downgrade, same 403 code for both cases, fail closed, no `.derive()` session block).

One addition beyond the plan's four listed cases: a fifth case for `b2b_status="rejected"`, matching the plan's `<behavior>` block which lists both pending and rejected.

## Known Residual (design decision 6 — NOT in scope)

Knowing an approved customer's UUID lets a caller place a wholesale order "as" them. This is the pre-existing member-linkage trust model already shared with the b2c path — any UUID-knower can already attribute a b2c order to a member. Recorded in `.planning/v1.0-MILESTONE-AUDIT.md` under BLOCKER-01, tracked separately.

## Audit Note

A resolution note was appended under BLOCKER-01 in `.planning/v1.0-MILESTONE-AUDIT.md` naming the guard location, the test file, the suite counts, and the residual. Per instructions this file was **not** committed — it is the orchestrator's working state.

## Commits

| Hash | Message |
|------|---------|
| `151885a` | `fix(quick-260718-vue): gate b2b tier on POST /orders via wholesaleVisible` |
| `a621d6a` | `test(quick-260718-vue): pin the b2b tier WRITE gate invariant` |

## Self-Check: PASSED

- `api/src/routes/orders.ts` — modified, committed in `151885a`
- `api/tests/order-b2b-tier-gate.test.ts` — created, committed in `a621d6a`
- Both commit hashes verified present in `git log`
