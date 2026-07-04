---
phase: 01-commerce-core
plan: "03"
subsystem: api
tags: [catalog, varieties, rounds, prices, pricing, rbac, auth, staff-login, elysia, typebox, drizzle, postgres]

# Dependency graph
requires:
  - phase: 01-01
    provides: "deriveUnitPriceSatang(), 12-table commerce schema (varieties/sale_units/rounds/round_stock/prices/users), seed helpers, OQ-2 nullable effective_date"
  - phase: 01-02
    provides: "make<Route>Routes(db) DI factory precedent, requireRole first real mount, price-resolution rule (dated-override-else-NULL-default)"
provides:
  - "GET /varieties, GET /varieties/:id — OPEN public catalog reads with sale_units (the seam 01-04 catalog consumes)"
  - "POST/PUT/DELETE /varieties — staff-gated variety+sale_units CRUD (INV-01/INV-03)"
  - "GET /rounds, GET /rounds/:id — OPEN round reads with round_stock; POST /rounds, POST /rounds/:id/stock (quota upsert), PATCH /rounds/:id/status — staff-gated (INV-05/D-09)"
  - "POST/PUT /prices — staff-gated price CRUD; GET /prices (history) + GET /prices/resolve — the OQ-2 price+auto-pack resolution 01-04 reuses (INV-02/INV-04)"
  - "REAL POST /auth/staff — users-lookup-by-email + stored-hash verify + row role; the Phase-0 forgery path is closed (PLAT-03/D-07/T-01-22)"
  - "make{Varieties,Rounds,Prices,Auth}Routes(db) DI factories + default instances mounted in index.ts"
affects: [01-04-catalog, 01-05-mixed-box, 02-liff-checkout, payments]

# Tech tracking
tech-stack:
  added: []  # no new packages — all deps pre-existing + pinned from Phase 0 (T-01-SC accept)
  patterns:
    - "make<Route>Routes(db) DI factory + default bound to runtime db (mirrors makeOrdersRoutes/makeHealthRoutes) — used for varieties, rounds, prices AND the rewritten auth route"
    - "requireRole('owner','admin') as a per-write-route beforeHandle; OPEN GET reads carry no guard (deny-by-default writes, public reads — D-03)"
    - "Price resolution reused from 01-02: filter (round,variety,tier) AND (effective_date IS NULL OR = date) ORDER BY effective_date DESC NULLS LAST LIMIT 1 (OQ-2)"
    - "Auto pack price = deriveUnitPriceSatang(resolved kg, grams_per_unit) computed at read time (INV-04 — no stored derived price, whole-baht)"
    - "round_stock quota upsert via onConflictDoUpdate on (round_id, variety_id) — set the manual sellable quantity idempotently (INV-05)"
    - "Real staff login: users lookup by email → verifyPassword vs STORED hash → issueSession(row.id, row.role); identical 401 for unknown-email and wrong-password (no enumeration)"
    - "Money is ALWAYS integer satang: t.Integer({minimum:0}) on price/quota rejects negative/fractional at the boundary (T-01-12)"

key-files:
  created:
    - api/src/routes/varieties.ts
    - api/src/routes/rounds.ts
    - api/src/routes/prices.ts
    - api/tests/auth-boundary.test.ts
    - api/tests/prices-resolution.test.ts
    - api/tests/catalog-crud.test.ts
    - api/tests/staff-login.test.ts
  modified:
    - api/src/routes/auth.ts   # rewritten: real staff login (forgery path removed)
    - api/src/index.ts          # appended .use(varietiesRoutes).use(roundsRoutes).use(pricesRoutes)

key-decisions:
  - "make<Route>Routes(db) DI factory for all three new routers AND the rewritten auth route — the only way the real-PG tests (:55432) can inject the seeded pool while .env.test DATABASE_URL points at a dummy :5432. Faithful to the plan's dbPlugin intent and matches the 01-02 precedent; index.ts still composes the default instances."
  - "DELETE /varieties is a SOFT delete (active=false) — sale_units/round_stock/prices/order_lines carry FKs to the variety, so a hard delete would violate referential integrity."
  - "POST /rounds/:id/stock upserts round_stock (onConflictDoUpdate on the unique (round,variety) index) so re-setting a quota is idempotent."
  - "Real staff login returns an IDENTICAL 401 { error: invalid_credentials } for both unknown-email and wrong-password (T-01-23 no user-enumeration); role is ALWAYS taken from the users row, never from the request (T-01-22)."

patterns-established:
  - "Public-read / staff-write split within one router: GET handlers unguarded, mutating handlers carry requireRole('owner','admin') beforeHandle."
  - "Read-time derived pack price (deriveUnitPriceSatang) on /prices/resolve — the catalog contract 01-04 reuses."

