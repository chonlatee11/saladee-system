---
phase: 01-commerce-core
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - api/src/db/schema.ts
  - api/src/index.ts
  - api/src/routes/boxes.ts
  - api/src/routes/catalog.ts
  - api/src/routes/orders.ts
  - api/src/routes/prices.ts
  - api/src/routes/rounds.ts
  - api/src/routes/stock.ts
  - api/src/routes/varieties.ts
  - api/src/services/order-status.ts
  - api/src/services/pricing.ts
  - api/src/services/reservation.ts
  - api/drizzle/0001_commerce.sql
  - api/drizzle/0001_commerce.down.sql
  - api/tests/auth-boundary.test.ts
  - api/tests/box-order.test.ts
  - api/tests/box-reservation.test.ts
  - api/tests/cancel-release.test.ts
  - api/tests/catalog-crud.test.ts
  - api/tests/catalog.test.ts
  - api/tests/migrate.test.ts
  - api/tests/order-endpoint-race.test.ts
  - api/tests/order-snapshot.test.ts
  - api/tests/order-status.test.ts
  - api/tests/prices-resolution.test.ts
  - api/tests/pricing.test.ts
  - api/tests/reservation.test.ts
  - api/tests/round-cutoff.test.ts
  - api/tests/seed.ts
  - api/tests/soldout-notify.test.ts
  - api/tests/staff-login.test.ts
  - bruno/Saladee/orders/create-order.bru
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

Reviewed the Phase 1 commerce-core: the oversell-safe reservation engine (`reserve`/`release`/`reserveBox`), server-resolved price/pack snapshotting, box BOM handling, RBAC guards, the staff-login auth boundary, and the commerce migration.

The core reservation primitive (`services/reservation.ts`) is genuinely sound: a single guarded conditional `UPDATE ... WHERE quota - reserved >= n` with DB-level CHECK constraints, exercised by an N-way HTTP race. The `POST /orders` path correctly resolves price/pack server-side (never trusting client fields), merges all draws into one global `(roundId, varietyId)` lock order to avoid deadlock, and rejects multi-round orders before reserving. The staff-login boundary is well built — role always read from the DB row, identical `invalid_credentials` for unknown-email vs wrong-password, and a constant-time dummy-hash verify to kill the timing side-channel.

However, the **cancel/status pipeline breaks the oversell guarantee under concurrency**: `PATCH /orders/:id/status` reads the order's current status *outside* the transaction and performs the stock release *inside* it, with no row lock and an unconditional status write. Two concurrent cancels (double-click / retry) both pass the transition gate on the same stale read and both run `release()`, driving `reserved_plants` down twice — freeing *other* orders' reservations and re-enabling oversell. The idempotency claimed in the code comments and the `cancel-release` test only holds for *sequential* cancels; the concurrent case is untested. This is a BLOCKER because stock correctness is the phase's stated core value.

Additional findings: the `prices` uniqueness index does not actually constrain the NULL-date default (Postgres treats NULLs as distinct), so duplicate defaults can be created and price resolution becomes non-deterministic; `qty` has no upper bound (int4 overflow → 500); direct orders bypass the variety/sale-unit soft-delete flag; and box BOM writes surface FK / duplicate-component failures as 500s.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Concurrent cancel double-releases stock → oversell (TOCTOU on order status)

**File:** `api/src/routes/orders.ts:506-566`
**Issue:**
`PATCH /orders/:id/status` reads the order status *before* the transaction (lines 509-513), validates the transition against that stale value (line 522), then opens a transaction that unconditionally releases stock and writes the new status (lines 527-562). The order row is never locked, and the status `UPDATE` has no `WHERE status = <expected>` guard.

Two concurrent `cancelled` requests for the same order (staff double-click, client retry, or two staff) both:
1. read `status = 'paid'` outside any transaction,
2. pass `canTransition('paid','cancelled')`,
3. enter their own transaction and call `release()` for every line.

`release()` is guarded only by `reserved_plants >= plants` on the `round_stock` row — a *per-row* guard, not a per-order one. When the round's `reserved_plants` still covers the amount (because *other live orders* also hold reservations on the same variety), the second release succeeds and decrements `reserved_plants` a second time. That silently frees stock belonging to other orders, letting a later customer reserve plants that are already committed — i.e. oversell, the exact failure this phase exists to prevent (NFR-02 / INV-06).

