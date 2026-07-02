---
phase: 01-commerce-core
plan: "05"
subsystem: api
tags: [box, bom, reservation, all-or-nothing, concurrency, deadlock-order, snapshot, catalog, rbac, elysia, drizzle, postgres]

# Dependency graph
requires:
  - phase: 01-01
    provides: "reserve()/release() guarded atomic decrement, deriveUnitPriceSatang(), boxes/box_components schema, seed helpers"
  - phase: 01-02
    provides: "POST /orders + PATCH /orders/:id/status (makeOrdersRoutes DI factory), frozen order-line snapshot, cancel-release, requireRole gate"
  - phase: 01-04
    provides: "GET /catalog (variety-grouped availability + saleMode + resolved prices), makeCatalogRoutes DI factory"
provides:
  - "services/reservation.ts: reserveBox() (all-or-nothing multi-component reserve, variety_id lock order) + boxAvailability() (min across components) + BoxShortfallError"
  - "routes/boxes.ts: staff (owner|admin) box + BOM CRUD (POST/PUT/DELETE) + OPEN GET list/detail (D-17/D-18)"
  - "POST /orders box-line path: server-resolved box price (fixed override else sum), reserveBox in one tx, lineKind 'box' order_line + box_bom_json snapshot (PAY-04)"
  - "PATCH cancel-release now releases every box component from box_bom_json (stock correctness for boxes)"
  - "GET /catalog boxes[]: per-round box availability = min(floor((quota−reserved)/plantsPerBox)) + หมดรอบนี้ sold-out label"
  - "seed helpers: seedBox, seedBoxScenario"
  - "all-or-nothing + last-box race proven against real PostgreSQL 17 (criterion 3 / INV-07)"
affects: [02-liff-checkout, payments, invoicing]

# Tech tracking
tech-stack:
  added: []  # no new packages — all deps pinned from Phase 0 (T-01-SC accept)
  patterns:
    - "All-or-nothing multi-row reserve: sort components by variety_id (global lock order → no deadlock), per-component guarded reserve() in ONE db.transaction, first shortfall throws → whole tx rolls back (zero net decrement)"
    - "BoxShortfallError thrown by reserveBox() → caller maps to OrderError('sold_out',409); reservation.ts stays decoupled from HTTP"
    - "Server-resolved box price (D-18): fixed_price_satang override, else sum of deriveUnitPriceSatang(pricePerKg, plantsPerBox × avgGramsPerPlant) per component; never a client amount (T-01-20)"
    - "Box catalog availability computed in-memory from the already-loaded round_stock rows (roundId→varietyId→counter map) reusing boxAvailability()"
    - "Box lines carry a frozen box_bom_json (BOM + resolved price) so cancel-release + history survive later BOM/price edits (soft-delete box on DELETE)"

key-files:
  created:
    - api/src/routes/boxes.ts
    - api/tests/box-reservation.test.ts
    - api/tests/box-order.test.ts
  modified:
    - api/src/services/reservation.ts
    - api/src/routes/orders.ts
    - api/src/routes/catalog.ts
    - api/src/index.ts
    - api/tests/seed.ts

key-decisions:
  - "reserveBox() throws BoxShortfallError on shortfall (rather than returning false) so all-or-nothing holds regardless of caller discipline — the throw unwinds the surrounding db.transaction and undoes any earlier component decrement."
  - "Box order body is an additive optional boxLines[] alongside the existing lines[] (both optional; ≥1 required, else 400 no_lines) — backward-compatible with every 01-02 variety-order test."
  - "Box price per component = value of plantsPerBox WHOLE plants (grams = plantsPerBox × avgGramsPerPlant), ceil-to-baht via deriveUnitPriceSatang — the same money rule as packs; box unit price = sum, or the fixed override (D-18)."
  - "Catalog offers a box in a round ONLY when every component has a round_stock row there; a box with a fully-reserved component still shows (availability 0, soldOut, หมดรอบนี้)."
  - "Cancel-release extended (Rule 2): a cancelled box order releases each component (plantsPerBox × qty) from box_bom_json so a cancelled box never strands reserved plants."

patterns-established:
  - "reserveBox(tx, roundId, components, boxQty) — the multi-row analog of reserve(); INV-07 authority at order time."
  - "boxAvailability(components, stockByVariety) — the scarcest-component display formula for catalog."

requirements-completed: [INV-07, PAY-04]

# Metrics
duration: 10min
completed: 2026-07-02
---