requirements-completed: [PLAT-03, INV-01, INV-02, INV-03, INV-04, INV-05]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 01 Plan 03: Catalog + Rounds + Tiered Pricing + Real Staff Login Summary

**Staff-gated CRUD for varieties (with fixed-weight packs), selling rounds (with a per-variety sellable quota), and per-kg B2C/B2B pricing with a nullable daily override — the pack price auto-derives to whole baht and price history is retained — all behind the first real end-to-end RBAC boundary, whose staff login now verifies against the stored `users` hash so a client-supplied hash can no longer forge an admin token (PLAT-03 closed).**

## Performance

- **Duration:** ~8 min
- **Tasks:** 4 (all TDD)
- **Files created:** 7 · **Files modified:** 2
- **Tests added:** 22 (90 expect() calls), all green against real PostgreSQL 17

## Accomplishments

### Task 1 — Varieties + rounds staff CRUD + auth-boundary proof (`f8c2726` RED → `a3331fb` GREEN)
- `routes/varieties.ts` (`makeVarietiesRoutes(db)`): OPEN `GET /varieties` (list, each with its `sale_units`) and `GET /varieties/:id`; staff-gated `POST /varieties` (variety + a list of sale_units in one transaction, incl. a `pack` sale_unit at 250/500g — INV-03), `PUT /varieties/:id`, and `DELETE /varieties/:id` (soft-delete `active=false`).
- `routes/rounds.ts` (`makeRoundsRoutes(db)`): OPEN `GET /rounds` and `GET /rounds/:id` (with `round_stock`); staff-gated `POST /rounds`, `POST /rounds/:id/stock` (upsert per-variety `quota_plants` — INV-05), `PATCH /rounds/:id/status` (open↔closed — D-09).
- Appended `.use(varietiesRoutes).use(roundsRoutes)` to `index.ts` (append-only; frozen composition order untouched).
- `tests/auth-boundary.test.ts`: every write route → 401 (no token) / 403 (packer) / 2xx (admin); GET catalog reads succeed with NO token; regression — `POST /orders` still succeeds token-less (D-03).

### Task 2 — Prices CRUD + daily override + auto pack price + history (`77bfdbf` RED → `d618208` GREEN)
- `routes/prices.ts` (`makePricesRoutes(db)`): staff-gated `POST /prices` (effectiveDate omitted = NULL round default; a dated effectiveDate = the daily override — both persist ⇒ history) and `PUT /prices/:id`; OPEN `GET /prices` (filterable history) and `GET /prices/resolve` (OQ-2 resolution + per-sale_unit auto pack price via `deriveUnitPriceSatang`).
- Appended `.use(pricesRoutes)` to `index.ts`.
- `tests/prices-resolution.test.ts`: dated override wins its day, NULL default wins otherwise; derived pack price equals `deriveUnitPriceSatang(kg, grams)` and is a whole-baht multiple of 100; both rows persist (history); negative/fractional kg price → 422 (T-01-12); write gated (no token → 401).

### Task 3 — Catalog-CRUD round-trip integration (`ce95af0`)
- `tests/catalog-crud.test.ts`: full admin setup through the endpoints (create variety+250g pack → open round → set quota → set B2C+B2B prices) then reads it all back — pack/quota persist, both tiers exist, derived pack price is whole baht. Every write uses an admin Bearer and returns 2xx. This is Criterion 1 end-to-end.

### Task 4 — Real staff login closes the auth bypass (`939e33c` RED → `996ffe2` GREEN)
- Rewrote `POST /auth/staff` in `routes/auth.ts` (now `makeAuthRoutes(db)`): body is exactly `{ email, password }` — the Phase-0 `passwordHash` field is **removed**. The handler looks up the `users` row by email (parameterized), verifies the submitted password against the **STORED** `password_hash` via `auth.verifyPassword`, and issues `issueSession(row.id, row.role)`. Unknown-email and wrong-password return an identical `401 { error: "invalid_credentials" }`. `POST /auth/line` left unchanged. `index.ts` NOT edited (it already composes the default `authRoutes`).
- `tests/staff-login.test.ts`: correct login → 200, session role = the row's role, passes `requireRole("owner","admin")`; a request-supplied `role` is ignored (grower stays grower, denied the admin gate); wrong password → 401; unknown email → 401; **forgery regression** — a body carrying an attacker-chosen `passwordHash` for the wrong password still yields 401 (the supplied hash has no effect).

## API Contracts (for 01-04 catalog + Phase 2 LIFF)