The code comment on lines 528-531 ("double-release can never drive reserved negative — double-safe with the canTransition gate above") is false under concurrency: the `canTransition` gate runs on a read taken *outside* the transaction, so both racers see `paid` and both proceed. The `cancel-release.test.ts` "second cancel keeps it at 0" case only covers *sequential* cancels (c1 fully completes and flips status to `cancelled` before c2 runs), so it never exercises this window.

**Fix:** Read (and lock) the order status *inside* the transaction and make the release conditional on the row actually transitioning:

```ts
await database.transaction(async (tx) => {
  // Lock the order row and re-read status INSIDE the tx.
  const [locked] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, ord.id))
    .for("update")
    .limit(1);
  if (!locked) throw new OrderError("order_not_found", 404);
  const current = locked.status as OrderStatus;      // authoritative, not the stale read
  if (!canTransition(current, next)) throw new OrderError("illegal_transition", 400);
  if (next === "cancelled" && current !== "cancelled") {
    // ... release loop (now runs at most once — the row lock serialises racers,
    //     and the second racer re-reads status = 'cancelled' and is rejected) ...
  }
  await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, ord.id));
});
```

With `SELECT ... FOR UPDATE`, the second racer blocks until the first commits, then re-reads `cancelled` and fails `canTransition` — release runs exactly once. Add a concurrent (Promise.all) double-cancel test alongside the existing sequential one.

## Warnings

### WR-01: `prices` unique index does not constrain the NULL-date default → duplicate defaults, non-deterministic price resolution

**File:** `api/src/db/schema.ts:128-135`, `api/drizzle/0001_commerce.sql:153`, `api/src/routes/prices.ts:63-80`
**Issue:**
The uniqueness intent is one price row per `(round, variety, tier, effective_date)`, with `effective_date IS NULL` meaning "the single round default". But PostgreSQL treats `NULL` values as *distinct* in a unique index by default, so `prices_round_variety_tier_date_idx` does **not** prevent multiple rows with `effective_date = NULL` for the same `(round, variety, tier)`. `POST /prices` is a plain `insert` (no upsert), so calling it twice without `effectiveDate` creates two competing "defaults". Resolution then does `ORDER BY effective_date DESC NULLS LAST LIMIT 1` (orders.ts:181, prices.ts:137, catalog.ts:64-66) — among two NULL rows the winner is arbitrary, so the resolved per-kg price (and every derived pack/subtotal snapshot) becomes non-deterministic. A money-correctness hazard reachable by ordinary staff actions.

**Fix:** Enforce a single default at the DB level — either a NULLS-not-distinct index (PG 15+) or a partial unique index:

```sql
CREATE UNIQUE INDEX prices_round_variety_tier_date_idx
  ON prices (round_id, variety_id, tier, effective_date) NULLS NOT DISTINCT;
-- or:
CREATE UNIQUE INDEX prices_default_uniq
  ON prices (round_id, variety_id, tier) WHERE effective_date IS NULL;
```

and have `POST /prices` upsert the default (`onConflictDoUpdate`) rather than blind-insert.

### WR-02: `qty` (and box `qty` / `plantsPerBox`) have no upper bound → int4 overflow returns 500

**File:** `api/src/routes/orders.ts:58,66,342-344`, `api/src/routes/boxes.ts:31`
**Issue:**
`OrderLineBody.qty` / `BoxLineBody.qty` are `t.Integer({ minimum: 1 })` with no `maximum`. `subtotalSatang = unitPriceSatang * qty` and `plantsDecremented = plantsPerUnit * qty` are written into `integer` (int4, max 2,147,483,647) columns. A caller sending a very large `qty` (or one that makes `subtotal` exceed int4) triggers a Postgres "integer out of range" error that is not caught (the `catch` on orders.ts:494 only maps `OrderError`) and surfaces as a 500. The atomic reserve guard still prevents actual oversell, but this is an unvalidated-input robustness gap (malformed 500 instead of a clean 422, and a cheap way to spray server errors).

**Fix:** Add a sane upper bound, e.g. `t.Integer({ minimum: 1, maximum: 100000 })` for `qty` and `plantsPerBox`, so oversized quantities are rejected at validation (422) before any DB write.

### WR-03: `POST /orders` does not honour the variety / sale-unit soft-delete flag

