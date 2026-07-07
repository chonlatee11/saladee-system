---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 01
subsystem: database
tags: [drizzle, postgres, migration, schema, elysia, crop-planning, subscription, b2b]

# Dependency graph
requires:
  - phase: 01-commerce-core
    provides: varieties/round_stock/orders/customers tables + reserve() guard
  - phase: 02-payments-delivery-consent
    provides: 0003 migration + reversible down idiom + payments/delivery/consent schema
provides:
  - Phase-3 schema backbone (11 new tables + additive columns on varieties/round_stock/orders/customers)
  - subscription_status + b2b_status pgEnums
  - 0004_phase3 migration (up) + hand-written reversible down, proven up→down→up
  - HAIRCUT_DEFAULT_PCT + B2B_QUOTA_CEILING_PCT env keys; web-admin CORS origins
  - 8 empty stub routers (crop/harvest/subscriptions/b2b/packing/reports/dashboard/settings) composed at END of index.ts
  - migration reversibility registered in migrate.test.ts + all 26 self-resetting test files
affects: [crop, harvest, subscriptions, b2b, packing, reports, dashboard, settings, forecast, web-admin]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive notNull columns carry DB defaults (deliveryClass idiom) so ADD COLUMN is prod-safe on populated tables"
    - "New migration MUST be registered in every self-resetting test's down/up sequence (down first, up last)"
    - "Stub routers use makeXRoutes(_database = defaultDb) + default instance, composed append-only (fixed-order invariant)"

key-files:
  created:
    - api/drizzle/0004_phase3.sql
    - api/drizzle/0004_phase3.down.sql
    - api/src/routes/crop.ts
    - api/src/routes/harvest.ts
    - api/src/routes/subscriptions.ts
    - api/src/routes/b2b.ts
    - api/src/routes/packing.ts
    - api/src/routes/reports.ts
    - api/src/routes/dashboard.ts
    - api/src/routes/settings.ts
  modified:
    - api/src/db/schema.ts
    - api/src/env.ts
    - api/src/index.ts
    - api/tests/migrate.test.ts
    - "api/tests/*.test.ts (26 self-resetting files register 0004)"

key-decisions:
  - "varieties yield columns notNull WITH DB defaults (30/90/7) — mirrors deliveryClass additive idiom; prod-safe migration + slice enforces real values later"
  - "0004 registered in migrate.test.ts + 26 self-resetting test files (down first, up last) — 0004 children FK into 0001 parents"
  - "db:down verify uses the real down-SQL path (drizzle/0004_phase3.down.sql), and reversibility asserted via postgres.js (psql unavailable)"

patterns-established:
  - "Additive-column defaults: notNull columns added to populated tables carry a DB default (never notNull-no-default)"
  - "Migration test registration: a new NNNN migration is added to applyAllUp (last) and applyAllDown (first) plus every inline test reset"

requirements-completed: []  # backbone only — see Decisions/Next Phase Readiness

# Coverage metadata
coverage:
  - id: D1
    description: "0004_phase3 migration is reversible (up→down→up clean, no orphan tables/enums/columns) on DATABASE_URL_DIRECT"
    verification:
      - kind: integration
        ref: "tests/migrate.test.ts#migration up→down→up (Criterion 2)"
        status: pass
      - kind: other
        ref: "postgres.js to_regclass up→down→clear-journal→up exercise (CLI)"
        status: pass
    human_judgment: false
  - id: D2
    description: "11 new tables + additive columns + 2 enums exist in schema and apply cleanly"
    requirement: "CROP-02"
    verification:
      - kind: integration
        ref: "tests/migrate.test.ts#up: identity + all commerce tables and enums exist"
        status: pass
    human_judgment: false
  - id: D3
    description: "Schema/migration is additive — reserve/oversell guard untouched; full suite green"
    requirement: "INV-10"
    verification:
      - kind: integration
        ref: "bun test (full suite) — 204 pass / 0 fail incl. reservation/oversell/hold-expiry"
        status: pass
    human_judgment: false
  - id: D4
    description: "8 stub routers composed at END of index.ts; App type still exports (Eden)"
    verification:
      - kind: unit
        ref: "bunx tsc --noEmit — exit 0 (App type + composition typecheck)"
        status: pass
    human_judgment: false
  - id: D5
    description: "env keys HAIRCUT_DEFAULT_PCT / B2B_QUOTA_CEILING_PCT + web-admin CORS boot-validate"
    verification:
      - kind: integration
        ref: "bun test app-importing suites boot env.ts (loadEnv) — pass"
        status: pass
    human_judgment: false