**Catalog reads (OPEN, D-03):**
- `GET /varieties` → `[{ id, name, category, description, imageUrl, avgGramsPerPlant, active, createdAt, saleUnits: [{ id, kind, label, gramsPerUnit, plantsPerUnit, active }] }]`
- `GET /varieties/:id` → the same single object (`404 { error:"variety_not_found" }` if absent).
- `GET /rounds` → `[{ id, name, status, cutoffAt, harvestDate, deliveryDate }]`; `GET /rounds/:id` → `{ ...round, stock: [{ roundId, varietyId, quotaPlants, reservedPlants }] }`.

**Price resolution (OPEN — the seam 01-04 reuses):**
- `GET /prices/resolve?roundId&varietyId&tier&date?` → `{ roundId, varietyId, tier, date, pricePerKgSatang, effectiveDate, packs: [{ saleUnitId, kind, label, gramsPerUnit, unitPriceSatang }] }`. `date` defaults to today. Resolution: a row dated for `date` wins; else the `effective_date IS NULL` round default (`ORDER BY effective_date DESC NULLS LAST LIMIT 1`). Each pack `unitPriceSatang = deriveUnitPriceSatang(pricePerKgSatang, gramsPerUnit)` (ceil-to-whole-baht). `404 { error:"no_price" }` if neither exists.
- `GET /prices?roundId?&varietyId?&tier?` → full price history rows (retains default + all dated overrides).

**Staff writes (owner|admin Bearer required — 401 no/bad token, 403 wrong role):**
- `POST /varieties { name, category?, description?, imageUrl?, avgGramsPerPlant, saleUnits?: [{ kind, label, gramsPerUnit, plantsPerUnit }] }` → 201 variety+saleUnits.
- `PUT /varieties/:id { name?, category?, description?, imageUrl?, avgGramsPerPlant?, active? }` → 200; `DELETE /varieties/:id` → 200 `{ id, active:false }` (soft).
- `POST /rounds { name, cutoffAt?, harvestDate?, deliveryDate?, status? }` → 201; `POST /rounds/:id/stock { varietyId, quotaPlants }` → 200 (upsert); `PATCH /rounds/:id/status { status: open|closed }` → 200.
- `POST /prices { roundId, varietyId, tier, pricePerKgSatang, effectiveDate? }` → 201; `PUT /prices/:id { pricePerKgSatang }` → 200. `pricePerKgSatang` is `t.Integer({minimum:0})` (negative/fractional → 422).

