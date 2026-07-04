---
phase: 01-commerce-core
fixed_at: 2026-07-04T06:05:00Z
review_path: .planning/phases/01-commerce-core/01-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-07-04T06:05:00Z
**Source review:** .planning/phases/01-commerce-core/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01 + WR-01..WR-05)
- Fixed: 6
- Skipped: 0

Each fix was applied against real code state, verified with a targeted syntax/behaviour
check, and committed atomically. A dedicated regression test was added for every
finding and run against a real PostgreSQL 17 container (docker-compose.pg.yml on :55432).

**Test suite after all fixes:** `cd api && bun test` → **118 pass / 1 fail**
(baseline before fixes was 109 pass / 1 fail; the +9 new tests all pass). The single
failure is the pre-existing `tests/storage.test.ts` (a before/after hook times out
because it needs the MinIO container from `tests/docker-compose.minio.yml`, which was
not started); it failed identically at baseline and is unrelated to any fix here.

## Fixed Issues

### CR-01: Concurrent cancel double-releases stock → oversell (TOCTOU on order status)

**Files modified:** `api/src/routes/orders.ts`, `api/tests/cancel-release.test.ts`
**Commit:** da52305
**Applied fix:** Moved the order-status read INSIDE the transaction with
`SELECT ... FOR UPDATE` on the order row, re-validated the transition against the
locked row, and made the stock-release loop + status write conditional within that
same tx. The status read/`canTransition` check no longer happens on a stale
outside-the-tx value, so two concurrent cancels are serialised by the row lock: the
loser re-reads `cancelled` and is rejected with `illegal_transition` (400), and
`release()` runs exactly once. Added a `Promise.all` double-cancel regression test
with a SECOND live order on the same `round_stock` counter, asserting the other
order's reservation is untouched (would have been silently freed by the old
double-release). **Verified by a new concurrent (real-PG) regression test that
passes** — the concurrency window this finding describes is now exercised and closed.

### WR-05: Status pipeline read-outside-tx lost-update window (beyond cancel)

**Files modified:** (closed by the CR-01 edit) `api/src/routes/orders.ts`
**Commit:** da52305
**Applied fix:** WR-05 is the general class of the CR-01 bug (any two concurrent
transitions validating against the same stale status). The single CR-01 change —
read + transition-check + release + status-write all performed atomically under
`SELECT ... FOR UPDATE` — closes this entire class. No separate edit was required;
the same commit resolves both.

### WR-01: `prices` unique index does not constrain the NULL-date default

**Files modified:** `api/src/db/schema.ts`, `api/src/routes/prices.ts`,
`api/drizzle/0002_prices_default_uniq.sql`,
`api/drizzle/0002_prices_default_uniq.down.sql`, `api/drizzle/meta/_journal.json`,
`api/tests/migrate.test.ts`, `api/tests/prices-resolution.test.ts`,
`api/tests/catalog-crud.test.ts`
**Commit:** e7313a2
**Applied fix:** Added a **partial unique index** `prices_default_uniq ON prices
(round_id, variety_id, tier) WHERE effective_date IS NULL` to enforce a single
NULL-date "round default" per (round, variety, tier). Chose the partial-index option
over `NULLS NOT DISTINCT` because Drizzle 0.45's index builder exposes `.where()` but
NOT `nullsNotDistinct()` (that method exists only on the `unique()` constraint
builder), and a partial index is PG-version-agnostic. The change is reflected in
`schema.ts` and shipped as a NEW forward migration `0002_prices_default_uniq` (the
already-applied `0001_commerce.sql` was left untouched, with a matching hand-written
down and a `_journal.json` entry). `POST /prices` now UPSERTs the default
(`onConflictDoUpdate` targeting the partial index via `targetWhere:
isNull(effectiveDate)`) instead of blind-inserting, so re-posting a default updates
the single row rather than creating a rival. Dated overrides remain plain inserts
(guarded by the existing full index). Test bootstraps that use `POST /prices` were
updated to apply `0002`, and `migrate.test.ts` now proves `0002` up→down→up with an
index-existence assertion; a new test proves a second default upserts to one row.

### WR-02: `qty` / box `qty` / `plantsPerBox` have no upper bound → int4 overflow 500

**Files modified:** `api/src/routes/orders.ts`, `api/src/routes/boxes.ts`,
`api/tests/order-snapshot.test.ts`
**Commit:** 1ad5562
**Applied fix:** Added `maximum: 100000` to the TypeBox integer schemas for
`OrderLineBody.qty`, `BoxLineBody.qty`, and `ComponentBody.plantsPerBox`, so oversized
quantities are rejected at validation (422) before any DB write, rather than
overflowing an int4 column (`unitPriceSatang*qty`, `plantsPerUnit*qty`,
`plantsPerBox*qty`) and surfacing as an uncaught 500. Added a test asserting
`qty: 100001` → 422.

### WR-03: `POST /orders` does not honour the variety / sale-unit soft-delete flag

**Files modified:** `api/src/routes/orders.ts`, `api/tests/order-snapshot.test.ts`
**Commit:** 0bae9df
**Applied fix:** Added `eq(saleUnits.active, true)` and `eq(varieties.active, true)`
filters when resolving direct order lines (returning `invalid_line` /
`variety_not_found` 400), matching the box path (`eq(boxes.active, true)`) and the
catalog. Also applied the `active` filter to box-component variety resolution so a
box whose BOM references a discontinued variety is not sellable. Added two tests: a
soft-deleted variety and a soft-deleted sale unit are both rejected even with a known
UUID and a live quota/price row, and no reservation is taken.

### WR-04: Box BOM writes surface FK / duplicate-component violations as 500

**Files modified:** `api/src/routes/boxes.ts`, `api/tests/boxes-crud.test.ts` (new)
**Commit:** 0cd6953
**Applied fix:** Added a `validateComponents()` pre-check to `POST /boxes` and
`PUT /boxes/:id`: it rejects duplicate `varietyId`s in the payload (400
`duplicate_component`, which would violate `box_components_box_variety_idx`) and
verifies every `varietyId` exists via a select-in-list (400 `invalid_component`,
which would violate the `box_components` FK). Both formerly propagated as uncaught
Postgres 500s on a staff-facing write. Added a new `boxes-crud.test.ts` exercising
`makeBoxesRoutes` (previously untested at the HTTP boundary): valid BOM → 201,
duplicate → 400, non-existent variety → 400, and the same for `PUT`.

## Notes on Info findings (out of scope: fix_scope = critical_warning)

IN-01, IN-02, IN-03 were not in scope and were not separately addressed. Note that
**IN-03** (response should reflect committed state) is incidentally resolved by the
CR-01 fix: `PATCH /orders/:id/status` now returns the status determined under the row
lock inside the transaction, so a rejected/lost transition can no longer report
success. IN-01 (unused `reserveBox`) and IN-02 (release against `ord.roundId` vs the
box snapshot's `roundId`) remain open for a future pass.

---

_Fixed: 2026-07-04T06:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
