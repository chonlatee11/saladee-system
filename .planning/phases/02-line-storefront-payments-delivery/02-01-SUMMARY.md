---
phase: 02-line-storefront-payments-delivery
plan: 01
subsystem: database
tags: [drizzle, postgres, migration, pg-boss, elysia, typebox, order-transition]

# Dependency graph
requires:
  - phase: 01-commerce-core
    provides: guarded SELECT-FOR-UPDATE order status transition + reservation release() + orders/varieties/customers schema
provides:
  - "Migration 0003 (applied + reversible): payments, consent_logs tables; delivery_class enum; varieties care columns; orders hold/qr/delivery snapshot columns"
  - "Shared applyTransition(tx, orderId, next, opts) — single guarded transition path with onlyIfHold gate + onCommit notify seam"
  - "pg-boss singleton + startJobs()/stopJobs() booting the hold-expiry queue under import.meta.main"
  - "Phase-2 env keys (SLIP_VERIFY_PROVIDER, SLIPOK_BRANCH_ID, SLIPOK_API_KEY, PROMPTPAY_PAYEE_ID, HOLD_WINDOW_SECONDS)"
  - "10 Wave-0 test scaffolds seeding the phase's validation architecture"
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, 02-08, 02-09]

# Tech tracking
tech-stack:
  added: [pg-boss@12.23.0]
  patterns:
    - "Single guarded transition service reused by staff PATCH, slip-verify (02-06), and hold-expiry (02-07)"
    - "pg-boss on DATABASE_URL_DIRECT (unpooled), worker started only under import.meta.main so bun test never spins a worker"
    - "Partial UNIQUE index on payments.trans_ref for system-wide slip dedup (multiple NULL rows coexist)"

key-files:
  created:
    - api/src/services/order-transition.ts
    - api/src/jobs/boss.ts
    - api/drizzle/0003_payments_delivery_consent.sql
    - api/drizzle/0003_payments_delivery_consent.down.sql
  modified:
    - api/src/db/schema.ts
    - api/src/env.ts
    - api/src/routes/orders.ts
    - api/src/index.ts
    - api/drizzle/meta/_journal.json

key-decisions:
  - "applyTransition() is the sole implementation of the guarded transition; orders.ts PATCH delegates to it so three future callers cannot each re-break the Phase-1 concurrent-cancel oversell fix"
  - "pg-boss v12 named export { PgBoss } (RESEARCH referenced v10 default export); pinned 12.23.0, no postinstall scripts"
  - "Test scaffolds placed under api/tests/ (the real 24-file convention) not api/test/ as the plan text wrote"

patterns-established:
  - "Guarded transition extraction: row-lock + re-read + canTransition + on-cancel release lifted verbatim, onlyIfHold gate refuses cancel unless locked status in {created, awaiting_payment}"
  - "Migration reversibility proven in-suite: up→down→up wired into beforeAll of integration files + migrate.test.ts"

requirements-completed: [PAY-03]

coverage:
  - id: D1
    description: "Migration 0003 applies, rolls back, and re-applies cleanly (reversible), creating payments (UNIQUE trans_ref), consent_logs, delivery_class enum, and orders/varieties columns"
    requirement: "PAY-03"
    verification:
      - kind: integration
        ref: "api/tests/migrate.test.ts (up/down/up) + operator-run: bun run db:migrate && bun run db:down && bun run db:migrate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared guarded applyTransition() extracted; orders.ts PATCH delegates; Phase-1 concurrent-cancel oversell fix preserved; onlyIfHold refuses non-hold states"
    requirement: "PAY-03"
    verification:
      - kind: integration
        ref: "api/tests/cancel-release.test.ts, api/tests/order-endpoint-race.test.ts, api/tests/reservation.test.ts, api/tests/order-transition.test.ts (bun test = 125 pass / 0 fail)"
        status: pass
    human_judgment: false
  - id: D3
    description: "pg-boss boots the hold-expiry queue on DATABASE_URL_DIRECT under import.meta.main; bun test imports app without spinning a worker"
    requirement: "PAY-03"
    verification:
      - kind: unit
        ref: "api/tests/env.test.ts + bun test suite green (no worker started during tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "10 Wave-0 test scaffolds registered (promptpay CRC, slip-verify, slip-dedup, hold-expiry, hold-idempotent, delivery, notify, auth-line, reorder, consent) — failing/todo, made green by later plans"
    verification:
      - kind: other
        ref: "api/tests/{promptpay,slip-verify,slip-dedup,hold-expiry,hold-idempotent,delivery,notify,auth-line,reorder,consent}.test.ts collected by runner (20 todo)"
        status: unknown
    human_judgment: true
    rationale: "Scaffolds are intentionally incomplete Wave-0 gaps; correctness is verified when plans 02-03..02-09 make them green, not in this plan"

