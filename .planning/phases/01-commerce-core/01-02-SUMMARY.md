---
phase: 01-commerce-core
plan: "02"
subsystem: api
tags: [orders, elysia, typebox, drizzle, postgres, reservation, rbac, jwt, concurrency, snapshot]

# Dependency graph
requires:
  - phase: 01-01
    provides: "reserve()/release() (atomic stock), deriveUnitPriceSatang(), canTransition()/TRANSITIONS, 12-table commerce schema, seed helpers"
provides:
  - "POST /orders — open, atomic, server-resolved frozen price/pack snapshot (D-02/D-16); the seam Phase 2 LIFF calls"
  - "PATCH /orders/:id/status — staff-guarded (owner|admin) transition pipeline with idempotent cancel-release (D-03/D-08)"
  - "makeOrdersRoutes(db) factory + default ordersRoutes (mounted in index.ts)"
  - "seed helpers: seedSaleUnit, seedPrice, seedSellableLine"
  - "end-to-end no-oversell proof at the HTTP boundary (criterion 2)"
  - "Bruno orders collection: create-order.bru + Promise.all parallel racer race.ts"
affects: [02-liff-checkout, 01-04-catalog, 01-05-mixed-box, payments, invoicing]

# Tech tracking
tech-stack:
  added: []  # no new packages — all deps pre-existing + pinned from Phase 0 (T-01-SC accept)
  patterns:
    - "Route DB dependency-injection via make<Route>Routes(db) factory + default bound to runtime db (mirrors makeHealthRoutes)"
    - "One db.transaction: re-check cut-off (Pitfall 6) → reserve() per line → insert order + frozen snapshot; throw-to-rollback with a typed OrderError→HTTP map"
    - "Server-resolved price snapshot: NEVER trust a client price/plants field (T-01-06); resolve by tier with dated-override-else-NULL-default (OQ-2)"
    - "requireRole('owner','admin') as an Elysia beforeHandle guard — first real mount of the Phase-0 RBAC helper"
    - "Idempotent cancel-release: canTransition gate + guarded release() (double-safe, Pitfall 5)"

key-files:
  created:
    - api/src/routes/orders.ts
    - api/tests/order-snapshot.test.ts
    - api/tests/round-cutoff.test.ts
    - api/tests/order-endpoint-race.test.ts
    - api/tests/cancel-release.test.ts
    - bruno/Saladee/orders/create-order.bru
    - bruno/Saladee/orders/race.ts
  modified:
    - api/src/index.ts
    - api/tests/seed.ts

key-decisions:
  - "Route DB injection (factory) over app.handle + env override — robust in both isolated and full-suite runs; matches makeHealthRoutes precedent"
  - "order.round_id = first line's round; single-round-per-order for Phase 1 (multi-round out of scope)"
  - "Price resolution: filter effective_date IS NULL OR = today, ORDER BY effective_date DESC NULLS LAST → dated-today wins over the NULL default (OQ-2)"
  - "Second cancel returns 400 illegal_transition (cancelled is terminal) AND leaves reserved unchanged — idempotency holds at both the gate and the guarded release()"

patterns-established:
  - "make<Route>Routes(db) DI factory for DB-touching routes"
  - "Typed OrderError(code, httpStatus) thrown inside a tx → caught → set.status + { error } (rollback-safe)"

requirements-completed: [PLAT-01, INV-06, ORD-02, PAY-04, CUST-01, INV-09, SALE-01, SALE-02, PLAT-03]

# Metrics
duration: 11min
completed: 2026-07-02
---

# Phase 01 Plan 02: Orders Endpoint + Staff Status Pipeline Summary

**Open `POST /orders` reserves stock atomically inside one transaction with a fully server-resolved frozen price/pack snapshot, and staff `PATCH /orders/:id/status` drives the RBAC-guarded transition pipeline with idempotent cancel-release — end-to-end no-oversell proven against real PostgreSQL 17 (exactly one 201 of N=8 racers, reserved never exceeds quota).**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-02T16:51:49Z
- **Completed:** 2026-07-02T17:02:13Z
- **Tasks:** 3 (all TDD)
- **Files created:** 7 · **Files modified:** 2

## Accomplishments
- `POST /orders` (open, D-03): resolves the customer (guest insert / member validate), resolves the price by tier (dated override else NULL default, OQ-2), computes the unit price via `deriveUnitPriceSatang`, then in ONE `db.transaction` re-checks the round cut-off (Pitfall 6), reserves every line atomically, and persists the order + full D-16 snapshot. Sold-out → 409 rollback; closed/past-cutoff → 409 `round_closed`.
- Client price/plants are never trusted (T-01-06): the body schema has no price/plants field; a request carrying a bogus `unitPriceSatang` stores the server-derived value (proven by test).
- `PATCH /orders/:id/status` (staff-only, D-03/PLAT-03): `requireRole("owner","admin")` beforeHandle guard (401/403), `canTransition()` gate (illegal → 400, incl. `done→cancelled` per D-08), and a `cancelled` entry releases the order's reserved plants in the same transaction — idempotently (Pitfall 5).
- End-to-end oversell proof at the HTTP boundary: N=8 parallel `POST /orders` for the last pack → exactly one 201, seven 409, `reserved_plants === quota_plants` (oversell rate 0).
- Bruno `orders` collection: `create-order.bru` + a `Promise.all` K-way parallel `race.ts` for the manual Criterion-2 demo.

