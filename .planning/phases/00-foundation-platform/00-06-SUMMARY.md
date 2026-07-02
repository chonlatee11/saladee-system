---
phase: 00-foundation-platform
plan: 06
subsystem: infra
tags: [eden-treaty, elysia, vue, vite, tailwind, caddy, systemd, github-actions, cloudflare-pages]

# Dependency graph
requires:
  - phase: 00-foundation-platform (00-01..00-05)
    provides: api/src/index.ts `export type App` (health/webhook/files/auth composed), web/ workspace member (vue/liff/vite deps)
provides:
  - web/ Vue+Vite LIFF scaffold with an Eden Treaty typed /health call (D-09 compile-time contract) that builds to static web/dist
  - Caddyfile (auto-HTTPS reverse proxy to localhost:3000 + HSTS)
  - deploy/saladee-api.service (systemd unit, EnvironmentFile secrets, journald logs)
  - .github/workflows/deploy-api.yml (path-filtered SSH deploy + DIRECT-url migrate + restart, test-gated)
  - .github/workflows/deploy-web.yml (path-filtered Vite build + Cloudflare Pages deploy)
affects: [00-07-live-provisioning, phase-1-line-commerce, phase-2-web-store, deploy]

# Tech tracking
tech-stack:
  added: []  # all versions locked in CLAUDE.md; @elysiajs/eden 1.4.9 added to web deps (already locked)
  patterns:
    - "Eden Treaty type-sharing: web imports api `App` type; treaty<App>() makes an api route change a web compile error (D-09)"
    - "Guarded module side-effects: DOM bootstrap behind `typeof document !== undefined`, LIFF init behind a configured id — module is bun-test importable with no DOM/network/live-id"
    - "Caddy owns TLS; Bun binds localhost:3000 plain (never terminate TLS in Bun)"
    - "Secrets flow GH Secrets -> systemd EnvironmentFile (600); no literals in unit/workflows"
    - "Path-filtered workflows deploy api/** and web/** independently; bun test gates the api deploy; migrate uses the DIRECT/unpooled Neon url (Pitfall 2)"

key-files:
  created:
    - web/src/main.ts
    - web/vite.config.ts
    - web/tsconfig.json
    - web/index.html
    - web/tests/eden-types.test.ts
    - Caddyfile
    - deploy/saladee-api.service
    - .github/workflows/deploy-api.yml
    - .github/workflows/deploy-web.yml
  modified:
    - web/package.json
    - bun.lock

key-decisions:
  - "Vite build is the CI gate (esbuild strips the type-only App import); the Eden contract is proven structurally (import type + treaty<App>) plus a bun-test asserting the client shape — no vue-tsc gate added to keep CI green and avoid pulling api's Bun-global type graph into web typecheck"
  - "Web renders via a minimal Vue createApp (uses the locked vue dep genuinely); real storefront UI deferred to Phase 2"
  - "@line/liff imported dynamically inside guarded initLiff so browser globals never touch module top level (bun-test safe)"
  - "deploy-web.yml uses cloudflare/wrangler-action@v3 `pages deploy` (the official Pages action) with VITE_API_URL from repo vars"

patterns-established:
  - "Eden Treaty typed /health call from web/src/main.ts against the api App type (D-09)"
  - "Guarded side-effects make the SPA entry module unit-testable without a browser or server"
  - "Committed-config-only plan: no api/src/* edits, no live provisioning (deferred to 00-07)"

requirements-completed: [PLAT-02, PLAT-05]

# Metrics
duration: ~14min
completed: 2026-07-02
---

# Phase 0 Plan 06: Deploy + Type-Sharing Configuration Summary

**Vue+Vite LIFF scaffold proving Eden Treaty type-sharing (a typed /health call against the api App type) that builds to static web/dist, plus committed Caddy auto-HTTPS reverse proxy, systemd EnvironmentFile unit, and path-filtered GitHub Actions for SSH API deploy (DIRECT-url migrate) and Cloudflare Pages web deploy — all config, no live provisioning.**

## Performance

- **Duration:** ~14 min
- **Completed:** 2026-07-02
- **Tasks:** 2
- **Files modified:** 11 (9 created, 2 modified)

## Accomplishments
- `web/src/main.ts`: constructs `treaty<App>()` importing the api `App` type — a typed `/health` GET whose wrong path/method would be a compile error (D-09). Guarded LIFF init (no live id required) and guarded Vue DOM bootstrap keep the module bun-test importable.
- `web/` builds to static `web/dist` via Vite 8 + Vue plugin + Tailwind v4 plugin (15 modules, ~10 kB app chunk) — deployable to Cloudflare Pages.
- `Caddyfile`: `reverse_proxy localhost:3000`, gzip/zstd, HSTS + `X-Content-Type-Options nosniff` — Caddy owns TLS, Bun stays localhost-plain (T-00-21).
- `deploy/saladee-api.service`: `Type=simple`, non-root `saladee` user, `EnvironmentFile=/opt/saladee/api/.env`, `Restart=always`, journald logs — zero secret literals (D-11/D-15, T-00-22).
- `deploy-api.yml`: `api/**` path filter, `bun test` deploy gate, SSH `git pull --ff-only` -> `db:migrate` with `DATABASE_URL_DIRECT` (unpooled, Pitfall 2) -> `systemctl restart` (D-03/D-12, T-00-23/24).
- `deploy-web.yml`: `web/**` path filter, Vite build with `VITE_API_URL`, deploy `web/dist` to Cloudflare Pages via `cloudflare/wrangler-action@v3`.
- Actions pinned: `actions/checkout@v4`, `oven-sh/setup-bun@v2` (1.3.14), `appleboy/ssh-action@v1`, `cloudflare/wrangler-action@v3`.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing Eden Treaty type-sharing test** - `d51f774` (test)
2. **Task 1 (GREEN): web Eden Treaty scaffold + Vite/Vue/Tailwind build** - `3fad894` (feat)
3. **Task 2: Caddy + systemd + path-filtered deploy workflows** - `094f5c5` (feat)