# Metrics
duration: 15min
completed: 2026-07-04
status: complete
---

# Phase 2 Plan 01: Payments/Delivery/Consent Backbone Summary

**Migration 0003 (payments, consent_logs, delivery_class enum, orders hold/qr/delivery columns), a single shared guarded applyTransition() with an onlyIfHold gate, a booted pg-boss hold-expiry queue, and 10 Wave-0 test scaffolds — the cross-cutting foundation every Phase-2 vertical slice builds on.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-04T17:05:57+07:00
- **Completed:** 2026-07-04T17:20:45+07:00
- **Tasks:** 3
- **Files modified:** 41

## Accomplishments
- Schema 0003 applied to the live DB and proven reversible (down→up), adding the `payments` table (partial-UNIQUE `payments_trans_ref_idx` for system-wide slip dedup — D-06), `consent_logs` (D-25/26), the `delivery_class` enum + varieties care columns (D-13/24), and the orders hold/qr/delivery snapshot columns (D-10..15).
- Extracted `applyTransition(tx, orderId, next, opts)` + `OrderError` into `api/src/services/order-transition.ts` — the Phase-1 row-lock + re-read + on-cancel `release()` block lifted verbatim so the concurrent-cancel oversell fix is preserved exactly; added the `onlyIfHold` gate (RESEARCH Pitfall 1 / D-09) and an optional post-commit `onCommit` notify seam. `orders.ts` PATCH now delegates to it.
- Booted pg-boss (`boss`, `startJobs()`, `stopJobs()`) on `DATABASE_URL_DIRECT` (unpooled — Pitfall 6), creating the `hold-expiry` queue only under `import.meta.main` so `bun test` never spins a worker.
- Added the five Phase-2 env keys to `EnvSchema` + `.env.example`, and scaffolded 10 Wave-0 test files that later plans make green.
- Final suite green: `bunx tsc --noEmit` clean, `bun test` = 125 pass / 20 todo / 0 fail.

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema, migration 0003, and env keys** - `5a62b5d` (feat)
2. **Task 2: Extract shared guarded applyTransition() + refactor PATCH** - `ecb5d52` (refactor)
3. **Task 3: [BLOCKING] Apply migration 0003 + boot pg-boss + scaffold Wave-0 tests** - `af34c35` (feat)

_Migration apply (live DB), down→up reversibility, and the final green check were completed by the operator at the human-action gate before finalization._

## Files Created/Modified
- `api/src/services/order-transition.ts` - Shared guarded applyTransition() + OrderError, onlyIfHold gate, onCommit seam
- `api/src/jobs/boss.ts` - pg-boss singleton + startJobs()/stopJobs(), hold-expiry queue
- `api/drizzle/0003_payments_delivery_consent.sql` / `.down.sql` - up + hand-written reversible down (journal-registered)
- `api/src/db/schema.ts` - payments, consent_logs, delivery_class enum, varieties care + orders hold/qr/delivery columns
- `api/src/env.ts` - SLIP_VERIFY_PROVIDER, SLIPOK_BRANCH_ID, SLIPOK_API_KEY, PROMPTPAY_PAYEE_ID, HOLD_WINDOW_SECONDS
- `api/src/routes/orders.ts` - PATCH delegates to applyTransition() (inlined block removed)
- `api/src/index.ts` - startJobs()/stopJobs() wired inside the import.meta.main block
- `api/tests/*.test.ts` - 10 new Wave-0 scaffolds + 15 integration files extended with 0003 up/down bootstraps + migrate.test.ts

