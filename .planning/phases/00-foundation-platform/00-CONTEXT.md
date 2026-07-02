# Phase 0: Foundation & Platform - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up a single deployable backend running over HTTPS on always-on low-cost
infrastructure, ready for feature development. Delivers: the Elysia/Bun API, a
single PostgreSQL database with a working migration workflow, Cloudflare R2
object storage wired via signed URLs, the LINE Messaging API client, and an
in-app RBAC/auth scaffold — all booting with real (non-stubbed) clients and
config loaded from the environment.

**Requirements:** PLAT-02 (single PostgreSQL + object storage at lowest cost),
PLAT-05 (mobile-first + traffic-spike readiness).

**Success criteria (from ROADMAP.md):**
1. API responds over HTTPS on the production VPS (health endpoint 200), config/secrets from env, no hardcoded secrets.
2. DB migrations apply and roll back cleanly against a single PostgreSQL instance.
3. A file uploads to and downloads from object storage via a short-lived signed URL.
4. The LINE API client and RBAC scaffold are wired and the app boots without them being stubbed.

**Not this phase:** commerce/reservation logic (Phase 1), LIFF storefront &
PromptPay (Phase 2), crop planning / B2B / subscriptions (Phase 3). Phase 0 is
platform scaffolding only.

</domain>

<decisions>
## Implementation Decisions

### Database hosting
- **D-01:** **dev = Docker Postgres on the developer's own machine; prod = Neon free tier** (managed PostgreSQL 17). Neon chosen for hands-off automatic backups + branching, best fit for a solo dev. Accept ~1s cold-resume on the first query after idle.
- **D-02:** **Supabase rejected** — free tier pauses after ~1 week of inactivity (dangerous for the LINE webhook) and its bundled Auth/Storage/Realtime are unneeded (LINE provides identity, R2 provides storage); Supabase Pro ($25/mo) blows the lowest-cost budget (NFR-08). Self-host-on-VPS remains a valid fallback if Neon's 0.5 GB / cold-resume becomes limiting.

### Deploy & CI
- **D-03:** **GitHub Actions + SSH deploy to the VPS**, with migrations run as part of the deploy step. Use GitHub's **hosted runner** (build → SSH → deploy).
- **D-04:** **No self-hosted runner in Phase 0** — putting a runner on the prod VPS would compete for resources with Postgres/API and add attack surface. Revisit only if build minutes run out or ARM-native builds are needed.
- **D-05:** **GitHub over GitLab** — matches existing GitHub usage, broader ecosystem; self-hosting GitLab would be heavy on a small VPS.

### LINE client wiring
- **D-06:** Wire LINE **end-to-end, not just client init**: implement a real `/webhook` endpoint that **validates `x-line-signature`** (via @line/bot-sdk) and **echoes a reply** to prove the LINE OA connection works end-to-end in Phase 0. Reject invalid signatures.

### RBAC / Auth
- **D-07:** **Full role set scaffolded now:** `owner`, `admin`, `grower`, `packer` (Phase 3 needs them). Baking them into the schema up front avoids a later identity migration; enforcement can be added per-endpoint as features arrive.
- **D-08:** **RBAC done in-app — NO Keycloak.** Keycloak (JVM identity server, 512 MB–1 GB RAM + its own DB) is too heavy for the small VPS and violates NFR-08. Instead: staff login with a users table + hashed passwords (per PLAT-03), `jose` for JWT sessions, and server-side verification of LINE `idToken` for customers. Revisit SSO/Keycloak only at enterprise scale.

### Repo structure
- **D-09:** **Monorepo via Bun workspaces** — `api/` (Elysia backend → VPS) and `web/` (Vue LIFF SPA → Cloudflare Pages) in one repo, `package.json` workspace root. Lets `web/` import server types via **Eden Treaty** so API changes surface as compile errors, not runtime bugs. GitHub Actions uses **path filters** to deploy each target independently. No shared `packages/` until a genuinely shared type appears.

### Secrets & config
- **D-10:** **Validate env at boot with TypeBox** — if a required var is missing (`DATABASE_URL`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, R2 credentials, `JWT_SECRET`, …) the API refuses to boot with a clear message. No secret hardcoded anywhere (success criterion 1).
- **D-11:** Config sources: **local `.env` (gitignored) + committed `.env.example` template**; **prod secrets stored in GitHub Actions Secrets** and injected onto the VPS at deploy time (systemd `EnvironmentFile` or a `chmod 600 .env`).

### Migration workflow
- **D-12:** **`drizzle-kit generate`** → SQL migration files committed to `api/drizzle/` in git; **`drizzle-kit migrate` runs during deploy** (after code is up, before the service restarts).
- **D-13:** **Reversible migrations:** drizzle-kit emits up-only migrations, so write a matching **down SQL** by hand for each migration and verify apply→rollback in dev (satisfies success criterion 2 — "roll back cleanly"). Schema is tiny in Phase 0 (users/roles), so this is cheap.