## Task Commits

1. **Task 1: POST /orders + wire index.ts** — `73b6a6b` (test/RED) → `a2c880c` (feat/GREEN)
2. **Task 2: End-to-end oversell proof + Bruno racer** — `ee0939d` (test)
3. **Task 3: PATCH /orders/:id/status staff pipeline + cancel-release** — `ba2a61e` (test/RED) → `4ba4a19` (feat/GREEN)

## Files Created/Modified
- `api/src/routes/orders.ts` — `makeOrdersRoutes(db)` factory + default `ordersRoutes`; open POST + staff PATCH.
- `api/src/index.ts` — appended `.use(ordersRoutes)` (kept the frozen composition order; append-only).
- `api/tests/seed.ts` — added `seedSaleUnit`, `seedPrice`, `seedSellableLine` helpers.
- `api/tests/order-snapshot.test.ts` — happy path + snapshot immutability + client-price-ignored (real PG).
- `api/tests/round-cutoff.test.ts` — closed round + past-cutoff round rejected with no reservation.
- `api/tests/order-endpoint-race.test.ts` — N=8 endpoint race, `Promise.allSettled`, pool max ≥ N.
- `api/tests/cancel-release.test.ts` — 401/403/200 auth boundary, illegal-transition 400, idempotent cancel-release.
- `bruno/Saladee/orders/create-order.bru`, `bruno/Saladee/orders/race.ts` — manual create + parallel racer.

## API Contract (for Phase 2 LIFF)

`POST /orders` (open) — body:
```jsonc
{
  "tier": "b2c" | "b2b",
  "customer": { "customerId": "<uuid>" }            // member
             | { "name","phone","recipientName","recipientPhone","recipientAddress" }, // guest
  "substitutionPolicy": "allow" | "disallow",        // optional, default "disallow"
  "taxId": "<string>",                                // optional
  "lines": [ { "roundId":"<uuid>", "varietyId":"<uuid>", "saleUnitId":"<uuid>", "qty": >=1 } ]  // NO price/plants
}
```
Responses: `201 { id, status:"created", subtotalSatang }` · `409 { error:"sold_out" }` · `409 { error:"round_closed" }` · `400 { error:"invalid_line"|"variety_not_found"|"no_price"|"customer_not_found" }` · `422` (schema validation).

`PATCH /orders/:id/status` (staff, `Authorization: Bearer <owner|admin session>`) — body `{ "status": <order_status> }`.
Responses: `200 { id, status }` · `401` (no/bad token) · `403` (wrong role) · `400 { error:"illegal_transition" }` · `404 { error:"order_not_found" }`.

**Price-resolution rule:** for (round, variety, tier) pick the row whose `effective_date` = today; else the `effective_date IS NULL` round default (`ORDER BY effective_date DESC NULLS LAST LIMIT 1`). Unit price = `deriveUnitPriceSatang(price_per_kg_satang, grams_per_unit)` (ceil-to-whole-baht), snapshotted onto `order_lines`.

