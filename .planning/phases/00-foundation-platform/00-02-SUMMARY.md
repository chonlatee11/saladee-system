---
phase: 00-foundation-platform
plan: 02
subsystem: database
tags: [drizzle, postgres-js, postgresql-17, migrations, rbac, health-readiness, neon-pooling, docker-compose]

# Dependency graph
requires:
  - 00-01 monorepo skeleton (env.ts DATABASE_URL/DATABASE_URL_DIRECT, db.plugin stub, healthRoutes /health, fixed index.ts)
provides:
  - RBAC-ready schema (users table + role pgEnum owner/admin/grower/packer, unique email index)
  - Dual-connection contract (runtime pooled + postgres.js prepare:false; migrations on DIRECT/unpooled url)
  - Reversible migration convention (generated up SQL + hand-written down SQL + tiny down-runner) — Criterion 2
  - db plugin decorating Elysia context with the drizzle `db` instance
  - DB-backed readiness probe GET /health/ready (200 ready / 503 unavailable)
  - Ephemeral PostgreSQL 17 test harness (tests/docker-compose.pg.yml on port 55432)
affects: [00-04-line, 00-05-auth, 00-06-web-deploy, 00-07-provision, all-later-phases]

# Tech tracking
tech-stack:
  added: []  # all deps already pinned in 00-01 (drizzle-orm@0.45.2, drizzle-kit@0.31.10, postgres@3.4.9)
  patterns:
    - dual-connection (runtime pooled prepare:false / migrations DIRECT) — Pitfall 2
    - hand-written-down-sql + down-runner convention from migration #0000 — Pitfall 3
    - injectable-db factory (makeHealthRoutes) for in-process 200/503 readiness testing
    - ephemeral-docker-pg17 integration harness (up before test, down -v after)

key-files:
  created:
    - api/src/db/schema.ts
    - api/src/db/client.ts
    - api/drizzle.config.ts
    - api/drizzle/0000_init.sql
    - api/drizzle/0000_init.down.sql
    - api/drizzle/meta/_journal.json
    - api/drizzle/meta/0000_snapshot.json
    - api/src/lib/migrate-down.ts
    - api/tests/docker-compose.pg.yml
    - api/tests/migrate.test.ts
  modified:
    - api/src/plugins/db.plugin.ts
    - api/src/routes/health.ts
    - api/tests/health.test.ts

key-decisions:
  - "Runtime client hardcodes postgres.js prepare:false against the pooled endpoint (Pitfall 2); migrations read DATABASE_URL_DIRECT via drizzle.config.ts — one landmine designed out from migration #0000."
  - "Migration reversibility (Criterion 2) is proven by applying the up/down .sql files DIRECTLY and symmetrically, NOT via drizzle-kit's migrator — its journal table would make a second up() a no-op and defeat the up→down→up proof."
  - "drizzle.config.ts guards DATABASE_URL_DIRECT with an explicit throw instead of a non-null assertion (biome-clean + fail-fast with a clear message)."
  - "health.ts exposes makeHealthRoutes(db) with the real module db as default; index.ts still imports the unchanged healthRoutes export, and tests inject good/bad clients to prove 200 AND 503 deterministically in one process."

patterns-established:
  - "Every NNNN_name.sql ships with a hand-written NNNN_name.down.sql (exact reverse DDL, IF EXISTS, drop in dependency order) + bun src/lib/migrate-down.ts <file> to run it."
  - "Integration tests spin an ephemeral postgres:17 via tests/docker-compose.pg.yml (port 55432, throwaway creds), and tear it down with `down -v`."

requirements-completed: [PLAT-02]

# Metrics
duration: 6min
completed: 2026-07-02
---

# Phase 0 Plan 02: Database Slice Summary

**RBAC-ready `users`/role schema on a dual-connection Drizzle client (runtime pooled + `prepare:false`, migrations on the DIRECT url), with a reversible migration proven up→down→up against Docker PostgreSQL 17 and a DB-backed `/health/ready` (200/503) — Neon PgBouncer (Pitfall 2) and drizzle-kit's missing down (Pitfall 3) both designed out from migration #0000.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-02T02:29:00Z
- **Completed:** 2026-07-02T02:35:30Z
- **Tasks:** 3
- **Files:** 10 created, 3 modified

## Accomplishments
- **RBAC schema (D-07):** `roleEnum = pgEnum("role", ["owner","admin","grower","packer"])` + `users` table (uuid pk, email, password_hash, role default `packer`, nullable line_user_id, timestamptz created_at) with a unique `users_email_idx` on email.
- **Dual-connection client (Pitfall 2):** runtime `postgres(env.DATABASE_URL, { prepare: false, max: 10 })` + `drizzle` — `prepare:false` is REQUIRED against Neon's pooled PgBouncer (transaction-mode) endpoint; `drizzle.config.ts` points migrations at `DATABASE_URL_DIRECT` (unpooled).
- **Reversible migration (Criterion 2, Pitfall 3):** `bun run db:generate --name init` emitted `0000_init.sql`; hand-wrote `0000_init.down.sql` (`DROP TABLE IF EXISTS users; DROP TYPE IF EXISTS role`) + `src/lib/migrate-down.ts` (runs argv down-SQL on the DIRECT url). Proven by `migrate.test.ts`: up → users+role present, down → both absent, up again → back with no residue, against real PG17.
- **BLOCKING live migrate:** `db:migrate` applied `0000_init` to a live PG17; verified `to_regclass('public.users')` non-null and the `role` type exists; re-run is an idempotent no-op (journal has exactly 1 entry, only harmless `already exists, skipping` NOTICEs).
- **Readiness probe (D-14):** `GET /health/ready` runs `SELECT 1` → 200 `{status:"ready"}` / 503 `{status:"unavailable"}`; does NOT live-call LINE/R2. `db.plugin.ts` stub replaced to decorate context with `db` (name `db` kept; `index.ts` untouched).
- **Tests:** 11 pass across 3 files (4 env + 4 health + 3 migrate), typecheck clean, Biome clean.

