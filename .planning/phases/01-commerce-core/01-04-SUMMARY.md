---
phase: 01-commerce-core
plan: "04"
subsystem: api
tags: [catalog, public-reads, availability, sold-out, sale-mode, back-in-stock, pricing, elysia, typebox, drizzle, postgres]

# Dependency graph
requires:
  - phase: 01-01
    provides: "commerce schema (varieties/sale_units/rounds/round_stock/prices/back_in_stock_requests), deriveUnitPriceSatang(), seed helpers"
  - phase: 01-03
    provides: "make<Route>Routes(db) DI factory, OQ-2 price-resolution rule (dated-override-else-NULL-default), whole-baht derived pack price, requireRole gate"
provides:
  - "GET /catalog — OPEN public catalog: open rounds' sellable varieties grouped BY variety, each round with availability (quota−reserved), soldOut + label หมดรอบนี้, saleMode (preorder/ready), resolved b2c/b2b prices + derived pack prices (INV-08/SALE-04/SALE-01/SALE-02)"
  - "GET /catalog/rounds/:id — OPEN round-centric catalog view (its varieties + availability + prices); 404 unknown round"
  - "POST /stock/back-in-stock — OPEN data-only back-in-stock request record (no send, no auto-substitution — D-20)"
  - "GET /stock/back-in-stock — staff-gated (owner|admin) list of stored requests (T-01-16)"
  - "make{Catalog,Stock}Routes(db) DI factories + default instances mounted in index.ts"
affects: [01-05-mixed-box, 02-liff-checkout]

# Tech tracking
tech-stack:
  added: []  # no new packages — all deps pinned from Phase 0 (T-01-SC accept)
  patterns:
    - "In-memory price resolution: fetch prices WHERE effective_date IS NULL OR = today, then resolveTierPrice picks the dated-for-today row else the NULL default (reuses 01-03 OQ-2 rule without an extra per-row query)"
    - "Variety-centric grouping: catalog groups a variety's round_stock rows across all open rounds so one variety surfaces multiple rounds/modes on one product surface (SALE-04)"
    - "Derived saleMode: harvest_date > today ⇒ preorder (SALE-01) else ready (SALE-02), compared as YYYY-MM-DD strings (D-11)"
    - "availability = quota_plants − reserved_plants; soldOut = availability <= 0 ⇒ label หมดรอบนี้ (INV-08)"
    - "Public/staff split within stock.ts: POST open (customer self-service), GET requireRole('owner','admin') (list carries contacts)"

key-files:
  created:
    - api/src/routes/catalog.ts
    - api/src/routes/stock.ts
    - api/tests/catalog.test.ts
    - api/tests/soldout-notify.test.ts
  modified:
    - api/src/index.ts   # appended .use(catalogRoutes).use(stockRoutes)

key-decisions:
  - "In-memory price resolution over N per-(round,variety) queries: one pre-filtered prices fetch (effective_date IS NULL OR = today) then resolve per tier in JS — same OQ-2 result, fewer round-trips for a multi-variety catalog page."
  - "Catalog surfaces only active varieties + active sale_units and only varieties with a round_stock row in an open round — a customer never sees a soft-deleted variety or a variety not actually sellable this round."
  - "saleMode with a NULL harvest_date defaults to 'ready' (not-yet-scheduled ⇒ treated as ready-to-ship once available); the plan's two explicit modes are driven by dated rounds, so this only affects unscheduled rounds."
  - "Back-in-stock POST is open + data-only: it inserts a record and returns 201 with NO message send and NO stock mutation (D-20 verified — round_stock unchanged after a request)."

patterns-established:
  - "Public catalog contract (variety-grouped, per-round availability + saleMode + resolved prices) that Phase-2 LIFF consumes directly."
  - "Box availability is NOT yet in the catalog — it will be added in 01-05 as min(floor((quota−reserved)/plantsPerBox)) across a box's components."

requirements-completed: [INV-08, SALE-04, SALE-01, SALE-02]

# Metrics
duration: 6min
completed: 2026-07-03
---

# Phase 01 Plan 04: Public Catalog + Back-in-Stock Requests Summary

**The public, no-auth catalog that Phase-2 LIFF consumes — every open round's sellable varieties grouped by variety, each carrying live per-round availability (quota−reserved), the "หมดรอบนี้" sold-out label, the pre-order vs ready-to-ship sale mode derived from round harvest timing, and resolved b2c/b2b tiered prices with whole-baht derived pack prices — plus a data-only back-in-stock request endpoint that stores a customer's alert request without sending anything or auto-substituting stock (D-20).**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2 (both TDD)
- **Files created:** 4 · **Files modified:** 1
- **Tests added:** 12 (40 expect() calls), all green against real PostgreSQL 17

## Accomplishments

