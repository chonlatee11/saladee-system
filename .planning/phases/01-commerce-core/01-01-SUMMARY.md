---
phase: 01-commerce-core
plan: "01"
subsystem: commerce-core
tags: [schema, migration, reservation, concurrency, pricing, order-status, postgres, drizzle]
dependency_graph:
  requires: []
  provides:
    - "services/reservation.ts: reserve() / release() (guaranteed-atomic stock decrement)"
    - "services/pricing.ts: deriveUnitPriceSatang() (ceil-to-baht, integer satang)"
    - "services/order-status.ts: OrderStatus, TRANSITIONS, canTransition()"
    - "db/schema.ts: 12 commerce tables + 5 pgEnums"
    - "drizzle/0001_commerce.{sql,down.sql}: reversible commerce migration"
    - "tests/seed.ts: variety/round/round_stock seed helpers"
  affects:
    - "01-02 (POST /orders) consumes reserve()/release(), pricing, order-status, schema"
    - "01-05 (mixed box) consumes reserve()/release() per-component in one transaction"
tech_stack:
  added: []  # no new packages — every dep pre-existing + pinned from Phase 0
  patterns:
    - "Guarded single-statement conditional UPDATE for oversell-safe reservation"
    - "Integer-satang money (no float/numeric); ceil-to-whole-baht derived prices"
    - "Explicit Record<Status, Status[]> transition table (no state-machine lib)"
    - "Generated up SQL + hand-written idempotent down SQL (IF EXISTS, reverse order)"
    - "Real-PG17 concurrency proof via Promise.allSettled with pool max >= N"
key_files:
  created:
    - api/src/services/reservation.ts
    - api/src/services/pricing.ts
    - api/src/services/order-status.ts
    - api/drizzle/0001_commerce.sql
    - api/drizzle/0001_commerce.down.sql
    - api/drizzle/meta/0001_snapshot.json
    - api/tests/seed.ts
    - api/tests/reservation.test.ts
    - api/tests/pricing.test.ts
    - api/tests/order-status.test.ts
  modified:
    - api/src/db/schema.ts
    - api/tests/migrate.test.ts
    - api/drizzle/meta/_journal.json
decisions:
  - "OQ-1 LOCKED: shipping → cancelled FORBIDDEN; TRANSITIONS.shipping = ['done']"
  - "OQ-2 LOCKED: nullable effective_date on prices + UNIQUE(round,variety,tier,effective_date)"
  - "OQ-3 LOCKED: no products table — sellable surface = varieties (+ sale_units) and boxes"
  - "Money stored as integer satang everywhere (A1); derived unit prices are whole baht"
metrics:
  tasks_completed: 3
  files_created: 10
  files_modified: 3
  commits: 5
  duration_min: 55
  completed_date: 2026-07-02
---

# Phase 1 Plan 01: Commerce Schema + Oversell-Safe Reservation Core Summary

Guaranteed-atomic `reserve()`/`release()` primitive proven with a real N=8 PostgreSQL 17 race (exactly one winner on the last pack, `reserved_plants` never exceeds `quota_plants`), plus the full 12-table commerce schema, a reversible `0001_commerce` migration, and the pure ceil-to-baht pricing and order-status transition services that 01-02 and 01-05 consume unchanged.

## What Was Built

### Task 1 — Commerce schema + reversible 0001 migration (commit `e4b60ef`)
- Extended `api/src/db/schema.ts` with **5 pgEnums** (`tier`, `order_status`, `substitution_policy`, `unit_kind`, `round_status`) and **12 commerce tables**: `varieties`, `sale_units`, `rounds`, `round_stock`, `prices`, `customers`, `customer_addresses`, `boxes`, `box_components`, `orders`, `order_lines`, `back_in_stock_requests`. (Total `pgTable(` count in the file is 13 including the pre-existing `users`.)
- Generated `drizzle/0001_commerce.sql` via `drizzle-kit generate --name commerce`, then **hand-added** the oversell-integrity CHECK constraints drizzle-kit does not emit: on `round_stock` — `reserved_plants >= 0`, `reserved_plants <= quota_plants`, `quota_plants >= 0`; on `order_lines` — `qty > 0`.
- Hand-wrote `drizzle/0001_commerce.down.sql` mirroring `0000_init.down.sql`: 12 `DROP TABLE IF EXISTS` (children → parents) then 5 `DROP TYPE IF EXISTS`, all `--> statement-breakpoint` separated.
- Applied to the test PG17 (`docker compose -f tests/docker-compose.pg.yml`) via `db:migrate`; all 13 tables + 3 round_stock CHECK constraints verified present.