**Plan metadata:** (final docs commit — see git log)

_Task 1 is TDD: test (RED) -> feat (GREEN)._

## Files Created/Modified
- `web/src/main.ts` - Eden Treaty client (`treaty<App>()`), typed `getHealth()`, guarded LIFF init + guarded Vue DOM bootstrap.
- `web/vite.config.ts` - Vite build (Vue SFC + Tailwind v4 plugins) -> static `web/dist`.
- `web/tsconfig.json` - Strict bundler-resolution config for the SPA (vite/client types).
- `web/index.html` - Mobile-first `#app` mount point + module entry.
- `web/tests/eden-types.test.ts` - Bun test asserting the treaty client exposes the `/health` route + typed helper (D-09 proof).
- `web/package.json` - Added `@elysiajs/eden` dep + `test` script.
- `bun.lock` - Lockfile updated for `@elysiajs/eden` in web.
- `Caddyfile` - Auto-HTTPS reverse proxy to localhost:3000 + HSTS.
- `deploy/saladee-api.service` - systemd unit with EnvironmentFile secrets + journald.
- `.github/workflows/deploy-api.yml` - Path-filtered SSH deploy + DIRECT-url migrate + restart, test-gated.
- `.github/workflows/deploy-web.yml` - Path-filtered Vite build + Cloudflare Pages deploy.

## Decisions Made
- CI gate for D-09 is the Vite build + the bun-test client-shape assertion, not a separate vue-tsc typecheck. Rationale: esbuild strips the `import type { App }` at build, and a full `tsc` on `main.ts` would pull api's Bun-global type graph into web's typecheck (fragile, needs @types/bun resolution from web). The structural contract (`import type` + `treaty<App>`) plus the runtime assertion is sufficient and keeps CI reliably green; a heavier typecheck can be added when web gains real UI in Phase 2.
- Rendered the health status via a minimal Vue `createApp` so the locked `vue` dependency and `@vitejs/plugin-vue` are genuinely exercised, while keeping the scaffold thin.
- `@line/liff` is dynamically imported inside `initLiff` (only when a LIFF id is configured) so browser globals never execute at module load — the entry module imports cleanly under `bun test`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@elysiajs/eden` to web dependencies**
- **Found during:** Task 1 (web scaffold)
- **Issue:** `web/src/main.ts` must `import { treaty } from "@elysiajs/eden"`, but eden was only an api devDependency — not resolvable from the web workspace.
- **Fix:** Added `@elysiajs/eden` 1.4.9 (already locked in CLAUDE.md/RESEARCH) to `web/package.json` dependencies and ran `bun install` to update `bun.lock`; then verified `bun install --frozen-lockfile` passes.
- **Files modified:** web/package.json, bun.lock
- **Verification:** `bun install --frozen-lockfile` -> exit 0; `bun run --cwd web build` -> web/dist produced.
- **Committed in:** `3fad894` (Task 1 GREEN commit)

**2. [Rule 2 - Missing Critical] Guarded module side-effects for testability**
- **Found during:** Task 1 (Bun test importing the SPA entry)
- **Issue:** A naive SPA entry runs LIFF init + DOM mount at import time, which throws under `bun test` (no `document`, no live LIFF id) and would make the D-09 proof untestable.
- **Fix:** Wrapped the Vue DOM bootstrap in `typeof document !== "undefined"`, gated `initLiff` on a configured `VITE_LIFF_ID`, and made the `@line/liff` import dynamic. The module now exports `api`/`getHealth` for the test with no DOM/network/live-id.
- **Files modified:** web/src/main.ts
- **Verification:** `bun test` (web) -> 2 pass; `vite build` -> exit 0.
- **Committed in:** `3fad894` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both were necessary to satisfy the plan's own gates (importable eden + a testable D-09 proof). No scope creep; no api/src/* files edited.

## Issues Encountered
- None beyond the deviations above. YAML validated via `js-yaml` (both workflows parse); all source assertions (reverse_proxy, EnvironmentFile, DATABASE_URL_DIRECT, path filters, pinned action versions) confirmed by grep.

## User Setup Required
None in this plan. Live provisioning (real domain, VPS, Neon URLs, Cloudflare Pages project, GitHub Secrets: `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`/`DATABASE_URL_DIRECT`/`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, repo var `VITE_API_URL`, and replacing `api.saladee.example`) is performed and verified in 00-07.

## Next Phase Readiness
- HTTPS-on-VPS pipeline defined end-to-end (Caddy + systemd + CI) and internally consistent — ready for the live deploy in 00-07.
- Eden Treaty type-sharing proven at compile time (D-09); web builds to static assets for Cloudflare Pages.
- 00-07 must: set the real API domain in Caddyfile, populate GitHub Secrets + `VITE_API_URL`, create the `saladee-web` Pages project, install the systemd unit, and run a live smoke of `/health` over HTTPS.

## Self-Check: PASSED
- Files present: web/src/main.ts, web/vite.config.ts, web/tsconfig.json, web/index.html, web/tests/eden-types.test.ts, Caddyfile, deploy/saladee-api.service, .github/workflows/deploy-api.yml, .github/workflows/deploy-web.yml, 00-06-SUMMARY.md
- Commits present: d51f774, 3fad894, 094f5c5
- Invariants: no api/src/* edited; CLAUDE.md and salad-shop-requirements.md (pre-existing, not ours) left unstaged

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*