### Task 1 — Public catalog reads (`e02d7a6` RED → `51407d5` GREEN)
- `routes/catalog.ts` (`makeCatalogRoutes(db)`): no role guard (public, D-03).
  - `GET /catalog`: fetches open rounds → their `round_stock` → active `varieties` + active `sale_units` → prices pre-filtered to `effective_date IS NULL OR = today`. Groups by variety; each variety exposes its `saleUnits` and a `rounds[]` array where each entry has `availability = quota_plants − reserved_plants`, `soldOut`/`soldOutLabel` ("หมดรอบนี้" when availability ≤ 0), `saleMode` (`preorder` if `harvest_date > today` else `ready`), and resolved `prices.{b2c,b2b}` each with `packs[]` (per-sale_unit `unitPriceSatang = deriveUnitPriceSatang(kg, grams)`). Only varieties selling in ≥1 open round are returned.
  - `GET /catalog/rounds/:id`: the same surface scoped to one round (round-centric — round header + its varieties); `404 { error: "round_not_found" }` for an unknown id.
- Appended `.use(catalogRoutes)` to `index.ts` (append-only; frozen composition order preserved).
- `tests/catalog.test.ts`: one variety in two open rounds (future-harvest preorder + past-harvest ready, the second fully reserved) → asserts both `saleMode`s on the one variety (SALE-04), `availability` math, `soldOut` + "หมดรอบนี้" on the reserved round (INV-08), resolved b2c/b2b + whole-baht pack prices, no PII in the response (T-01-15), and the `/catalog/rounds/:id` view + 404.

### Task 2 — Back-in-stock request record, data-only (`8c0e4e3` RED → `e265abb` GREEN)
- `routes/stock.ts` (`makeStockRoutes(db)`):
  - OPEN `POST /stock/back-in-stock` `{ roundId, varietyId, customerId?, contact? }` inserts a `back_in_stock_requests` row → `201`. No message is sent and no stock is touched (D-20).
  - STAFF `GET /stock/back-in-stock` (`requireRole("owner","admin")`) lists the stored requests newest-first (the list carries contacts — T-01-16).
- Appended `.use(stockRoutes)` to `index.ts`.
- `tests/soldout-notify.test.ts`: a request for a sold-out variety → 201 + stored row; `round_stock` is unchanged after the POST (no send / no substitution, D-20); malformed ids → 422 (T-01-17); the staff GET returns 401 (no token) / 403 (packer) / 200 (admin, lists the just-submitted request).

## API Contracts (for 01-05 + Phase 2 LIFF)

**Public catalog (OPEN, D-03):**
- `GET /catalog` → `{ varieties: [{ id, name, category, description, imageUrl, avgGramsPerPlant, saleUnits: [{ id, kind, label, gramsPerUnit, plantsPerUnit }], rounds: [{ roundId, roundName, harvestDate, deliveryDate, saleMode: "preorder"|"ready", availability, soldOut, soldOutLabel: "หมดรอบนี้"|null, prices: { b2c: TierPrice|null, b2b: TierPrice|null } }] }] }`
  - `TierPrice = { pricePerKgSatang, effectiveDate, packs: [{ saleUnitId, kind, label, gramsPerUnit, unitPriceSatang }] }`.
  - `availability = quota_plants − reserved_plants`; `soldOut = availability <= 0`; `saleMode = harvest_date > today ? "preorder" : "ready"`.
- `GET /catalog/rounds/:id` → `{ round: { id, name, status, harvestDate, deliveryDate, saleMode }, varieties: [{ id, name, category, description, imageUrl, avgGramsPerPlant, saleUnits, availability, soldOut, soldOutLabel, prices }] }`. `404 { error:"round_not_found" }` if absent.

**Back-in-stock (INV-08 / D-20):**
- `POST /stock/back-in-stock { roundId(uuid), varietyId(uuid), customerId?(uuid), contact?(string) }` → `201` the stored `back_in_stock_requests` row. OPEN. Data-only: no send, no auto-substitution.
- `GET /stock/back-in-stock` (owner|admin Bearer) → `[ back_in_stock_requests rows ]` newest-first. `401` no/bad token, `403` wrong role.

## Decisions Made
- **In-memory price resolution** — one pre-filtered `prices` fetch (`effective_date IS NULL OR = today`) then `resolveTierPrice` picks the dated-for-today row else the NULL default. Same OQ-2 rule as `/prices/resolve` (01-03), fewer round-trips for a multi-variety page.
- **Only active + actually-sellable surfaces** — the catalog filters `varieties.active` and `sale_units.active` and drops varieties with no `round_stock` in an open round, so customers never see soft-deleted or non-sellable items.
- **Data-only back-in-stock** — POST stores and returns 201 with no side effects; a post-POST `round_stock` read proves reserved/quota are untouched (D-20).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree had no installed node_modules**
- **Found during:** setup. The parallel worktree is a fresh Bun workspace; test/tsc/biome binaries were absent.
- **Fix:** `bun install --frozen-lockfile` (installs only the pinned Phase-0 deps — no new packages, T-01-SC accept). No lockfile change committed.