**File:** `api/src/routes/orders.ts:150-167,227-235`
**Issue:**
Soft-delete (`active = false`) is the documented mechanism to stop selling a variety or pack (varieties.ts:161-176). But the order path loads the sale unit and variety by id with **no `active` check** — unlike the box path (which does `eq(boxes.active, true)` on line 210) and the catalog (which filters `active`). A client that already knows a `varietyId` / `saleUnitId` (both are UUIDs returned by the public catalog before deletion) can keep ordering a discontinued variety or retired pack as long as a `round_stock` quota row and a price still exist, bypassing the soft-delete business rule and selling withdrawn inventory.

**Fix:** Filter on `active` when resolving lines, e.g. `.where(and(eq(saleUnits.id, line.saleUnitId), eq(saleUnits.active, true)))` and `.where(and(eq(varieties.id, line.varietyId), eq(varieties.active, true)))`, returning `invalid_line` / `variety_not_found` (400) otherwise. Apply the same to box components if inactive component varieties should not be sellable.

### WR-04: Box BOM writes surface FK / duplicate-component violations as 500

**File:** `api/src/routes/boxes.ts:103-135,138-177`
**Issue:**
`POST /boxes` and `PUT /boxes/:id` insert `body.components` without (a) verifying each `varietyId` exists, or (b) de-duplicating components. A non-existent `varietyId` violates `box_components_variety_id_varieties_id_fk`; two components with the same `varietyId` violate the `box_components_box_variety_idx` unique index. Both raise raw Postgres errors that propagate as uncaught 500s rather than a validated 400 on a staff-facing write.

**Fix:** Before insert, reject duplicate `varietyId`s in the payload (400 `duplicate_component`) and validate that every `varietyId` exists (select-in-list, 400 `invalid_component`), or catch the unique/FK violation and map it to a 400.

### WR-05: Status pipeline is a general read-outside-tx lost-update window (beyond cancel)

**File:** `api/src/routes/orders.ts:509-562`
**Issue:**
Related to CR-01 but broader: because the status read + `canTransition` check happen outside the transaction and the write is unconditional, *any* two concurrent transitions on the same order can both validate against the same stale status and both write. E.g. concurrent `paid→packing` and `paid→cancelled` both validate against `paid`; depending on commit order the order can end up `packing` while its stock was released by the cancel branch (or vice-versa), producing inconsistent order/stock state.

**Fix:** Same as CR-01 — perform the read, transition check, release, and status write atomically under `SELECT ... FOR UPDATE` on the order row. The single fix closes this entire class.

## Info

### IN-01: `reserveBox()` is exported but unused by production code

**File:** `api/src/services/reservation.ts:106-118`
**Issue:** `POST /orders` implements its own merged-draw reservation loop (orders.ts:403-426) that supersedes `reserveBox()` — it merges variety + box draws and sorts globally by `(roundId, varietyId)`. `reserveBox()` (which sorts only within one box's components) is now only referenced by tests. Keeping a second, narrower reservation path invites a future caller to use the one *without* the cross-order global lock ordering, reintroducing the deadlock window the merged loop was created to fix.
**Fix:** Either delete `reserveBox()` if the merged loop is the sole intended path, or document that production reservation MUST go through the merged `(roundId, varietyId)` ordering and mark `reserveBox` test-only.

### IN-02: Cancel release uses `ord.roundId` rather than the box snapshot's `roundId`

**File:** `api/src/routes/orders.ts:551`
**Issue:** Box components are released against `ord.roundId`, while `box_bom_json` stores its own `roundId` (orders.ts:483). This is correct only because the multi-round guard (orders.ts:315) forces a single round per order; the two values are equal today. If that invariant is ever relaxed, this silently releases against the wrong round.
**Fix:** Release box components against `bom.roundId` from the snapshot for defence-in-depth, or tie the line to the single-round invariant with a comment so it is revisited together.

### IN-03: `PATCH /orders/:id/status` echoes the requested `next` without re-reading committed state

**File:** `api/src/routes/orders.ts:564-565`
**Issue:** The response returns `{ id, status: next }` optimistically rather than the row's committed status. Once the CR-01 fix makes the transition conditional, the response should reflect what actually happened; otherwise a rejected/lost transition could still report success.
**Fix:** Return the authoritative status read inside the transaction after the write.

---

_Reviewed: 2026-07-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