### Health & observability
- **D-14:** Two endpoints: **`/health`** (liveness) returns 200 whenever the process is up; **`/health/ready`** (readiness) pings the DB (`SELECT 1`) and confirms required config loaded. **Do not live-call LINE/R2 on every health check** — only verify their credentials loaded.
- **D-15:** **Structured JSON logs to stdout** (captured by systemd journal). **No paid error-tracking service in Phase 0** — add Sentry/equivalent later as traffic grows.

### Claude's Discretion
- Exact directory layout within `api/` (routes/services/db modules), choice of password-hashing lib (argon2 vs bcrypt), Caddyfile specifics, and the precise TypeBox env schema shape are left to research/planning, consistent with the decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs & requirements
- `CLAUDE.md` — locked technology stack (Bun 1.3.14 / Elysia 1.4.29 / PostgreSQL 17 / Drizzle 0.45.2 / postgres.js 3.4.9 / Cloudflare R2 / Caddy / Hetzner VPS / @line/bot-sdk 11.0.2 / @line/liff 2.29.0 / jose 6.2.3 / TypeBox / Bun native S3 & image), "What NOT to Use" list, and the Neon/self-host/Supabase alternatives table that these decisions build on.
- `.planning/PROJECT.md` — product vision, core value, v1 requirement groups A–J, and explicit out-of-scope (v1) list.
- `.planning/REQUIREMENTS.md` §PLAT-02, §PLAT-05 (this phase); also PLAT-01/03/04 for awareness of what later phases add on this foundation.
- `.planning/ROADMAP.md` §"Phase 0: Foundation & Platform" — goal + 4 success criteria (the acceptance bar for this phase).

### No external ADRs
- No standalone ADR/design docs exist yet — the stack rationale lives in `CLAUDE.md`. Treat `CLAUDE.md`'s "Atomic Stock Reservation" and "What NOT to Use" sections as binding for Phases 0–1.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield. No source code exists yet; the repo currently holds only `.planning/` docs and `CLAUDE.md`.

### Established Patterns
- No code patterns yet. `CLAUDE.md` is the de-facto pattern authority for the stack until code exists.

### Integration Points
- This phase *creates* the integration surface (DB, R2, LINE client, auth) that every later phase plugs into. Build the module boundaries so Phase 1's reservation core and Phase 2's LINE storefront attach without rework.

</code_context>

<specifics>
## Specific Ideas

- Prove the LINE connection with a working signature-validated echo webhook — the user specifically wants Phase 0 to demonstrate the LINE OA link works end-to-end, not just compile.
- Keep prod hands-off: Neon's automatic backups were the deciding factor over self-hosting, because the owner is a solo dev who doesn't want to babysit database backups.

</specifics>

<deferred>
## Deferred Ideas

- **Keycloak / external SSO** — considered for auth, rejected for Phase 0 on cost/ops grounds. Reconsider only at enterprise scale.
- **Self-hosted CI runner** — reconsider if GitHub-hosted build minutes run out or ARM-native builds are required.
- **Paid error-tracking (Sentry, etc.)** — add once traffic grows; stdout structured logging suffices for now.
- **Self-host PostgreSQL on the VPS** — fallback if Neon's free-tier limits (0.5 GB / cold-resume) become a problem.

</deferred>

## Provisioning Status (updated 2026-07-02)

External accounts for Wave 4 (plan 00-07). Waves 1–3 do NOT need these — they run against local Docker (PostgreSQL 17 + MinIO).

- ✅ **Neon** (prod PostgreSQL) — project created; pooled `DATABASE_URL` + direct `DATABASE_URL_DIRECT` obtained.
- ✅ **Cloudflare R2** — private bucket `saladee-uploads` created; `R2_ACCOUNT_ID` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` obtained.
- ✅ **LINE** — Messaging channel (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`) + Login channel (`LINE_LOGIN_CHANNEL_ID`, the idToken `aud`) created. Webhook URL not set yet (needs prod domain — Wave 4).
- ⏸ **Prod host + domain — DEFERRED (decision not made).** User not ready to commit. Candidates: GCP e2-micro Always Free (US region, keeps SSH-deploy plans intact) / Oracle Cloud Always Free ARM (Singapore, closer) / Hetzner CAX11 (~€3.79/mo, EU). Cloudflare Tunnel + own machine is a no-cloud fallback but would require adjusting plan 00-06's SSH-deploy model. Revisit before executing Wave 4 (00-07). Deploy plans (00-06) assume an Ubuntu VM reachable over SSH — all three cloud candidates satisfy that.

**Secret handling reminder:** keep the collected credentials in a password manager / secure note — do NOT commit them. They land in `api/.env` (gitignored, created in Wave 1 / plan 00-01) for local, and in GitHub Actions Secrets for prod.

---

*Phase: 0-Foundation & Platform*
*Context gathered: 2026-07-02*