## Decisions Made
- `applyTransition()` is the single source of truth for the guarded transition — slip-verify (02-06) and hold-expiry (02-07) will reuse the exact same path, preventing three callers from independently re-breaking the oversell fix.
- Payments `trans_ref` uses a partial UNIQUE index (WHERE trans_ref IS NOT NULL) so many awaiting-review rows with NULL trans_ref coexist while a duplicate slip trans_ref is a unique violation (the dedup itself).
- pg-boss pinned to 12.23.0 with the v12 named export `{ PgBoss }`; no postinstall scripts (Package Legitimacy Audit clean).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed duplicate `prices_default_uniq` from generated migration**
- **Found during:** Task 1 (schema/migration generation)
- **Issue:** `bun run db:generate` re-emitted `CREATE UNIQUE INDEX prices_default_uniq` even though it already exists from migration 0002 — the 0002 snapshot never recorded it, so drizzle-kit thought it was new. Applying 0003 as-emitted would fail with a duplicate-index error.
- **Fix:** Removed that line from `0003_payments_delivery_consent.sql` before the apply gate.
- **Files modified:** api/drizzle/0003_payments_delivery_consent.sql
- **Verification:** `bun run db:migrate && bun run db:down && bun run db:migrate` all exit 0.
- **Committed in:** 5a62b5d (Task 1 commit)

**2. [Rule 3 - Blocking] Wired 0003 up/down into existing per-file test bootstraps**
- **Found during:** Task 2 (extraction) and Task 3 (apply)
- **Issue:** Schema 0003 broke the existing per-file test bootstraps — 15 integration test files build their schema in `beforeAll` and did not know about the new tables/columns, so they failed to boot against the migrated shape.
- **Fix:** Added the 0003 up/down migration to the `beforeAll` of the 15 affected integration files and extended `migrate.test.ts` to assert up→down→up reversibility.
- **Files modified:** api/tests/{auth-boundary,box-order,box-reservation,boxes-crud,cancel-release,catalog-crud,catalog,multi-round-order,order-endpoint-race,order-snapshot,prices-resolution,reservation,round-cutoff,soldout-notify,staff-login}.test.ts, api/tests/migrate.test.ts
- **Verification:** Full suite green (125 pass / 0 fail).
- **Committed in:** ecb5d52 (Task 2 commit)

**3. [Rule 3 - Path correction] Scaffolds placed under api/tests/ not api/test/**
- **Found during:** Task 3 (scaffolding)
- **Issue:** The plan text wrote `api/test/` but the real repo convention is `api/tests/` (24 existing files).
- **Fix:** Placed all 10 scaffolds + env.test.ts under `api/tests/`.
- **Files modified:** api/tests/*.test.ts
- **Committed in:** af34c35 (Task 3 commit)

**4. [Rule 3 - Blocking] pg-boss v12 named export**
- **Found during:** Task 3 (boss.ts)
- **Issue:** Plan/RESEARCH referenced pg-boss v10's default export; v12 uses the named export `{ PgBoss }`.
- **Fix:** Used `import { PgBoss } from "pg-boss"`; pinned 12.23.0.
- **Files modified:** api/src/jobs/boss.ts, api/package.json, bun.lock
- **Committed in:** af34c35 (Task 3 commit)

---

**Total deviations:** 4 (1 bug, 3 blocking/path). All necessary for a correct, applied, reversible migration and a green suite. No scope creep.

## Issues Encountered
- **Permission gate on `.env*` files:** the executor could not write the existing `.env.test` files. The operator added `PROMPTPAY_PAYEE_ID=0000000000` (dummy) to `api/.env.test` and root `.env.test` by hand. This was the plan's autonomous:false human-action gate.
- **Live-migration operator gate:** because `db:migrate` targets the live `DATABASE_URL_DIRECT`, the plan paused for the operator to confirm the DB target. The operator confirmed "done": migration 0003 applied, proven reversible (down→up), working tree clean, final check green (`bunx tsc --noEmit` clean, `bun test` 125 pass / 20 todo / 0 fail).

## User Setup Required
None new beyond the operator-completed gate above. Real `SLIPOK_*` / `PROMPTPAY_PAYEE_ID` production values are supplied later (02-06 slip-verify slice); `.env.test` uses a dummy payee id.

## Next Phase Readiness
- Wave 2 (02-02 LINE Login/LIFF shell, 02-03 delivery engine) is unblocked: the schema, env, guarded transition, and pg-boss queue backbone are in place.
- No later plan re-edits `schema.ts` or `env.ts` — this was the single cross-cutting foundation plan.
- 10 Wave-0 scaffolds are the failing/todo gaps the vertical slices make green.

## Self-Check: PASSED
- FOUND: api/src/services/order-transition.ts
- FOUND: api/src/jobs/boss.ts
- FOUND: api/drizzle/0003_payments_delivery_consent.sql
- FOUND commit 5a62b5d, ecb5d52, af34c35

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