# Metrics
duration: 45 min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 01: Back-office Schema + Migration + Route-stub Backbone Summary

**Additive Drizzle 0004 migration (11 crop/subscription/B2B tables + columns on varieties/round_stock/orders/customers) with a hand-written reversible down proven up→down→up, plus 8 append-only Elysia stub routers — the reserve() oversell guard untouched and the 204-test suite green.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-07T22:00+07:00 (approx — includes test-infra bring-up)
- **Completed:** 2026-07-07T22:31:38+07:00
- **Tasks:** 3
- **Files modified/created:** 42

## Accomplishments
- Extended `schema.ts` with 2 enums, 11 tables, and additive columns — all additive, reserve/release/guard logic never touched.
- Generated `0004_phase3.sql` and hand-wrote `0004_phase3.down.sql` (children→parent, columns, pgEnum types LAST, `IF EXISTS`); proven reversible up→down→up on `DATABASE_URL_DIRECT`, including the known db:down journal-bug clear step.
- Added `HAIRCUT_DEFAULT_PCT` (90) and `B2B_QUOTA_CEILING_PCT` (100) env keys and web-admin origins to the CORS default.
- Created 8 empty DI-factory stub routers and composed them append-only at the END of `index.ts` (fixed-order invariant); `App` type still exports.
- Registered 0004 in `migrate.test.ts` and all 26 self-resetting test files so the full suite stays green (204 pass / 0 fail).

## Task Commits

1. **Task 1: extend schema.ts** — `5309cce` (feat)
2. **Task 2: 0004 migration (up+down) + env + stub routers + index compose** — `ea01d1c` (feat)
3. **Task 3: register 0004 in migration reset paths (regression gate)** — `ac5bff5` (test)

## Files Created/Modified
- `api/src/db/schema.ts` — 2 enums, 11 tables, additive columns (varieties yield params, round_stock override, orders packed_at, customers B2B).
- `api/drizzle/0004_phase3.sql` — drizzle-kit up migration.
- `api/drizzle/0004_phase3.down.sql` — hand-written reversible down.
- `api/src/env.ts` — HAIRCUT_DEFAULT_PCT, B2B_QUOTA_CEILING_PCT, web-admin CORS origins.
- `api/src/index.ts` — 8 stub routers appended to the compose chain.
- `api/src/routes/{crop,harvest,subscriptions,b2b,packing,reports,dashboard,settings}.ts` — empty DI stub routers.
- `api/tests/migrate.test.ts` + 26 `*.test.ts` — 0004 registered in reset sequences.

## Decisions Made
- **varieties yield columns notNull WITH DB defaults (30/90/7)** rather than notNull-no-default (see Deviation 1).
- **0004 registered in every self-resetting test** (down first, up last) because 0004 child tables FK into 0001 parents (see Deviation 2).
- **Reversibility asserted via postgres.js** (`to_regclass`) because `psql` is unavailable in this environment; `db:down` invoked with the real down-SQL path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Bug/Blocking] varieties yield columns given DB defaults**
- **Found during:** Task 1 (schema typecheck)
- **Issue:** Plan specified `daysToHarvest/survivalPct/shelfLifeDays` as `notNull` with no default. That breaks the existing `varieties` insert sites (`varieties.ts` POST, `tests/seed.ts`) at the type level, and an `ALTER TABLE varieties ADD COLUMN ... NOT NULL` with no default fails on any populated table (prod has variety rows) — directly contradicting the plan's own must_haves (clean migration + green tests).
- **Fix:** Added DB defaults (`30`/`90`/`7`; `harvestWindowDays` keeps default `1`), the same additive idiom the codebase already uses for `deliveryClass` (0003). Defaults are a floor; the CROP-01 slice enforces real per-variety values at the route layer.
- **Files modified:** `api/src/db/schema.ts`, `api/drizzle/0004_phase3.sql`
- **Verification:** `bunx tsc --noEmit` exit 0; migration applies on populated `varieties`.
- **Committed in:** `5309cce`, `ea01d1c`