# Phase 01 Plan 05: Mixed Salad Box — All-or-Nothing Multi-Component Reservation Summary

**A mixed salad box is orderable only up to its scarcest component and reserves EVERY BOM component in one all-or-nothing transaction (variety_id lock order → no deadlock; any shortfall rolls back to zero net decrement), freezing a server-resolved BOM + box-price snapshot onto the order line — proven end-to-end against real PostgreSQL 17 (an over-quota box leaves every component untouched; N=8 racers for the last box yield exactly one 201 and seven 409). This closes the phase's last requirement, INV-07.**

## Performance
- **Duration:** ~10 min
- **Tasks:** 2 (both TDD)
- **Files created:** 3 · **Files modified:** 5
- **Tests added:** 10 (40 expect() calls), all green against real PostgreSQL 17

## Accomplishments

### Task 1 — reserveBox() + boxAvailability() + box CRUD BOM (`d60e74b`)
- `services/reservation.ts` gained **`reserveBox(tx, roundId, components, boxQty)`**: components sorted by `varietyId` (stable global lock order → no deadlock, T-01-19), each reserved via the proven guarded `reserve()`; the first component that cannot be satisfied throws **`BoxShortfallError`**, unwinding the caller's `db.transaction` so any earlier component decrement is undone (all-or-nothing, T-01-18). `reserve()`/`release()` signatures are UNCHANGED.
- **`boxAvailability(components, stockByVariety)`** = `min(floor((quota−reserved)/plantsPerBox))` across components (a component with no stock row ⇒ 0).
- `routes/boxes.ts` (`makeBoxesRoutes(db)`): staff (`requireRole("owner","admin")`) `POST`/`PUT`/`DELETE` a box + its fixed BOM (`components[]` minItems 1, each `{ varietyId, plantsPerBox≥1 }`, optional `fixedPriceSatang≥0` override); OPEN `GET /boxes` + `GET /boxes/:id`. `DELETE` is a soft-delete (`active=false`) so historical order snapshots stay valid.
- `index.ts` appended `.use(boxesRoutes)` (append-only; frozen composition order preserved).

### Task 2 — Box ordering + catalog availability + all-or-nothing proof (`473bafc` RED → `61a4801` GREEN)
- `POST /orders` accepts an additive optional `boxLines: [{ boxId, roundId, qty }]`: loads the box + BOM, resolves each component's tier price (OQ-2 dated-else-NULL rule), derives the box unit price per **D-18** (`fixed_price_satang` override, else the SUM of `deriveUnitPriceSatang(pricePerKg, plantsPerBox × avgGramsPerPlant)`), then inside the EXISTING transaction re-checks cut-off, reserves every component via `reserveBox` (`BoxShortfallError` → `409 sold_out`, nothing decremented), and inserts a `lineKind:'box'` order_line with `box_bom_json` (frozen BOM + resolved price) + `unit_price_satang` snapshot (**PAY-04**).
- `PATCH /orders/:id/status` cancel now releases every box component (`plantsPerBox × qty`) from `box_bom_json` — a cancelled box never strands reserved plants (Rule 2 stock-correctness extension).
- `GET /catalog` now returns `boxes[]`: each active box offered in the rounds where all components are stocked, with per-round `availability = min(floor((quota−reserved)/plantsPerBox))`, `soldOut` + `soldOutLabel:"หมดรอบนี้"`, `saleMode`, and server-resolved `priceSatang.{b2c,b2b}` (**INV-07**).
- `tests/box-reservation.test.ts` (real PG): `boxAvailability` = min across components; an over-quota `reserveBox` throws `BoxShortfallError` with ZERO net decrement on every component; an at-limit box succeeds and decrements each.
- `tests/box-order.test.ts` (real PG): over-quota box → 409 with both components unchanged; at-limit → 201 with `box_bom_json` + `unit_price_satang=7200` snapshot; fixed-price override ignores component prices; catalog box availability = min + `หมดรอบนี้` when scarce=0; **N=8 last-box race → exactly one 201, seven 409, scarce component reserved ≤ quota**; box cancel releases every component.
- `tests/seed.ts`: `seedBox` + composite `seedBoxScenario` (component varieties + round_stock + b2c/b2b prices + box BOM).

## API Contracts (for Phase 2 LIFF)