## Task Commits

1. **Task 1: DB schema + dual-connection client + drizzle config + ephemeral PG17** — `9fc5b7d` (feat)
2. **Task 2 (RED): failing up→down→up migration test** — `51ab5a4` (test)
3. **Task 2 (GREEN): generate 0000_init + hand-written down + down-runner** — `5e007de` (feat)
4. **Task 3: DB-backed /health/ready (200/503) + BLOCKING live-migrate** — `d35f556` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Decisions Made
- **Direct-SQL up→down→up proof** — drizzle-kit's migrator records applied migrations in a journal table, so a second `migrate()` after a down would skip 0000 and `users` would never reappear. The test therefore applies the up/down `.sql` files directly and symmetrically via `postgres.js .file()` — an honest reversibility proof of the exact SQL pair.
- **Explicit throw over non-null assertion in drizzle.config.ts** — `if (!url) throw ...` is Biome-clean and fails fast with a message naming the missing var, instead of `process.env.DATABASE_URL_DIRECT!`.
- **`makeHealthRoutes(db)` factory** — keeps `index.ts` untouched (still imports the default `healthRoutes`) while making both readiness branches (200 reachable / 503 unreachable) deterministically testable in a single process by injecting good/bad clients — no mid-test docker manipulation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree created off the wrong base commit**
- **Found during:** Setup (before Task 1)
- **Issue:** The worktree branch `worktree-agent-*` was created from `dbd9d40` ("Initial commit", README-only) instead of the intended base `3023468`. `.planning/`, the plan, and all 00-01 files were absent — nothing to execute against.
- **Fix:** `dbd9d40` is a clean ancestor of `3023468` with no local commits, so a lossless `git merge --ff-only 3023468` fast-forwarded the agent branch onto the intended base. No protected branch touched, no force-rewind, no commits destroyed.
- **Files modified:** none (git state only)
- **Verification:** `git rev-parse HEAD` = `3023468`; plan + 00-01 files present.

**2. [Rule 3 - Blocking] Dependencies not installed in the fresh worktree**
- **Found during:** Setup (before Task 1)
- **Issue:** `drizzle-orm`/`drizzle-kit`/`postgres`/`elysia` were absent — `bun test`/`tsc` would fail.
- **Fix:** `bun install --frozen-lockfile` (deps resolved into `api/node_modules` per the committed `bun.lock`; no lockfile change).
- **Files modified:** none tracked (node_modules only).
- **Verification:** `bun -e "import('postgres')"` OK; `bunx drizzle-kit --version` → 0.31.10 / drizzle-orm 0.45.2.

**3. [Rule 1 - Formatting] Biome formatting on new files**
- **Found during:** Tasks 1 & 3
- **Issue:** Biome flagged a long-line format in `drizzle.config.ts` and import ordering in `health.test.ts` (CLAUDE.md mandates Biome).
- **Fix:** `biome check --write`; re-ran checks (clean) and tests (green).
- **Files modified:** `api/drizzle.config.ts`, `api/tests/health.test.ts`
- **Verification:** `bunx biome check api/src api/tests api/drizzle.config.ts` → 19 files, no fixes.

---

**Total deviations:** 3 auto-fixed (2 blocking environment fixes, 1 formatting). No behavior changed beyond satisfying the plan's own verify commands and the Biome mandate; no scope creep.

## Issues Encountered
- **Worktree base + missing deps** — see Deviations 1 & 2; both were one-time environment recoveries.
- **drizzle-kit generate random naming** — first `db:generate` produced `0000_elite_living_tribunal.sql`; regenerated with `--name init` to get the plan-specified `0000_init.sql` and matching journal tag.
- **db:migrate NOTICE noise** — a second `db:migrate` prints `schema/relation already exists, skipping` NOTICEs; these are drizzle's own idempotent `CREATE ... IF NOT EXISTS` bookkeeping (exit 0), not errors.

## User Setup Required
None. This plan uses only the committed dummy `.env.test` and an ephemeral Docker PG17 (torn down with `down -v`). Real Neon `DATABASE_URL`/`DATABASE_URL_DIRECT` are provisioned in Wave 4 (00-07).

## Known Stubs
None. The `db.plugin.ts` stub from 00-01 is now fully implemented. Remaining plugin stubs (storage/line/auth) are owned by their respective wave-2 plans.

## Next Phase Readiness
- Durable identity schema (`users` + role enum) is applied and reversible — every later phase (auth, orders, crop planning) builds on it.
- Dual-connection contract is set: later query code just imports `db` (pooled, prepare:false); migrations always run on the DIRECT url.
- `/health/ready` gives real DB reachability (200/503) for deploy/monitoring probes in 00-07.
- `index.ts` untouched — parallel-safe with 00-03/00-04/00-05 in the same wave.
- No blockers.

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*

## Self-Check: PASSED
- All 9 tracked plan files (+ SUMMARY) verified present on disk.
- All 4 task commits verified in git history (9fc5b7d, 51ab5a4, 5e007de, d35f556).
- 11 Bun tests pass (4 env + 4 health + 3 migrate); typecheck clean; Biome clean (19 files).
- `git diff 3023468 HEAD -- api/src/index.ts` empty — index.ts untouched (parallel-safe).
- Ephemeral PG17 torn down (`down -v`); no container left running.