### Task 2 — Guarded reservation service + real-PG concurrency proof (commits `505ea37` RED, `1398bf3` GREEN)
- `api/src/services/reservation.ts`: `reserve()` is a single guarded conditional `UPDATE round_stock SET reserved_plants = reserved_plants + n WHERE ... AND quota_plants - reserved_plants >= n RETURNING id` (parameterized `sql` template only, zero `sql.raw`). `release()` guards `WHERE reserved_plants >= n` for idempotency.
- `api/tests/reservation.test.ts`: N=8 parallel `reserve()` via `Promise.allSettled` against real PG17 with pool `max = N+2` → exactly 1 `true`, 7 `false`, `reserved_plants === 1`. Plus release idempotency (double-release is a no-op) and over-request rejection.
- `api/tests/seed.ts`: `seedVariety`/`seedRound`/`seedRoundStock`/`seedStockRow` helpers.
- Extended `api/tests/migrate.test.ts` to cover `0001_commerce` up→down→up (round_stock/orders/varieties/order_lines/back_in_stock_requests + `order_status`/`tier` enums appear, disappear, reappear).

### Task 3 — Pricing + order-status services (commits `8587bbd` RED, `4a25d13` GREEN)
- `api/src/services/pricing.ts`: `deriveUnitPriceSatang(pricePerKgSatang, gramsPerUnit) = Math.ceil((kg*g/1000)/100)*100` — integer satang in, whole-baht satang out.
- `api/src/services/order-status.ts`: `OrderStatus` union, `TRANSITIONS` record, `canTransition()`. **OQ-1 locked**: `shipping: ["done"]` (no `cancelled`); `done`/`cancelled` terminal.

## Interface Contracts (for 01-02 and 01-05)

```ts
// api/src/services/reservation.ts
export type DbOrTx = Pick<PostgresJsDatabase, "execute">;
export function reserve(tx: DbOrTx, roundId: string, varietyId: string, plants: number): Promise<boolean>;
export function release(tx: DbOrTx, roundId: string, varietyId: string, plants: number): Promise<boolean>;

// api/src/services/pricing.ts
export function deriveUnitPriceSatang(pricePerKgSatang: number, gramsPerUnit: number): number;

// api/src/services/order-status.ts
export type OrderStatus = "created"|"awaiting_payment"|"paid"|"packing"|"shipping"|"done"|"cancelled";
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]>;
export function canTransition(from: OrderStatus, to: OrderStatus): boolean;
```

Final table/column names match `schema.ts` exactly (snake_case in DB; the oversell counter is `round_stock(quota_plants, reserved_plants)`).

## Locked Decisions
- **OQ-1**: `shipping → cancelled` FORBIDDEN — plants have left the farm, not resellable in-round; removes the release-ambiguity branch.
- **OQ-2**: daily price override = nullable `effective_date` column on `prices` + `UNIQUE(round_id, variety_id, tier, effective_date)` (dated row wins; NULL = round default). Implemented as `prices_round_variety_tier_date_idx`.
- **OQ-3**: no `products` table — sellable surface is `varieties` (+ `sale_units`) and `boxes`; sale mode derived from round timing.

## Deviations from Plan