**2. [Rule 3 - Blocking] Route DB wiring via DI factory (both routers)**
- **Found during:** Tasks 1 & 2 (writing the real-PG endpoint tests).
- **Issue:** The plan says add `dbPlugin` to the routes, but `dbPlugin` decorates with the runtime `db` (`.env.test` dummy `:5432`), not the `:55432` test container the tests seed.
- **Fix:** Exported `makeCatalogRoutes(db)` / `makeStockRoutes(db)` factories (defaults bind the runtime db) — the same DI pattern 01-02/01-03 established. `index.ts` composes the default instances via `.use(...)`.
- **Files:** the two route files + the two test files.
- **Verification:** all 12 target tests pass against real PG17; acceptance greps pass.
- **Committed in:** `51407d5`, `e265abb`.

**3. [Rule 1 - Bug] `requireRole` comment tripped the acceptance grep**
- **Found during:** Task 1 acceptance. `grep -c "requireRole" catalog.ts` must return 0 (public), but the header comment "NO requireRole" matched it (same false-positive class as 01-01's `sql.raw`).
- **Fix:** reworded the comment to "No role guard is mounted"; `grep -c "requireRole"` now returns 0. No behavior change (catalog was already unguarded).
- **Committed in:** `51407d5`.

**Total deviations:** 3 auto-fixed (2 blocking wiring, 1 grep false-positive). No scope creep — the DI factory is the faithful, more-robust rendering of the plan's real-PG-test intent, and still satisfies `.use(...Routes)` in `index.ts`.

## Threat Model Coverage
- **T-01-15 (catalog leaks PII)** — mitigated: catalog queries select only variety/sale_unit/round/price/stock fields; the test asserts the serialized response contains none of `recipient`/`phone`/`customerId`/`subtotalSatang`/`taxId`.
- **T-01-16 (non-staff reads the back-in-stock list of contacts)** — mitigated: `GET /stock/back-in-stock` guarded `requireRole("owner","admin")` (401/403/200 tested); only the POST is open.
- **T-01-17 (malformed ids)** — mitigated: TypeBox `format:"uuid"` on `roundId`/`varietyId` (malformed → 422 tested); Drizzle parameterized inserts/selects only.
- **T-01-SC (supply chain)** — accept: no new packages.

## Verification Evidence
- `docker compose -f api/tests/docker-compose.pg.yml up -d` (PG17 :55432, healthy).
- `bun test tests/catalog.test.ts tests/soldout-notify.test.ts` → **12 pass / 0 fail** (40 expect() calls).
- Full suite `bun test` → **97 pass / 1 fail**; the single fail is the pre-existing `tests/storage.test.ts` MinIO/R2 hook timeout (introduced 00-03, needs object-storage connectivity not up here — unrelated to 01-04). Already logged in `deferred-items.md`.
- `bunx tsc --noEmit` → exit 0. `biome check` → clean on all touched source + test files.
- Acceptance greps: `requireRole` in catalog.ts = 0 (public); `catalogRoutes` in index.ts = 2; `stockRoutes` in index.ts = 2; sold-out variety returns "หมดรอบนี้"; availability equals quota−reserved.

## Known Stubs
None. Every delivered endpoint is wired to real DB state and proven by real-PG tests.

## Out-of-Scope / Deferred
- **Box availability** is intentionally NOT in the catalog yet — boxes (mixed-salad BOM) land in 01-05, where catalog box availability will be `min(floor((quota−reserved)/plantsPerBox))` across a box's components (per 01-PATTERNS.md).
- `tests/storage.test.ts` MinIO/R2 hook timeout — pre-existing, environmental. Already logged in `deferred-items.md`.

## TDD Gate Compliance
- Task 1: `test(...)` RED (`e02d7a6`, module-not-found) → `feat(...)` GREEN (`51407d5`). Compliant.
- Task 2: `test(...)` RED (`8c0e4e3`, module-not-found) → `feat(...)` GREEN (`e265abb`). Compliant.
- No REFACTOR commits were needed (biome formatting folded into the GREEN commits).

## Next Phase Readiness
- **01-05 (mixed box)** adds boxes to the catalog surface (box availability formula) and reuses the price-resolution + variety-grouping patterns established here.
- **02 (LIFF checkout)** consumes `GET /catalog` (variety-grouped availability + saleMode + resolved prices) and `POST /stock/back-in-stock` directly.

---
*Phase: 01-commerce-core*
*Completed: 2026-07-03*

## Self-Check: PASSED
All 4 created files + the SUMMARY exist on disk; all 4 commits (`e02d7a6`, `51407d5`, `8c0e4e3`, `e265abb`) are present in git history. Working tree clean apart from the SUMMARY commit.