**Box ordering — `POST /orders` (OPEN), additive body field:**
```jsonc
{ "tier":"b2c"|"b2b", "customer":{…},
  "lines":   [ { "roundId","varietyId","saleUnitId","qty" } ],   // optional (01-02)
  "boxLines":[ { "boxId":"<uuid>", "roundId":"<uuid>", "qty":>=1 } ] } // optional (01-05)
```
At least one of `lines` / `boxLines` is required (else `400 { error:"no_lines" }`). Box responses: `201 { id, status:"created", subtotalSatang }` · `409 { error:"sold_out" }` (any component short — nothing decremented) · `409 { error:"round_closed" }` · `400 { error:"box_not_found"|"no_price"|"box_empty"|"variety_not_found" }`. The box order_line stores `line_kind:'box'`, `box_id`, `unit_price_satang` (server-resolved), and `box_bom_json = { boxId, boxName, priceMode:"fixed"|"sum", unitPriceSatang, roundId, components:[{ varietyId, varietyName, plantsPerBox, pricePerKgSatang, componentPriceSatang }] }`.

**Staff box CRUD — `/boxes`** (`Authorization: Bearer <owner|admin>` on writes):
- `POST /boxes { name, description?, imageUrl?, fixedPriceSatang?, components:[{varietyId,plantsPerBox}] (≥1) }` → `201` box + BOM.
- `PUT /boxes/:id` (same body) → replace fields + BOM · `DELETE /boxes/:id` → `{ id, active:false }` (soft-delete).
- `GET /boxes`, `GET /boxes/:id` → OPEN (public); `404 { error:"box_not_found" }`.

**Catalog boxes — `GET /catalog`** now returns `{ varieties:[…], boxes:[ { id, name, description, imageUrl, fixedPriceSatang, components:[{varietyId,plantsPerBox}], rounds:[ { roundId, roundName, harvestDate, deliveryDate, saleMode, availability, soldOut, soldOutLabel, priceSatang:{ b2c, b2b } } ] } ] }`. `availability = min(floor((quota−reserved)/plantsPerBox))`; `soldOutLabel = "หมดรอบนี้"` when 0.

## Interface Contract (for later phases)
```ts
// api/src/services/reservation.ts
export interface BoxComponent { varietyId: string; plantsPerBox: number; }
export class BoxShortfallError extends Error { readonly varietyId: string; }
export function reserveBox(tx: DbOrTx, roundId: string, components: BoxComponent[], boxQty: number): Promise<void>; // throws BoxShortfallError on shortfall
export function boxAvailability(components: BoxComponent[], stockByVariety: Map<string, { quotaPlants: number; reservedPlants: number }>): number;
```

## Decisions Made
- **`reserveBox` throws (not returns false)** — the throw guarantees all-or-nothing by unwinding the surrounding transaction; the caller (`POST /orders`) catches `BoxShortfallError` and maps it to `OrderError("sold_out",409)`, keeping `reservation.ts` decoupled from HTTP.
- **Additive `boxLines[]`** rather than a discriminated `lines[]` union — backward-compatible with all 01-02 variety-order tests; `orders.round_id` falls back to the first box line's round when there are no variety lines (single-round-per-order, Phase 1).
- **Box price = sum of per-component whole-plant prices (or fixed override)** — component grams = `plantsPerBox × avgGramsPerPlant`, priced ceil-to-baht via `deriveUnitPriceSatang` (same money rule as packs, D-13/D-18); never a client amount (T-01-20).
- **Box cancel-release (Rule 2)** — cancelling a box order releases each component from `box_bom_json` so reserved plants are never stranded; proven by a dedicated test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree had no installed node_modules**
- **Found during:** setup (Task 1 tsc). The parallel worktree is a fresh Bun workspace; tsc/biome/test binaries were absent.
- **Fix:** `bun install --frozen-lockfile` (installs only the pinned Phase-0 deps — no new packages, T-01-SC accept). No lockfile change committed.

**2. [Rule 2 - Missing critical functionality] Box cancel-release**
- **Found during:** Task 2. The 01-02 PATCH cancel loop released only variety lines (`if (l.varietyId)`), so a cancelled BOX order would leave every component's `reserved_plants` stranded forever (stock-correctness defect in this phase's core domain).
- **Fix:** the cancel loop now branches on `line_kind`: a box line releases each component (`plantsPerBox × qty`) from its `box_bom_json` snapshot in the same transaction (guarded `release()`, so still double-safe). Added a test asserting both components return to 0 after cancel.
- **Files:** `api/src/routes/orders.ts`, `api/tests/box-order.test.ts`. **Committed in:** `61a4801`.