### Reconciliation (not a code change)
- The plan's acceptance heuristic `grep -c "pgTable(" schema.ts` says "returns 12"; the actual value is **13** because the check forgot to count the pre-existing `users` table (12 named commerce tables + `users`). All 12 explicitly-named commerce tables from the plan's `must_haves` are present, so the substantive requirement is fully met. No tables were dropped to satisfy an off-by-one grep.

### Auto-fixed issues
- **[Rule 3 - Blocking] Worktree had no installed node_modules.** The parallel worktree is a fresh bun workspace; `drizzle-kit`/`tsc`/`biome` binaries were absent. Ran `bun install --frozen-lockfile` (installs only the pinned Phase-0 deps — no new packages, consistent with threat register T-01-SC). No lockfile changes committed.
- **[Rule 1 - Bug] Strict-null tsc errors in `tests/seed.ts`.** `const [row] = await ...returning()` is `T | undefined` under `noUncheckedIndexedAccess`; added `if (!row) throw` guards. Folded into the Task-2 GREEN commit.
- **[Rule 1 - Bug] Security grep false-positive.** The word `sql.raw` appeared in a reservation.ts comment, which would trip the plan's `grep -c "sql.raw"` acceptance (regex `.` matches any char). Reworded the comment; the file uses only the parameterized `sql` template. `grep -c "sql.raw"` now returns 0.

## Threat Model Coverage
- **T-01-01 (oversell/tampering)** — mitigated by the guarded single-statement UPDATE; proven by the real-PG N=8 race.
- **T-01-02 (negative/over reserve)** — DB CHECKs `reserved_plants >= 0`, `reserved_plants <= quota_plants`, `quota_plants >= 0`.
- **T-01-03 (SQL injection)** — parameterized `sql` template only; `grep -c "sql.raw"` = 0.
- **T-01-04 (double-release)** — `release()` guarded `WHERE reserved_plants >= n`; idempotency asserted.
- **T-01-SC (supply chain)** — accept: no new packages installed.

## Verification Evidence
- `bun test tests/reservation.test.ts tests/migrate.test.ts tests/pricing.test.ts tests/order-status.test.ts` → **30 pass / 0 fail**.
- Migration reversibility: `db:migrate` then `db:down drizzle/0001_commerce.down.sql` leaves **zero** commerce tables and **zero** commerce enums; re-apply clean.
- `bunx tsc --noEmit` → exit 0. `biome check` → clean on all touched files.
- Acceptance greps: `reserved_plants` (non-comment) in up SQL = 3; `DROP TABLE IF EXISTS` in down = 12; `DROP TYPE IF EXISTS` = 5; `shipping: ["done"]`.

## Known Stubs
None. All delivered services are fully wired and tested; no placeholder/empty-return data paths.

## Out-of-Scope / Deferred
- `api/tests/storage.test.ts` fails (beforeEach/afterEach hook times out at 5s) in the execution sandbox — a **pre-existing** R2/network test requiring Cloudflare R2 connectivity not available here. Untouched by 01-01 (no storage code changed). Logged in `deferred-items.md`. The four 01-01 target test files and all other unit tests pass (50 pass / 1 fail overall, the single fail being this environmental storage test).

## Commits
- `e4b60ef` feat(01-01): commerce schema + reversible 0001 migration
- `505ea37` test(01-01): failing real-PG reservation race + migrate reversibility (RED)
- `1398bf3` feat(01-01): guarded reserve()/release() — real-PG race proves no oversell (GREEN)
- `8587bbd` test(01-01): failing pricing ceil-to-baht + order-status transition tests (RED)
- `4a25d13` feat(01-01): pricing ceil-to-baht + order-status transition services (GREEN)

## TDD Gate Compliance
Both TDD tasks (2 and 3) followed RED → GREEN: a `test(...)` commit with failing tests (module-not-found) precedes each `feat(...)` implementation commit. No REFACTOR commits were needed (implementations were minimal and clean).

## Self-Check: PASSED
All 10 created files exist on disk; all 6 commits (`e4b60ef`, `505ea37`, `1398bf3`, `8587bbd`, `4a25d13`, `38d4b68`) are present in git history. Working tree clean.