## Decisions Made
- **Route DB dependency-injection** via `makeOrdersRoutes(db)` (default binds the runtime db) instead of `app.handle` + an env override. The runtime `db` (client.ts) reads `env.DATABASE_URL`, which `.env.test` points at a dummy `:5432` while the real test container is `:55432`; injecting the direct test pool (max ≥ N) is robust in both isolated and full-suite runs and mirrors the existing `makeHealthRoutes(db)` precedent. `ordersRoutes` is still mounted in `index.ts` for production.
- **Single round per order** for Phase 1: `orders.round_id` = the first line's round; cancel-release uses `orders.round_id` + `order_lines.variety_id` + `plants_decremented` (order_lines carries no round_id).
- **Second cancel** returns `400 illegal_transition` (cancelled is terminal in `TRANSITIONS`) and leaves `reserved_plants` unchanged — the no-double-release invariant holds at both the transition gate and the guarded `release()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Route DB wiring for endpoint tests**
- **Found during:** Task 1 (writing the real-PG endpoint tests)
- **Issue:** The plan says race/snapshot tests fire against `app.handle`, but the app's runtime `db` uses `env.DATABASE_URL` (`.env.test` → dummy `:5432`), not the `:55432` test container the tests seed. Using `app.handle` would hit the wrong/unreachable DB and could not set the pool `max ≥ N` required by Pitfall 2.
- **Fix:** Exported a `makeOrdersRoutes(db)` factory (default binds the runtime db) and injected the direct test pool in tests — the same DI pattern `routes/health.ts` already uses (`makeHealthRoutes(db)`). `index.ts` still composes the default `ordersRoutes`.
- **Files modified:** api/src/routes/orders.ts (factory), the four test files.
- **Verification:** All 13 target tests pass against real PG17; `grep -c ordersRoutes src/index.ts` = 2.
- **Committed in:** `a2c880c`, `ee0939d`, `4ba4a19`.

**2. [Rule 2 - Missing test infra] seed helpers for sale units + prices**
- **Found during:** Task 1
- **Issue:** `seed.ts` (from 01-01) had no sale-unit/price seeders, which the order endpoint needs.
- **Fix:** Added `seedSaleUnit`, `seedPrice`, and a composite `seedSellableLine` (variety + sale unit + open round + stock + b2c default price).
- **Files modified:** api/tests/seed.ts
- **Verification:** Used by all four 01-02 test files; suite green.
- **Committed in:** `73b6a6b`.

---

**Total deviations:** 2 auto-fixed (1 blocking wiring, 1 missing test infra).
**Impact on plan:** No scope creep — the DI factory is a faithful, more-robust rendering of the plan's "endpoint race against real PG" intent, and still satisfies `.use(ordersRoutes)` in index.ts. All plan behaviors delivered.

## Threat Model Coverage
- **T-01-05 (oversell under concurrency)** — mitigated: guarded `reserve()` inside `db.transaction`; N=8 endpoint race proves exactly one winner, `reserved ≤ quota`.
- **T-01-06 (client price/plants tampering)** — mitigated: body schema has no price/plants field; server resolves price by tier and computes the snapshot (test asserts a bogus client price is ignored).
- **T-01-07 (unauth/wrong-role status change)** — mitigated: `requireRole("owner","admin")` on PATCH (401/403 tested); POST stays open by design (D-03).
- **T-01-08 (double-cancel double-release)** — mitigated: `canTransition` gate + guarded `release()` (`reserved >= n`); idempotency asserted.
- **T-01-09 (negative/zero qty)** — mitigated: `qty: t.Integer({ minimum: 1 })` + DB CHECK `qty > 0`.
- **T-01-10 (customer PII via order reads)** — PATCH is staff-guarded; no public order-read endpoint added this plan.

## Verification Evidence
- `docker compose -f api/tests/docker-compose.pg.yml up -d` (PG17 :55432, healthy).
- `bun test tests/order-snapshot.test.ts tests/round-cutoff.test.ts tests/order-endpoint-race.test.ts tests/cancel-release.test.ts` → **13 pass / 0 fail** (50 expect() calls).
- Full suite `bun test` → **63 pass / 1 fail**; the single fail is the pre-existing `tests/storage.test.ts` MinIO/R2 hook timeout (introduced in 00-03, requires object-storage connectivity not up here — unrelated to 01-02). Logged in `deferred-items.md`.
- `bunx tsc --noEmit` → exit 0. `biome check` → clean on all touched files.
- Acceptance greps: `ordersRoutes` in index.ts = 2; `requireRole` present only on the PATCH beforeHandle (POST has no guard); `Promise.allSettled` in the race test = 1; `Promise.all` in `race.ts` = 3.

## Known Stubs
None. Every delivered path (POST, PATCH, snapshot, reserve/release) is wired to real DB state and proven by real-PG tests.

## Issues Encountered
- Endpoint tests initially failed `tsc` on the injected-db generic (`PostgresJsDatabase<Record<string,never>>` vs the schema-typed handle) and one possibly-undefined destructure — fixed by typing `OrdersDb = PostgresJsDatabase<typeof schema>` and guarding the row access.

## Out-of-Scope / Deferred
- `tests/storage.test.ts` MinIO/R2 hook timeout — pre-existing, environmental. Logged.
- CORS `methods` allowlist in `index.ts` omits `PATCH`; `PATCH /orders/:id/status` is staff-only with no browser frontend in Phase 1. Per the plan's append-only rule for the frozen `index.ts` cors config, adding `PATCH` to the browser preflight allowlist is deferred to the staff-dashboard slice. Same-origin / server-side callers and `app.handle` are unaffected. Logged in `deferred-items.md`.

## TDD Gate Compliance
- Task 1: `test(...)` RED (`73b6a6b`, module-not-found) → `feat(...)` GREEN (`a2c880c`). Compliant.
- Task 3: `test(...)` RED (`ba2a61e`, PATCH 404) → `feat(...)` GREEN (`4ba4a19`). Compliant.
- Task 2 is a measurement/proof task over the Task-1 endpoint (no new source behavior) → single `test(...)` commit (`ee0939d`). No REFACTOR commits were needed.

## Next Phase Readiness
- `POST /orders` is the open, typed seam Phase 2 LIFF calls (Eden Treaty types flow from `index.ts`). Contract documented above.
- 01-04 (catalog reads) and 01-05 (mixed box) can reuse `seedSellableLine` and the reservation-in-transaction pattern.
- Concern for a later slice: extend the CORS `methods` allowlist when a staff browser dashboard consumes PATCH.

---
*Phase: 01-commerce-core*
*Completed: 2026-07-02*

## Self-Check: PASSED
All 8 created files exist on disk; all 5 task commits (`73b6a6b`, `a2c880c`, `ee0939d`, `ba2a61e`, `4ba4a19`) are present in git history.
