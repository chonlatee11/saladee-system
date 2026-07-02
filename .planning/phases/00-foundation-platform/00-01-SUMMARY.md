---
phase: 00-foundation-platform
plan: 01
subsystem: infra
tags: [bun, elysia, typebox, eden-treaty, monorepo, bun-workspaces, biome, env-validation]

# Dependency graph
requires: []
provides:
  - Bun-workspaces monorepo (api/ + web/) installing from a single root lockfile
  - Boot-time TypeBox env validation (fail-fast) with a pure validateEnv() for tests
  - Structured JSON stdout logger (log.info/warn/error)
  - Composed Elysia app exporting `type App` for Eden Treaty + GET /health (200)
  - Interface-first stub seams (db/storage/line/auth plugins; webhook/files/auth routes)
  - Fixed index.ts composition order so wave-2 slices never edit index.ts
affects: [00-02-database, 00-03-storage, 00-04-line, 00-05-auth, 00-06-web-deploy, 00-07-provision]

# Tech tracking
tech-stack:
  added: [elysia@1.4.29, "@elysiajs/eden@1.4.9", drizzle-orm@0.45.2, postgres@3.4.9, "@line/bot-sdk@11.0.2", jose@6.2.3, "@sinclair/typebox@0.34.49", drizzle-kit@0.31.10, "@biomejs/biome@2.5.2", vue@3.5.39, "@line/liff@2.29.0", vite@8.1.0, tailwindcss@4.3.1]
  patterns: [boot-time-env-validation, elysia-plugin-per-client, interface-first-stub-seams, guarded-listen-via-import-meta-main, eden-treaty-type-export]

key-files:
  created:
    - package.json
    - api/package.json
    - api/src/env.ts
    - api/src/index.ts
    - api/src/lib/logger.ts
    - api/src/routes/health.ts
    - api/tests/env.test.ts
    - api/tests/health.test.ts
  modified: []

key-decisions:
  - "Interface-first stub seams + FIXED index.ts composition let wave-2 slices fill only their own module, never editing index.ts — enables parallel disjoint-file execution."
  - ".env.test committed at both repo root and api/ so 'cd api && bun test' boot-validates from the api cwd (Bun loads env from cwd)."
  - "Pinned @line/bot-sdk to 11.0.2 (CLAUDE.md lock) despite registry 11.1.0; no floating versions."
  - "PLAT-02/PLAT-05 left Pending — plan 00-01 scaffolds only; they complete across 00-02/00-03/00-06."

patterns-established:
  - "Boot-time env validation: TypeBox EnvSchema + Value.Check; pure validateEnv() for tests, process.exit(1) side effect at module load."
  - "Elysia plugin per external client, decorated onto context; stub body replaced downstream without touching index.ts."
  - "Guarded .listen via import.meta.main so tests use app.handle() without binding a port."

requirements-completed: []  # PLAT-02 / PLAT-05 are phase-spanning; NOT completed by plan 00-01 (see Decisions).

# Metrics
duration: 8min
completed: 2026-07-02
---

# Phase 0 Plan 01: Monorepo Skeleton + Bootable API Slice Summary

**Bun-workspaces monorepo with fail-fast TypeBox env validation and a composed Elysia app that serves GET /health (200) and exports `type App` for Eden Treaty, wired atop interface-first stub seams for parallel wave-2 execution.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T02:13:23Z
- **Completed:** 2026-07-02T02:19:38Z
- **Tasks:** 3
- **Files modified:** 25 (created)

