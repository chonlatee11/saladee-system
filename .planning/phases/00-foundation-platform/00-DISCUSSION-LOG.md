# Phase 0: Foundation & Platform - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 0-Foundation & Platform
**Areas discussed:** Database hosting, Deploy & CI, LINE wiring depth, RBAC/Auth, Repo structure, Secrets & config, Migration workflow, Health & observability

---

## Database hosting

| Option | Description | Selected |
|--------|-------------|----------|
| Neon free tier | Managed Postgres, auto backups + branching, ~1s cold-resume, 0.5 GB | ✓ (prod) |
| Self-host on VPS (Docker/native) | Cheapest, no cold-start, but must run own backups | (fallback) |
| Supabase free | $0 but pauses after ~1 week idle (bad for webhook), 500 MB | |
| Supabase Pro | $25/mo — over budget | |
| Docker on own machine | Great for dev DB; not viable for prod (webhook needs always-on) | ✓ (dev) |

**User's choice:** dev = Docker Postgres on own machine; prod = Neon free tier.
**Notes:** User asked to compare Supabase cost vs Docker self-host. Concluded Supabase not worth it (bundled Auth/Storage unneeded — LINE gives identity, R2 gives storage; free tier pauses, Pro over budget). Neon chosen for hands-off backups suited to a solo dev.

---

## Deploy & CI

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions + SSH deploy (hosted runner) | build → SSH → deploy VPS + migrate; no VPS resource contention | ✓ |
| GitHub Actions + self-hosted runner on VPS | Saves cloud minutes / ARM builds, but competes for VPS resources + attack surface | |

**User's choice:** GitHub Actions + SSH deploy, no self-hosted runner.
**Notes:** User asked GitHub vs GitLab and whether to use own machine as runner. Recommended GitHub (matches existing usage, lighter than self-hosting GitLab) and no self-hosted runner in Phase 0 (unneeded for build→SSH pattern; adds ops + security surface).

---

## LINE wiring depth

| Option | Description | Selected |
|--------|-------------|----------|
| Webhook validate + echo | Real `/webhook` validating `x-line-signature` + echo reply — proves LINE OA link end-to-end | ✓ |
| Init client + config only | Just construct @line/bot-sdk from env so boot isn't stubbed; no live webhook | |

**User's choice:** Webhook validate + echo.
**Notes:** User wants Phase 0 to demonstrate the LINE connection works end-to-end, not merely compile.

---

## RBAC / Auth

| Option | Description | Selected |
|--------|-------------|----------|
| Full role set, in-app | owner/admin/grower/packer in schema now; hashed passwords + jose JWT + LINE idToken verify | ✓ |
| Admin-only for now | Single role, expand later | |
| Keycloak | External identity server — considered by user, rejected (heavy RAM/ops, violates NFR-08) | |

**User's choice:** Full role set, in-app; no Keycloak.
**Notes:** User initially wanted a full role set and asked about using Keycloak. Advised against Keycloak for a low-cost solo MVP (JVM + own DB too heavy; LINE already provides customer identity). Kept full roles because baking them in now avoids a later identity migration.

---

## Repo structure

| Option | Description | Selected |
|--------|-------------|----------|
| Monorepo (Bun workspaces) | api/ + web/ one repo; Eden Treaty type-sharing; path-filtered deploys | ✓ |
| Separate repos | Independent repos, no direct type-sharing | |

**User's choice:** Monorepo via Bun workspaces (default accepted).
**Notes:** No shared `packages/` until a genuinely shared type appears.

---

## Secrets & config

| Option | Description | Selected |
|--------|-------------|----------|
| Validate env at boot (TypeBox) + .env / GH Actions Secrets | Fail-fast on missing vars; no hardcoded secrets | ✓ |

**User's choice:** Accepted the proposed approach.
**Notes:** local `.env` (gitignored) + committed `.env.example`; prod secrets in GitHub Actions Secrets injected at deploy.

---

## Migration workflow

| Option | Description | Selected |
|--------|-------------|----------|
| drizzle-kit generate + commit + migrate-on-deploy | Versioned SQL migrations in git, run during deploy | ✓ |
| drizzle-kit push | Direct schema sync, no versioned files | |

**User's choice:** generate + commit + migrate-on-deploy.
**Notes:** Down SQL written by hand per migration for reversibility (success criterion 2), verified apply→rollback in dev.

---

## Health & observability

| Option | Description | Selected |
|--------|-------------|----------|
| `/health` (200) + `/health/ready` (DB ping + config check) + stdout JSON logs | Lightweight, no paid tooling | ✓ |

**User's choice:** Accepted the proposed approach.
**Notes:** No live LINE/R2 calls on health checks; no paid error-tracking in Phase 0 (add later).

---

## Claude's Discretion

- Internal `api/` module layout, password-hashing library choice (argon2 vs bcrypt), Caddyfile specifics, and exact TypeBox env schema shape — left to research/planning.

## Deferred Ideas

- Keycloak / external SSO — reconsider at enterprise scale.
- Self-hosted CI runner — reconsider if GitHub build minutes run out or ARM-native builds needed.
- Paid error-tracking (Sentry, etc.) — add as traffic grows.
- Self-host PostgreSQL on the VPS — fallback if Neon free-tier limits become a problem.