**Real staff login (the PLAT-03 gate made real):**
- `POST /auth/staff { email, password }` → `200 { token }` (session role = the `users` row's role) · `401 { error:"invalid_credentials" }` for unknown-email OR wrong-password (identical — no enumeration). No `passwordHash` field is accepted.

## Decisions Made
- **DI factory for all four routers.** `.env.test` `DATABASE_URL` points at a dummy `:5432` while the real test container is `:55432`; the only robust way to run the endpoints against the seeded pool (as the whole phase's real-PG tests require) is the `make<Route>Routes(db)` factory established in 01-02. `index.ts` still composes the default instances. This is a faithful rendering of the plan's `dbPlugin` intent (same rationale 01-02 documented).
- **Soft-delete varieties** (`active=false`) rather than a hard `DELETE` — FKs from sale_units/round_stock/prices/order_lines would otherwise break.
- **Identical 401 for unknown-email and wrong-password** (T-01-23) and **role always from the row** (T-01-22) — the two anti-forgery / anti-enumeration invariants of the real login.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree had no installed node_modules**
- **Found during:** setup. The parallel worktree is a fresh Bun workspace; `tsc`/`biome`/drizzle binaries were absent.
- **Fix:** `bun install --frozen-lockfile` (installs only pinned Phase-0 deps — no new packages, T-01-SC accept). No lockfile change committed.

**2. [Rule 3 - Blocking] Route DB wiring via DI factory (all four routers)**
- **Found during:** Tasks 1, 2, 4 (writing the real-PG endpoint tests).
- **Issue:** The plan says to add `.use(dbPlugin)` to the routes, but `dbPlugin` decorates with the runtime `db` (reads `env.DATABASE_URL` → `.env.test` dummy `:5432`), not the `:55432` test container the tests seed. `app.handle` against the default routes would hit the wrong/unreachable DB.
- **Fix:** Exported `makeVarietiesRoutes(db)`, `makeRoundsRoutes(db)`, `makePricesRoutes(db)`, and `makeAuthRoutes(db)` factories (defaults bind the runtime db) — the same DI pattern `routes/orders.ts` (01-02) and `routes/health.ts` already use. `index.ts` composes the default instances.
- **Files:** the four route files + the four test files.
- **Verification:** all 22 target tests pass against real PG17; acceptance greps pass.
- **Committed in:** `a3331fb`, `d618208`, `996ffe2`.

**Total deviations:** 2 auto-fixed (both blocking wiring). No scope creep — the DI factory is a faithful, more-robust rendering of the plan's "endpoint tests against real PG" intent, and still satisfies `.use(...Routes)` in `index.ts`.

## Threat Model Coverage
- **T-01-11 (unauth/wrong-role catalog write)** — mitigated: `requireRole("owner","admin")` beforeHandle on every write route; auth-boundary test asserts 401/403/2xx; GET reads unguarded (D-03).
- **T-01-12 (negative/fractional price or quota)** — mitigated: `t.Integer({minimum:0})` on `pricePerKgSatang` and `quotaPlants`; negative/fractional → 422 (tested).
- **T-01-13 (SQL injection)** — mitigated: Drizzle parameterized queries only (`eq`, `and`, `.values`).
- **T-01-14 (PII via public reads)** — mitigated: catalog/round/price reads expose only catalog data — never customers/orders.
- **T-01-22 (broken access control — client-supplied hash forges admin)** — mitigated: `POST /auth/staff` looks up the row by email, verifies against the STORED hash, role from the row; `passwordHash` body field removed; forgery-regression test proves a supplied hash cannot mint a token.
- **T-01-23 (user-enumeration)** — mitigated: unknown-email and wrong-password return an identical `401 { error:"invalid_credentials" }` (tested).
- **T-01-SC (supply chain)** — accept: no new packages.

## Verification Evidence
- `docker compose -f api/tests/docker-compose.pg.yml up -d` (PG17 :55432, healthy).
- `bun test tests/auth-boundary.test.ts tests/staff-login.test.ts tests/prices-resolution.test.ts tests/catalog-crud.test.ts` → **22 pass / 0 fail** (90 expect() calls).
- Full suite `bun test` → **85 pass / 1 fail**; the single fail is the pre-existing `tests/storage.test.ts` MinIO/R2 hook timeout (introduced 00-03, requires object-storage connectivity not up here — unrelated to 01-03). Already logged in `deferred-items.md`.
- `bunx tsc --noEmit` → exit 0. `biome check` → clean on all five touched source files.
- Acceptance greps: `requireRole` in varieties.ts = 4, rounds.ts = 3; `varietiesRoutes|roundsRoutes` in index.ts = 4 (+`pricesRoutes` mounted); `passwordHash: t.String` in auth.ts = 0; `body.passwordHash` = 0; `users` in auth.ts = 5; `issueSession(row.id, row.role)` = 1.

## Known Stubs
None. Every delivered endpoint is wired to real DB state and proven by real-PG tests. (`POST /auth/line` retains its Phase-0 "packer" placeholder role — explicitly OUT OF SCOPE for this plan per the task action; the LINE-customer role model is a Phase-2 concern and was left unchanged.)

## Out-of-Scope / Deferred
- `tests/storage.test.ts` MinIO/R2 hook timeout — pre-existing, environmental. Already logged in `deferred-items.md`.
- `index.ts` CORS `methods` allowlist omits `PATCH` (used by `PATCH /rounds/:id/status`, staff-only). Same deferral 01-02 recorded for `PATCH /orders/:id/status`: staff endpoints have no browser frontend in Phase 1; `app.handle`/server-side callers are unaffected. Add `PATCH` to the browser preflight allowlist when the staff dashboard slice lands.

## TDD Gate Compliance
- Task 1: `test(...)` RED (`f8c2726`, module-not-found) → `feat(...)` GREEN (`a3331fb`). Compliant.
- Task 2: `test(...)` RED (`77bfdbf`, module-not-found) → `feat(...)` GREEN (`d618208`). Compliant.
- Task 3: test-only proof over the Task-1/2 endpoints (no new source behavior) → single `test(...)` commit (`ce95af0`). No RED/GREEN split needed.
- Task 4: `test(...)` RED (`939e33c`, named-export-not-found) → `feat(...)` GREEN (`996ffe2`). Compliant.
- No REFACTOR commits were needed. `c328fc5` is a biome formatting-only follow-up on the Task-2 test.

## Next Phase Readiness
- **01-04 (public catalog)** consumes `GET /varieties`, `GET /rounds`, and `GET /prices/resolve` (the whole-baht auto pack price is computed there) directly.
- **01-05 (mixed box)** reuses the staff-write pattern and the price-resolution rule.
- The PLAT-03 gate is now real end-to-end: `POST /auth/staff` → session with the stored role → `requireRole`-gated writes.

---
*Phase: 01-commerce-core*
*Completed: 2026-07-03*

## Self-Check: PASSED
All 9 created/modified files exist on disk; all 8 commits (`f8c2726`, `a3331fb`, `77bfdbf`, `d618208`, `ce95af0`, `939e33c`, `996ffe2`, `c328fc5`) are present in git history. Working tree clean.