## Accomplishments
- Bun-workspaces monorepo (`api/` + `web/`) installs cleanly from a single root `bun.lock`; all dependency versions pinned exactly per CLAUDE.md (`@line/bot-sdk` held at 11.0.2, not the registry's 11.1.0).
- Boot-time TypeBox env validation: 12 required vars (`JWT_SECRET` minLength 32, `PORT` default 3000, `NODE_ENV` union); a missing/short var aborts boot via `process.exit(1)` with a structured JSON fatal line naming the offending var — no secret value logged.
- Composed Elysia app with structured JSON logger, real `GET /health` → `{status:"ok"}`, `export type App` for Eden Treaty, and a guarded `.listen(env.PORT)` (via `import.meta.main`) that emits a JSON "listening" line.
- Interface-first stub seams: 4 plugins (`db`/`storage`/`line`/`auth`) + 3 route stubs (`webhook`/`files`/`auth`) with a FIXED composition order in `index.ts`, so wave-2 slices (00-02..00-05) replace only their own module without editing `index.ts`.
- 6 Bun tests green (4 env-validation + 2 health/liveness); Biome clean.

## Task Commits

Each task was committed atomically (TDD tasks split test → feat):

1. **Task 1: Bootstrap Bun-workspaces monorepo** — `23371f5` (chore)
2. **Task 2 (RED): failing env-validation tests** — `a010d1b` (test)
3. **Task 2 (GREEN): boot-time TypeBox env validation** — `7f6e980` (feat)
4. **Task 3 (RED): failing /health + app-import test** — `bb9bffc` (test)
5. **Task 3 (style): env.ts biome format** — `4fe091b` (style)
6. **Task 3 (GREEN): compose app, logger, /health, wave-2 stubs** — `db2ef3e` (feat)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `package.json` — root workspace (private, workspaces [api, web]) + Biome dev dep
- `.gitignore` — ignores bare `.env`, node_modules, dist, .bun (`.env.example`/`.env.test` tracked)
- `biome.json` — lint+format, 2-space, recommended rules
- `api/package.json` — exact-pinned deps + scripts (dev/start/test/db:generate/db:migrate/db:down)
- `api/tsconfig.json` — strict, bundler resolution, Bun types
- `web/package.json` — minimal workspace member (vue, liff, vite, tailwind); no source yet (lands in 00-06)
- `bun.lock` — single root lockfile
- `api/src/env.ts` — TypeBox EnvSchema + pure `validateEnv()` + fail-fast `loadEnv()` exporting `env`
- `.env.example` — committed template (12 vars); `.env.test` + `api/.env.test` dummy-valid values
- `api/src/lib/logger.ts` — structured JSON stdout logger (never logs secrets)
- `api/src/types.ts` — shared `Role` union (owner/admin/grower/packer) + `ROLES`
- `api/src/routes/health.ts` — real `GET /health` liveness
- `api/src/routes/{webhook,files,auth}.ts` — route stubs for 00-04/00-03/00-05
- `api/src/plugins/{db,storage,line,auth}.plugin.ts` — named Elysia stub plugins for 00-02..00-05
- `api/src/index.ts` — composed app, `export type App`, guarded listen
- `api/tests/env.test.ts`, `api/tests/health.test.ts` — Bun tests (Criterion 1 proof)

## Decisions Made
- **Interface-first stub seams + fixed `index.ts` composition** — wave-2 slices own disjoint files and never edit `index.ts`, enabling parallel execution.
- **`.env.test` in both root and `api/`** — Bun loads env from cwd; the plan's verify command runs `cd api && bun test`, so the api-level copy is required for boot validation to pass (see Deviations).
- **`@line/bot-sdk` pinned to 11.0.2** — honors the CLAUDE.md lock over the registry's 11.1.0; no floating versions anywhere.
- **`@sinclair/typebox` pinned to 0.34.49** — explicit dep satisfying Elysia's `>= 0.34.0 < 1` peer range (verified via `npm view`).
- **PLAT-02 / PLAT-05 left Pending** — plan 00-01 only scaffolds the platform; PostgreSQL (00-02), object storage (00-03), and mobile/web (00-06) complete these phase-spanning requirements. Marking them done now would misrepresent phase progress.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `api/.env.test` so the specified verify command boot-validates**
- **Found during:** Task 2 (GREEN — boot-time env validation)
- **Issue:** The plan's verify command is `cd api && bun test tests/env.test.ts`. Bun loads `.env` files from the current working directory (`api/`), but the plan placed `.env.test` only at the repo root. Importing `src/env.ts` therefore ran module-load validation against an empty `process.env` and `process.exit(1)` killed the test process.
- **Fix:** Committed `api/.env.test` (identical dummy-valid values) alongside the root `.env.test`, so `cd api && bun test` boot-validates from the api cwd; the root copy remains for root-level `bun test`.
- **Files modified:** `api/.env.test` (added)
- **Verification:** `cd api && bun test` → 6 pass, 0 fail; module-load fatal no longer triggers.
- **Committed in:** `7f6e980` (Task 2 GREEN commit)

**2. [Rule 1 - Formatting] Collapsed env.ts error map to one line (Biome)**
- **Found during:** Task 3 (Biome sanity check)
- **Issue:** `biome check` flagged a formatting diff in the already-committed `api/src/env.ts` (multi-line `.map` call the formatter would collapse). CLAUDE.md mandates Biome.
- **Fix:** Applied the single-line format; re-ran Biome (clean) and tests (green).
- **Files modified:** `api/src/env.ts`
- **Verification:** `bunx biome check api/src api/tests` → no errors; `bun test` → 6 pass.
- **Committed in:** `4fe091b` (style commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 formatting)
**Impact on plan:** Both necessary to satisfy the plan's own verify command and the CLAUDE.md Biome mandate. No scope creep — no behavior changed beyond making the specified checks pass.

## Issues Encountered
- Bun env-file resolution is cwd-relative (not monorepo-root-walking); resolved by co-locating `.env.test` at `api/` for the `cd api && bun test` workflow (see Deviation 1).
- `gsd-sdk query state.record-metric` / `state.add-decision` require named flags (`--phase/--plan/--duration`, `--summary`) rather than positional args; used named flags.

## User Setup Required
None for this plan. External accounts (Neon / R2 / LINE) are already provisioned per 00-CONTEXT.md and are consumed in Wave 4 (00-07); the real `.env` (gitignored) is created there. This plan uses only committed dummy `.env.test` values.

## Next Phase Readiness
- Platform boots on validated env and serves `/health` 200; `type App` exported for the 00-06 Eden Treaty proof.
- Stub seams + fixed `index.ts` composition are in place — wave-2 slices (00-02 DB, 00-03 storage, 00-04 LINE, 00-05 auth) can proceed in parallel with disjoint file ownership.
- Eden Treaty end-to-end import from `web/` is deferred to 00-06 (web has no source yet, by plan); the workspace already resolves both members.
- No blockers.

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*

## Self-Check: PASSED
- All 24 planned files verified present on disk.
- All 6 task commits verified in git history (23371f5, a010d1b, 7f6e980, bb9bffc, 4fe091b, db2ef3e).
- `bun install --frozen-lockfile` exit 0; `cd api && bun test` → 6 pass / 0 fail; Biome clean; no bare `.env` tracked.
