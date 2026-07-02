---
phase: 00-foundation-platform
plan: 08
subsystem: api
tags: [cors, elysia, security, eden-treaty, cloudflare-pages]

# Dependency graph
requires:
  - phase: 00-01
    provides: FIXED index.ts plugin composition seam (Elysia app)
  - phase: 00-06
    provides: env schema (EnvSchema, boot-time validation)
  - phase: 00-07
    provides: live API on DigitalOcean droplet + web on Cloudflare Pages + Eden Treaty client
provides:
  - "@elysiajs/cors composed before routes with an env-driven origin allowlist"
  - "CORS_ORIGINS env var (comma-separated) with a safe default"
  - "Cross-origin browser fetch from the Pages web/ page to the API /health now succeeds"
  - "Regression test (api/tests/cors.test.ts) in the CI bun-test gate"
affects: [phase-01-line-liff, web-store, any-cross-origin-frontend]

# Tech tracking
tech-stack:
  added: ["@elysiajs/cors@1.4.2"]
  patterns:
    - "CORS as the FIRST plugin (before routes) — authorized exception to the 00-01 fixed composition order"
    - "Explicit env-driven allowlist (never wildcard+credentials) at the Browser→API trust boundary"

key-files:
  created:
    - api/tests/cors.test.ts
  modified:
    - api/package.json
    - api/src/env.ts
    - api/src/index.ts
    - bun.lock

key-decisions:
  - "CORS_ORIGINS is env-driven with a safe default (Pages + localhost) so boot passes without a new GitHub secret; changing the deployed web origin means overriding the env var, not editing code."
  - "cors composed as the first plugin — the only sanctioned exception to the 00-01 fixed composition order — so OPTIONS preflight and Access-Control-Allow-Origin are handled before any route runs."
  - "Explicit allowlist, no credentials:true with reflected wildcard (threat T-00-25); Access-Control-Allow-Origin stays scoped to known origins."

patterns-established:
  - "Failing-first (RED→GREEN) regression test proving a browser-only defect that curl/unit tests missed."
  - "Env-driven security config at trust boundaries with schema defaults."

requirements-completed: [PLAT-02, PLAT-05]

# Metrics
duration: 20min
completed: 2026-07-02
---

# Phase 0 Plan 08: CORS Gap-Closure (UAT Test 8) Summary

**Added `@elysiajs/cors@1.4.2` as the first Elysia plugin with an env-driven origin allowlist (`CORS_ORIGINS`), restoring the cross-origin Eden Treaty fetch from the Cloudflare Pages web page to the API `/health` — closing UAT Test 8.**

## Performance

- **Duration:** 20 min (active execution; excludes human live-verify wait)
- **Started:** 2026-07-02T11:24:45Z
- **Completed:** 2026-07-02T11:45:14Z
- **Tasks:** 3 (2 code + 1 blocking live-verify checkpoint)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Pinned `@elysiajs/cors@1.4.2` and regenerated `bun.lock` (CI installs `--frozen-lockfile`).
- Added `CORS_ORIGINS` env allowlist (comma-separated) to `EnvSchema` with a safe default.
- Composed `cors` as the FIRST plugin (before routes), building the allowlist from env; handles OPTIONS preflight (was 404) and stamps `Access-Control-Allow-Origin`.
- Added `api/tests/cors.test.ts` (RED→GREEN): allow-origin header, OPTIONS preflight 204, non-reflection of a disallowed origin, and `/health` no-regression.
- Live re-verified on the deployed stack after CI auto-deploy — UAT Test 8 closed.

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1: RED — pinned dep + CORS_ORIGINS env + failing CORS test** - `da1e91f` (test)
2. **Task 2: GREEN — compose cors before routes from env allowlist** - `d4e1d4e` (feat)
3. **Task 3: Live re-verify CORS on deployed stack** - blocking human-verify checkpoint (no code; approved with live evidence, see below)

**Plan metadata:** see final closeout commit.

## Files Created/Modified
- `api/tests/cors.test.ts` - Regression test asserting CORS header + OPTIONS preflight + non-reflection on `/health` (no DB needed).
- `api/package.json` - Pins `@elysiajs/cors@1.4.2` in dependencies.
- `api/src/env.ts` - Adds `CORS_ORIGINS` to `EnvSchema` with a safe default + guidance comment.
- `api/src/index.ts` - Imports and composes `cors` as the first plugin from the env allowlist; updated the composition-order comment to record the authorized exception.
- `bun.lock` - Regenerated to include `@elysiajs/cors` (frozen-lockfile CI gate).

## Live Verification Evidence (Task 3 — approved)

CI `deploy-api.yml` GREEN (run 28587162483, SSH deploy 1m50s). On `https://146.190.100.171.sslip.io/health`:
- **OPTIONS preflight** → HTTP 204 with `access-control-allow-methods: GET, POST, OPTIONS` and `access-control-allow-origin: https://saladee-web.pages.dev` (was 404). ✅
- **GET** → HTTP 200 `{"status":"ok"}` with `access-control-allow-origin: https://saladee-web.pages.dev`. ✅
- **Disallowed origin** `https://evil.example` → NOT reflected (allowlist works). ✅
- **Browser end-to-end (UAT Test 8):** human hard-reloaded `https://saladee-web.pages.dev` → page shows "Saladee API health: ok". ✅

Maps to Phase 0 **Criterion 1** (HTTPS `/health` usable from the browser) and **Criterion 4** (Eden Treaty wired end-to-end across origins).

## Decisions Made
- Env-driven `CORS_ORIGINS` with a safe default rather than hardcoded literals — no new GitHub secret required; origin changes are config, not code.
- `cors` as the first plugin — the single authorized exception to the 00-01 fixed composition order (documented inline).
- Explicit allowlist, no `credentials: true` with a reflected wildcard. **Non-issue note:** `credentials` is left off and the origin allowlist is explicit, so `Access-Control-Allow-Origin` is always scoped to a known origin — the classic wildcard+credentials pitfall (T-00-25) cannot occur.

## Deviations from Plan

None — plan executed exactly as written. (Rules 1-3 not triggered.)

## Issues Encountered
- Local full-suite run initially showed 5 DB failures and 1 storage timeout — these are environment-dependent integration tests requiring the ephemeral PG17 (port 55432) and MinIO (port 9000) services, not regressions. Starting both via the repo's `tests/docker-compose.pg.yml` and `tests/docker-compose.minio.yml` (as CI does) produced a fully green suite: **26 pass / 0 fail**. Containers were torn down (`down -v`) afterward. `biome check` clean on all three changed files.

## User Setup Required
None — the `CORS_ORIGINS` default covers the live Pages origin + localhost dev; no new secret needed. Override the env var only if the deployed web origin changes.

## Next Phase Readiness
- Phase 0 foundation is now fully closed (8/8 plans); the cross-origin Eden Treaty contract works end-to-end in the browser.
- Any Phase 1 LIFF/web surface on a new origin only needs that origin added to `CORS_ORIGINS`.

## Self-Check: PASSED

- Files verified present: `api/tests/cors.test.ts`, `api/src/index.ts`, `api/src/env.ts`, `.planning/phases/00-foundation-platform/00-08-SUMMARY.md`
- Commits verified in git log: `da1e91f` (RED), `d4e1d4e` (GREEN)

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*