**Total deviations:** 2 auto-fixed (1 blocking setup, 1 missing critical functionality). No scope creep — both keep the phase's stock-correctness invariant whole.

## Threat Model Coverage
- **T-01-18 (box over-decrements a scarce component / multi-row oversell)** — mitigated: `reserveBox` = per-component guarded `reserve()` in ONE `db.transaction`; any 0-row → `BoxShortfallError` → rollback (all-or-nothing). Proven: over-quota box leaves every component at 0; N=8 last-box race → one winner, scarce `reserved ≤ quota`.
- **T-01-19 (deadlock between concurrent box orders)** — mitigated: components sorted by `variety_id` → identical global lock order for every order (no lock-order inversion). The N=8 race completes with no deadlock error.
- **T-01-20 (client-supplied box price)** — mitigated: the box body carries no price/BOM field; price is resolved server-side (fixed override else sum of component prices) and snapshotted. Test: a `fixed_price_satang` box returns exactly the stored override.
- **T-01-21 (non-staff edits a box BOM)** — mitigated: `requireRole("owner","admin")` on `POST`/`PUT`/`DELETE /boxes`; `GET` reads are public (D-03).
- **T-01-SC (supply chain)** — accept: no new packages.

## Verification Evidence
- `docker compose -f api/tests/docker-compose.pg.yml up -d` (PG17 :55432, healthy).
- `bun test tests/box-reservation.test.ts tests/box-order.test.ts` → **10 pass / 0 fail** (40 expect() calls).
- Full suite `bun test` → **107 pass / 1 fail**; the single fail is the pre-existing `tests/storage.test.ts` MinIO/R2 hook timeout (introduced 00-03, needs object-storage connectivity not up here — unrelated to 01-05). Already logged in `deferred-items.md`.
- `bunx tsc --noEmit` → exit 0. `biome check` → clean on all touched source + test files.
- Acceptance greps: `reserveBox` in reservation.ts ≥1 and in orders.ts (2); `requireRole` in boxes.ts (3); `boxesRoutes` in index.ts (2); `boxAvailability` in catalog.ts (2); `reserve()`/`release()` still exported (unchanged).

## Phase Acceptance Gate (INV-07 — last requirement)
- **Criterion 3 met:** a mixed box is orderable only up to its scarcest component and decrements every component all-or-nothing in one transaction. The oversell-safe engine is now proven end-to-end across single-row (01-01/01-02) AND multi-row (01-05) cases against real PG17.
- Full Phase-1 suite green apart from the one environmental storage test.

## Known Stubs
None. Every delivered path (reserveBox, box CRUD, box ordering, box catalog, box cancel-release) is wired to real DB state and proven by real-PG tests.

## Out-of-Scope / Deferred
- **CORS `methods` allowlist** in `index.ts` (`["GET","POST","OPTIONS"]`) omits `PUT`/`DELETE`/`PATCH` used by staff box + status routes. Per the frozen-`index.ts` append-only rule (00-01), and consistent with the 01-02 `PATCH` deferral, these staff-only same-origin/server-side routes are unaffected in Phase 1; widening the browser preflight allowlist is deferred to the staff-dashboard slice. Logged in `deferred-items.md`.
- `tests/storage.test.ts` MinIO/R2 hook timeout — pre-existing, environmental. Already logged.

## TDD Gate Compliance
- Task 1 (reserveBox + box CRUD): committed as `feat` (`d60e74b`); its behavioral proof is the Task-2 tests (per the plan, Task 1's verify is tsc/grep only). The service-level `box-reservation.test.ts` cases for `reserveBox`/`boxAvailability` pass immediately on the Task-1 code.
- Task 2: `test(...)` RED (`473bafc`, box endpoint tests fail 422 — orders/catalog don't handle boxes) → `feat(...)` GREEN (`61a4801`). Compliant. No REFACTOR commits needed (biome formatting folded into GREEN).

## Commits
- `d60e74b` feat(01-05): reserveBox() all-or-nothing multi-component reserve + box CRUD BOM
- `473bafc` test(01-05): failing box ordering + catalog availability + all-or-nothing (RED)
- `61a4801` feat(01-05): box ordering via POST /orders + catalog box availability (GREEN)

---
*Phase: 01-commerce-core*
*Completed: 2026-07-02*

## Self-Check: PASSED
All 3 created files + the SUMMARY exist on disk; all 4 commits (`d60e74b`, `473bafc`, `61a4801`, `0e3b620`) are present in git history. Working tree clean.