**2. [Rule 3 - Blocking] Registered 0004 in migrate.test.ts + 26 self-resetting test files**
- **Found during:** Task 3 (regression gate)
- **Issue:** ~half the suite (and `migrate.test.ts`) self-resets the DB via inline down→up migration-file sequences that only knew 0000–0003. After they ran, the shared DB was left at 0003-shape without the new columns, and the teardown itself failed because 0004 child tables (planting_batches→varieties, subscriptions→customers, …) block dropping the 0001 parents. Result: 82 failures.
- **Fix:** Prepended `0004_phase3.down.sql` before the 0003 down (children first) and appended `0004_phase3.sql` after the 0003 up in `migrate.test.ts` (with new assertions) and in all 26 self-resetting `*.test.ts` files (scripted, byte-identical anchors, order-correct for both the 0002 and non-0002 variants).
- **Files modified:** `api/tests/migrate.test.ts` + 26 `api/tests/*.test.ts`
- **Verification:** `bun test` → 204 pass / 0 fail; `migrate.test.ts` now proves 0004 up→down→up in-suite.
- **Committed in:** `ac5bff5`

**3. [Rule 3 - Blocking] db:down verify uses real down-SQL path; reversibility asserted via postgres.js**
- **Found during:** Task 2 (migration verify)
- **Issue:** `psql` is not installed in this environment, and `src/lib/migrate-down.ts` expects a down-SQL file PATH (`drizzle/0004_phase3.down.sql`), not the `0004_phase3` argument the plan's verify command passed.
- **Fix:** Ran `bun run db:down drizzle/0004_phase3.down.sql` and asserted `to_regclass` presence/absence via a small `postgres.js` script (postgres.js is already a project dependency); cleared the latest `drizzle.__drizzle_migrations` row (known journal bug) and re-migrated.
- **Files modified:** none (verification tooling only, in scratchpad)
- **Verification:** planting_batches EXISTS after up → MISSING after down (no "cannot drop type") → EXISTS after re-migrate; enums/columns follow.
- **Committed in:** n/a (verification method)

---

**Total deviations:** 3 auto-fixed (1 bug/blocking, 2 blocking).
**Impact on plan:** All three were necessary to satisfy the plan's own must_haves (prod-safe reversible migration, green regression suite). No scope creep — no slice logic was implemented; stub bodies remain empty.

## Issues Encountered
- The shared test DB (ephemeral PG on :55432) and MinIO (:9000) were not running at start; brought both up via `tests/docker-compose.{pg,minio}.yml` to establish the 204-test green baseline before making changes. Left running (dev test infra).

## Requirements
Backbone plan — no requirement is fully delivered here. This plan lays the schema/migration/env/stub seam that the Wave-2/3 slices fill; those slices (which share `[ADM-02, ADM-03, CROP-01, CROP-02, CROP-05, CROP-06, CUST-02, CUST-05, SALE-03, INV-10]`) complete the behaviors. Left `requirements-completed: []` to avoid false "complete" traceability signals.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Schema + migration 0004 + env keys + 8 composed stub routers are ready for Wave-2/3 slices to fill disjoint files without touching `schema.ts` or `index.ts` again.
- Reservation guard untouched; every reservation still flows the existing `reserve()`/`reserveBox()` path (no second counter, no quota pre-check).
- New env keys (`HAIRCUT_DEFAULT_PCT`, `B2B_QUOTA_CEILING_PCT`) default safely; prod override optional.

## Self-Check: PASSED

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
