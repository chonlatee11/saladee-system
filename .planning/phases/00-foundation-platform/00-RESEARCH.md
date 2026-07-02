# Phase 0: Foundation & Platform - Research

**Researched:** 2026-07-02
**Domain:** Backend platform scaffolding — Bun/Elysia API, PostgreSQL/Drizzle, Cloudflare R2, LINE webhook, in-app RBAC, Caddy/systemd deploy, GitHub Actions CI
**Confidence:** HIGH (stack is locked in CLAUDE.md; research covers the HOW and version-specific pitfalls)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Database hosting**
- **D-01:** dev = Docker Postgres on the developer's own machine; prod = Neon free tier (managed PostgreSQL 17). Neon chosen for hands-off automatic backups + branching. Accept ~1s cold-resume on first query after idle.
- **D-02:** Supabase rejected (free tier pauses after ~1 week — dangerous for the LINE webhook; bundled Auth/Storage/Realtime unneeded). Self-host-on-VPS remains a valid fallback if Neon's 0.5 GB / cold-resume becomes limiting.

**Deploy & CI**
- **D-03:** GitHub Actions + SSH deploy to the VPS, migrations run as part of the deploy step, GitHub hosted runner (build → SSH → deploy).
- **D-04:** No self-hosted runner in Phase 0 (would compete with Postgres/API and add attack surface).
- **D-05:** GitHub over GitLab.

**LINE client wiring**
- **D-06:** Wire LINE end-to-end, not just client init: real `/webhook` endpoint that validates `x-line-signature` (via @line/bot-sdk) and echoes a reply. Reject invalid signatures.

**RBAC / Auth**
- **D-07:** Full role set scaffolded now: `owner`, `admin`, `grower`, `packer` (Phase 3 needs them). Bake into schema up front; enforcement added per-endpoint as features arrive.
- **D-08:** RBAC done in-app — NO Keycloak. Staff login = users table + hashed passwords (PLAT-03), `jose` for JWT sessions, server-side verification of LINE `idToken` for customers.

**Repo structure**
- **D-09:** Monorepo via Bun workspaces — `api/` (Elysia → VPS) and `web/` (Vue LIFF SPA → Cloudflare Pages), `package.json` workspace root. `web/` imports server types via Eden Treaty. GitHub Actions uses path filters to deploy each target independently. No shared `packages/` until a genuinely shared type appears.

**Secrets & config**
- **D-10:** Validate env at boot with TypeBox — missing required var (`DATABASE_URL`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, R2 creds, `JWT_SECRET`, …) → API refuses to boot with a clear message. No hardcoded secrets.
- **D-11:** Config sources: local `.env` (gitignored) + committed `.env.example`; prod secrets in GitHub Actions Secrets, injected onto the VPS at deploy (systemd `EnvironmentFile` or `chmod 600 .env`).

**Migration workflow**
- **D-12:** `drizzle-kit generate` → SQL migration files committed to `api/drizzle/`; `drizzle-kit migrate` runs during deploy (after code up, before service restart).
- **D-13:** Reversible migrations: drizzle-kit emits up-only, so write a matching down SQL by hand per migration and verify apply→rollback in dev (success criterion 2).

**Health & observability**
- **D-14:** Two endpoints: `/health` (liveness, 200 whenever process up); `/health/ready` (readiness, pings DB `SELECT 1` + confirms config loaded). Do NOT live-call LINE/R2 on every health check — only verify credentials loaded.
- **D-15:** Structured JSON logs to stdout (captured by systemd journal). No paid error-tracking in Phase 0.

### Claude's Discretion
- Exact directory layout within `api/` (routes/services/db modules).
- Password-hashing lib choice (argon2 vs bcrypt).
- Caddyfile specifics.
- Precise TypeBox env schema shape.

### Deferred Ideas (OUT OF SCOPE)
- Keycloak / external SSO.
- Self-hosted CI runner.
- Paid error-tracking (Sentry, etc.).
- Self-host PostgreSQL on the VPS (fallback only if Neon limits bite).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-02 | Single PostgreSQL + object storage for slips/photos at lowest cost (NFR-08) | Standard Stack (PG17 + Drizzle + postgres.js; R2 via Bun native S3, zero-egress free tier). Neon free tier for prod DB (D-01). R2 private bucket + presigned URLs pattern (Pitfall 4, Code Examples). |
| PLAT-05 | Mobile-first (LIFF first) + traffic-spike readiness (NFR-07, NFR-01) | Architecture: connection pooling via Neon `-pooler` endpoint for app queries; postgres.js pool sizing; Caddy front for TLS/keep-alive; structural choices in "NFR-01/07 Foundations" below. LIFF SPA lives in `web/` (Vite static → Cloudflare Pages CDN). |

**Note on scope:** PLAT-03 (password hashing, RBAC, private bucket + signed URL) is formally mapped to Phase 1, but CONTEXT decisions D-07/D-08 deliberately *scaffold* the RBAC schema, password hashing, and private-bucket signed-URL storage client in Phase 0 so later phases attach without an identity migration. Research therefore covers those mechanics as foundation scaffolding — enforcement per-endpoint is deferred.
</phase_requirements>

## Summary

This is a greenfield foundation phase with a fully locked stack (CLAUDE.md). Research value is almost entirely in the **HOW** and in four version-specific landmines that will silently break the build if the planner does not account for them:

1. **Elysia consumes the request body during parsing**, so the LINE `x-line-signature` HMAC (which must be computed over the *raw* bytes) cannot be recovered in a normal handler. This is the single biggest gotcha and must be designed for up front with a scoped `parse`/`onRequest` hook that captures the raw text before Elysia parses it.
2. **Neon runs PgBouncer in transaction mode.** The pooled connection string breaks prepared statements. drizzle-kit migrations MUST use Neon's **direct (unpooled)** connection string; the app's runtime queries should use the **pooled** endpoint with **postgres.js `prepare: false`**. Getting this backwards produces intermittent "prepared statement already exists" / "cached plan must not change result type" errors that only appear under concurrency — exactly during the NFR-01 traffic spikes.
3. **drizzle-kit generates up-only migrations.** There is no built-in `down`. Success criterion 2 ("roll back cleanly") therefore requires a hand-written down-SQL convention plus a tiny runner, since drizzle's own migrator cannot roll back.
4. **LINE ID tokens are signed with two different algorithms** — HS256 (channel secret) for web login and ES256 (remote JWKS) for LIFF/native. LIFF is Saladee's primary surface, so the jose verifier must handle **ES256 via `createRemoteJWKSet`**, not just HS256.

Everything else (Bun workspaces + Eden Treaty, TypeBox boot validation, Bun native S3 presign, Bun.password hashing, Caddy + systemd, GitHub Actions SSH deploy) is well-trodden and directly documented. Notably, **password hashing needs no dependency**: Bun ships `Bun.password.hash/verify` with Argon2id built in, which removes the argon2-vs-bcrypt native-binary-on-ARM question entirely.

**Primary recommendation:** Build the `api/` app around a small set of Elysia plugins (env, db, storage, line, auth) each of which fails fast at boot. Solve the LINE raw-body problem and the Neon dual-connection problem as *the first two tasks* — they shape module boundaries. Use `Bun.password` (no argon2/bcrypt dep) and jose with a remote JWKS for ES256 LINE tokens. Adopt a hand-written down-SQL migration convention from migration #1.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTPS termination + certs | Caddy (VPS reverse proxy) | — | LINE requires HTTPS for webhook + LIFF; Caddy auto-provisions Let's Encrypt. Bun should not terminate TLS itself. |
| Env/secret validation | API (Bun/Elysia boot) | GitHub Actions Secrets (source) | Fail-fast at process start (D-10); secrets *sourced* from CI/systemd EnvironmentFile at deploy. |
| LINE signature validation | API (`/webhook` route, raw body) | — | HMAC must be computed server-side over raw bytes before any parsing. |
| LINE ID-token verification | API (jose + remote JWKS) | LINE Platform (JWKS/verify endpoint) | Customer identity proven server-side; never trust a client-decoded token. |
| Staff auth / password hashing | API (`Bun.password` + users table) | — | In-app RBAC (D-08); no external identity server. |
| Session issuance | API (jose HS256 JWT) | — | Short-lived app session token minted after LINE/staff auth. |
| Atomic data / migrations | PostgreSQL (Neon prod / Docker dev) | drizzle-kit (tooling) | Relational ACID is the platform contract for later oversell prevention. |
| Object storage (slips/photos) | Cloudflare R2 (private bucket) | Bun native S3 client (SDK) | Private bucket + short-lived presigned URLs; zero-egress free tier (NFR-08). |
| Static LIFF UI hosting | Cloudflare Pages (CDN) | Vite build (tooling) | Mobile-first SPA served from edge; not the VPS (NFR-07/NFR-01). |
| Background jobs (later) | pg-boss on PostgreSQL | — | Not built in Phase 0, but DB choice must leave room (no serverless). |
| Process supervision | systemd (VPS) | — | Always-on, no cold starts; journald captures stdout JSON logs. |

## Standard Stack

All versions are locked in CLAUDE.md and re-verified against the npm registry on 2026-07-02.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.14 | Runtime + package manager + bundler + native S3/password/test | Locked. Ships `Bun.password` (Argon2id), native S3 client, workspaces, test runner — fewer deps. `[VERIFIED: local `bun --version` = 1.3.14]` |
| Elysia | 1.4.29 | HTTP API framework | Locked. Bun-first, TypeBox-native, Eden Treaty type export. `[VERIFIED: npm registry 1.4.29]` |
| PostgreSQL | 17.x | Primary database | Locked. ACID for future oversell prevention; Neon serves PG17. `[CITED: neon.com/docs]` |
| Drizzle ORM | 0.45.2 | Type-safe SQL + schema | Locked. SQL-first, explicit locking, runs clean on Bun/ARM (no query-engine binary). `[VERIFIED: npm registry 0.45.2]` |
| drizzle-kit | 0.31.10 | Migration generate/migrate | Locked. `generate` (SQL files) + `migrate` (apply). Up-only — see Pitfall 3. `[VERIFIED: npm registry 0.31.10]` |
| postgres (postgres.js) | 3.4.9 | PG driver | Locked. Pairs with Drizzle on Bun; supports `prepare: false` needed for Neon pooled. `[VERIFIED: npm registry 3.4.9]` |
| @line/bot-sdk | 11.0.2 (registry now 11.1.0) | LINE Messaging API SDK | Locked at 11.0.2; registry advanced to **11.1.0** (minor). `validateSignature` + client. `[VERIFIED: npm registry 11.1.0]` — see Open Questions Q1. |
| jose | 6.2.3 | JWT sign/verify + JWKS | Locked. Sign app session (HS256); verify LINE idToken (ES256 remote JWKS / HS256). Runs on Bun. `[VERIFIED: npm registry 6.2.3]` |
| TypeBox | bundled via Elysia (`@sinclair/typebox`) | Env + request schema/validation | Locked. One schema → runtime validation + types. Used for boot-time env validation (D-10). `[CITED: elysiajs.com]` |
| @elysiajs/eden | 1.4.9 | End-to-end typed client | Locked. `web/` imports `App` type from `api/` for compile-time-safe calls. `[VERIFIED: npm registry 1.4.9]` |
| Caddy | 2.x | Reverse proxy + auto HTTPS | Locked. Zero-config Let's Encrypt in front of Bun. Prod-only (not installed locally). `[CITED: caddyserver.com/docs]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vue | 3.5.39 | LIFF SPA UI | `web/` scaffold only in Phase 0 (a stub page that proves Eden Treaty types resolve + Cloudflare Pages deploy). Real UI = Phase 2. `[CITED: CLAUDE.md]` |
| Vite | 8.1.0 | `web/` build/dev | Static build → Cloudflare Pages. Needs Node/Bun 20+. `[CITED: CLAUDE.md]` |
| Biome | latest | Lint + format | Single fast tool; replaces ESLint+Prettier. Dev tool. `[CITED: CLAUDE.md]` |

**Password hashing — no dependency needed:** Use `Bun.password.hash()` / `Bun.password.verify()`. Default algorithm is **Argon2id**; bcrypt is also available via `{ algorithm: "bcrypt" }`. Params are self-encoded in the hash, so no metadata storage. This resolves the "argon2 vs bcrypt native binary on Bun/ARM" concern in Claude's Discretion — neither native package is required. `[CITED: bun.com/docs/guides/util/hash-a-password]`

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Bun.password` (Argon2id) | `argon2` / `bcrypt` npm | Native binaries; argon2 node-gyp builds are the classic Bun/ARM pain point. No reason to add them — Bun's built-in covers it. Only revisit if you need a param Bun doesn't expose. |
| postgres.js | `Bun.sql` native | CLAUDE.md standardizes on postgres.js + Drizzle (proven, portable). Keep. |
| Self-host PG on VPS | Neon free tier | Locked to Neon (D-01) for hands-off backups. Self-host is the documented fallback (D-02) if 0.5 GB / cold-resume bites. |

**Installation (api workspace):**
```bash
# root
bun init  # then configure workspaces in root package.json
# api/
bun add elysia @elysiajs/eden drizzle-orm postgres @line/bot-sdk jose
bun add -d drizzle-kit @biomejs/biome
# @sinclair/typebox comes transitively via elysia; add explicitly if importing directly:
bun add @sinclair/typebox
# web/
bun add vue @line/liff
bun add -d vite @vitejs/plugin-vue tailwindcss @tailwindcss/vite
```

**Version verification (run at plan time to confirm no drift):**
```bash
npm view elysia version              # expect 1.4.29+
npm view drizzle-orm version         # expect 0.45.2+
npm view drizzle-kit version         # expect 0.31.10+
npm view @line/bot-sdk version       # 11.1.0 as of 2026-07-02 (locked 11.0.2)
npm view jose version                # expect 6.2.3+
```

## Package Legitimacy Audit

> slopcheck was not installable in this session's sandbox. All packages below are nonetheless long-established, high-download, officially-documented libraries named in the project's locked CLAUDE.md stack, and each version was confirmed via `npm view` on the correct registry (npm) on 2026-07-02. Per protocol, packages not confirmed via Context7/official-docs-in-session are conservatively tagged; the planner should still keep an eye on any package it has not personally used.

| Package | Registry | Maturity | Source Repo | slopcheck | Disposition |
|---------|----------|----------|-------------|-----------|-------------|
| elysia | npm | Established, high-download | github.com/elysiajs/elysia | n/a (unavailable) | Approved — `[VERIFIED: npm registry 1.4.29]` + official docs elysiajs.com |
| @elysiajs/eden | npm | Elysia first-party | github.com/elysiajs/elysia | n/a | Approved — `[VERIFIED: npm registry 1.4.9]` |
| drizzle-orm | npm | Established | github.com/drizzle-team/drizzle-orm | n/a | Approved — `[VERIFIED: npm registry 0.45.2]` + orm.drizzle.team |
| drizzle-kit | npm | Drizzle first-party | github.com/drizzle-team/drizzle-orm | n/a | Approved — `[VERIFIED: npm registry 0.31.10]` |
| postgres | npm | Established (porsager) | github.com/porsager/postgres | n/a | Approved — `[VERIFIED: npm registry 3.4.9]` |
| @line/bot-sdk | npm | Official LINE SDK | github.com/line/line-bot-sdk-nodejs | n/a | Approved — `[VERIFIED: npm registry 11.1.0]`; locked 11.0.2 |
| jose | npm | Established (panva) | github.com/panva/jose | n/a | Approved — `[VERIFIED: npm registry 6.2.3]` |
| @sinclair/typebox | npm | Established | github.com/sinclairzx81/typebox | n/a | Approved — bundled via Elysia |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.
**Postinstall check:** none of the above are known to run network-touching postinstall scripts. Recommend the planner still run `npm view <pkg> scripts.postinstall` for any package it adds beyond this list.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────────┐
   LINE Platform         │                Hetzner VPS (always-on)         │
   (webhook events, ────►│  :443 ┌────────┐   proxy    ┌───────────────┐ │
    idToken issuer)      │  HTTPS│ Caddy  │──localhost─►│ Bun + Elysia  │ │
                         │       │ (TLS,  │  :3000/http │  API process  │ │
   LIFF SPA client ─────►│       │ LE cert)│            │ (systemd unit)│ │
   (@line/liff, ES256)   │       └────────┘            └──────┬────────┘ │
                         └───────────────────────────────────┼──────────┘
                                                              │
        env/secrets (systemd EnvironmentFile) ───────────────┤
                                                              │
   ┌──────────────── request flow inside API ────────────────┼──────────────┐
   │  onRequest → env plugin (boot-validated) → route:        │              │
   │                                                          ▼              │
   │  POST /webhook  ──[capture RAW body]──► validateSignature(x-line-sig)   │
   │        │ invalid → 401                    │ valid → parse JSON → echo   │
   │        │                                  └────────► LINE reply API ────┼──► LINE
   │  POST /auth/staff ─► Bun.password.verify ─► jose sign HS256 session     │
   │  POST /auth/line  ─► jose verify idToken (ES256 remote JWKS) ─► session │
   │  GET  /health         → 200 (liveness)                                  │
   │  GET  /health/ready   → SELECT 1 + config check → 200/503               │
   │  POST /files/presign  → Bun S3 .presign(PUT) ─────────┐                 │
   │  GET  /files/:k/url   → Bun S3 .presign(GET) ─────────┼──► Cloudflare R2 │
   └───────────────────────────────┬──────────────────────┼─────(private)───┘
                                    │                      │
                                    ▼                      ▼
                     ┌──────────────────────┐   ┌────────────────────┐
   drizzle-kit ─────►│ PostgreSQL           │   │ Cloudflare R2      │
   migrate (DIRECT   │  prod: Neon (pooled  │   │  private bucket    │
   unpooled conn)    │  -pooler for runtime,│   │  (slips/photos)    │
                     │  direct for migrate) │   └────────────────────┘
                     │  dev: Docker PG17    │
                     └──────────────────────┘

   web/ (Vue+Vite) ──build──► Cloudflare Pages (CDN, static)  ── imports App type via Eden Treaty ──► api/
   GitHub Actions: path-filter(api/) → SSH build+drizzle migrate+systemctl restart ; path-filter(web/) → deploy Pages
```

### Recommended Project Structure

Monorepo root with Bun workspaces (D-09). `web/` is a thin scaffold in Phase 0.

```
saladee-system/
├── package.json            # { "workspaces": ["api", "web"], "private": true }
├── .env.example            # committed template (D-11)
├── .gitignore              # .env, node_modules, dist
├── biome.json
├── Caddyfile               # prod reverse-proxy config (committed, deployed to VPS)
├── deploy/
│   └── saladee-api.service # systemd unit (committed)
├── .github/workflows/
│   ├── deploy-api.yml       # path filter: api/** → SSH deploy + migrate
│   └── deploy-web.yml       # path filter: web/** → Cloudflare Pages
├── api/
│   ├── package.json
│   ├── drizzle.config.ts    # uses DIRECT (unpooled) conn for migrations
│   ├── drizzle/
│   │   ├── 0000_init.sql            # up (drizzle-kit generate)
│   │   ├── 0000_init.down.sql       # hand-written down (D-13)
│   │   └── meta/                    # drizzle journal
│   ├── src/
│   │   ├── index.ts         # compose plugins, export `type App` for Eden
│   │   ├── env.ts           # TypeBox env schema + validate-at-boot (D-10)
│   │   ├── db/
│   │   │   ├── client.ts     # postgres.js (pooled, prepare:false for Neon) + drizzle
│   │   │   └── schema.ts     # users, roles (owner/admin/grower/packer)
│   │   ├── plugins/
│   │   │   ├── db.plugin.ts       # decorate ctx with db; used by /health/ready
│   │   │   ├── storage.plugin.ts  # Bun S3Client → R2, presign helpers
│   │   │   ├── line.plugin.ts     # @line/bot-sdk client from env
│   │   │   └── auth.plugin.ts     # jose sign/verify, requireRole guard
│   │   ├── routes/
│   │   │   ├── health.ts     # /health, /health/ready
│   │   │   ├── webhook.ts    # /webhook — RAW body + validateSignature + echo
│   │   │   ├── auth.ts       # /auth/staff, /auth/line
│   │   │   └── files.ts      # /files/presign, /files/:key/url
│   │   ├── lib/
│   │   │   ├── migrate-down.ts # tiny runner: apply latest *.down.sql
│   │   │   └── logger.ts       # structured JSON to stdout (D-15)
│   │   └── types.ts
│   └── tests/
│       ├── webhook.test.ts   # signature valid/invalid (Bun test)
│       ├── auth.test.ts      # hash/verify + jose round-trip
│       └── migrate.test.ts   # apply → down → apply (criterion 2)
└── web/
    ├── package.json
    ├── vite.config.ts
    └── src/main.ts           # LIFF init stub + one Eden Treaty call to /health
```

### Pattern 1: Boot-time env validation with TypeBox (fail-fast)
**What:** Parse `process.env` against a TypeBox schema at module load; throw (exit non-zero) before the server listens if any required var is missing/malformed.
**When to use:** Always — this is D-10, and it satisfies success criterion 1 ("no hardcoded secrets, config from env").
**Example:**
```typescript
// api/src/env.ts
// Source: elysiajs.com (TypeBox is Elysia's native validator) [CITED]
import { Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvSchema = t.Object({
  NODE_ENV: t.Union([t.Literal("development"), t.Literal("production"), t.Literal("test")]),
  PORT: t.String({ default: "3000" }),
  DATABASE_URL: t.String({ minLength: 1 }),        // runtime: Neon -pooler (prod) / docker (dev)
  DATABASE_URL_DIRECT: t.String({ minLength: 1 }), // migrations: Neon unpooled
  LINE_CHANNEL_SECRET: t.String({ minLength: 1 }),
  LINE_CHANNEL_ACCESS_TOKEN: t.String({ minLength: 1 }),
  LINE_LOGIN_CHANNEL_ID: t.String({ minLength: 1 }), // aud for idToken verify
  JWT_SECRET: t.String({ minLength: 32 }),
  R2_ACCOUNT_ID: t.String({ minLength: 1 }),
  R2_ACCESS_KEY_ID: t.String({ minLength: 1 }),
  R2_SECRET_ACCESS_KEY: t.String({ minLength: 1 }),
  R2_BUCKET: t.String({ minLength: 1 }),
});

// Value.Check + Value.Errors gives a precise "which var is wrong" message.
const parsed = { ...process.env };
if (!Value.Check(EnvSchema, parsed)) {
  const errs = [...Value.Errors(EnvSchema, parsed)].map((e) => `${e.path}: ${e.message}`);
  console.error(JSON.stringify({ level: "fatal", msg: "invalid env", errors: errs }));
  process.exit(1);
}
export const env = Value.Cast(EnvSchema, parsed);
```

### Pattern 2: Elysia plugin per external client, decorated onto context
**What:** Each integration (db, storage, line, auth) is a small Elysia plugin using `.decorate()` so routes get a typed, already-constructed client. Plugins read from the validated `env`, so a missing credential already failed at boot.
**When to use:** Structures the app so Phase 1+ features attach without rework (CONTEXT integration-points note).
**Example:**
```typescript
// api/src/plugins/storage.plugin.ts
// Source: bun.com/docs/runtime/s3 [CITED]
import { Elysia } from "elysia";
import { S3Client } from "bun";
import { env } from "../env";

const s3 = new S3Client({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
});

export const storagePlugin = new Elysia({ name: "storage" }).decorate("storage", {
  presignPut: (key: string, ttl = 300) =>
    s3.presign(key, { method: "PUT", expiresIn: ttl }),
  presignGet: (key: string, ttl = 300) =>
    s3.presign(key, { method: "GET", expiresIn: ttl }),
});
```

### Pattern 3: Eden Treaty type-sharing across the workspace
**What:** `api/src/index.ts` exports `export type App = typeof app`. `web/` imports that type and constructs a `treaty<App>()` client — an API change becomes a compile error in `web/`.
**When to use:** D-09. In Phase 0, just prove it works: one typed call to `/health` from `web/src/main.ts`.
**Example:**
```typescript
// api/src/index.ts
const app = new Elysia().use(healthRoutes).use(webhookRoutes)/*...*/.listen(env.PORT);
export type App = typeof app;         // consumed by web/

// web/src/main.ts
// Source: elysiajs.com Eden Treaty [CITED]
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";
const api = treaty<App>(import.meta.env.VITE_API_URL);
const { data } = await api.health.get();  // fully typed
```

### Anti-Patterns to Avoid
- **Reading the LINE webhook body via `ctx.body`** and re-serializing to check the signature — re-serialization changes bytes → signature mismatch. Capture raw bytes (Pitfall 1).
- **Using one Neon connection string for both migrations and runtime** — migrations need the direct/unpooled endpoint; runtime needs pooled + `prepare:false` (Pitfall 2).
- **Live-calling LINE/R2 in `/health/ready`** — D-14 explicitly forbids it; only verify credentials loaded + `SELECT 1`.
- **Terminating TLS in Bun** — Caddy owns HTTPS; Bun listens on plain localhost:3000.
- **Committing `.env`** — only `.env.example` is committed (D-11).
- **Relying on drizzle-kit to roll back** — it cannot; you need hand-written down SQL (Pitfall 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom PBKDF2/salt code | `Bun.password.hash/verify` (Argon2id) | Built into Bun; params self-encoded; constant-time verify. `[CITED: bun.com]` |
| LINE signature check | Manual HMAC-SHA256 base64 | `@line/bot-sdk` `validateSignature()` | Official, constant-time compare; you still supply raw body. `[CITED: developers.line.biz]` |
| JWT sign/verify + JWKS | Custom base64url + crypto | `jose` (`SignJWT`, `jwtVerify`, `createRemoteJWKSet`) | Handles ES256 remote keys + HS256; audited. `[CITED: github.com/panva/jose]` |
| Presigned S3/R2 URLs | Manual SigV4 signing | `Bun` `S3Client.presign()` | Native, no AWS SDK; synchronous, no network call. `[CITED: bun.com/docs/runtime/s3]` |
| TLS certs / renewal | Certbot cron scripting | Caddy automatic HTTPS | Zero-config Let's Encrypt provision + renewal. `[CITED: caddyserver.com]` |
| Env validation | Ad-hoc `if (!process.env.X)` | TypeBox schema + `Value.Check`/`Value.Errors` | One schema → types + precise error listing. `[CITED: elysiajs.com]` |
| SQL migrations | Custom migration table | `drizzle-kit generate` + `migrate` | Standard; only the *down* side is hand-written (Pitfall 3). `[CITED: orm.drizzle.team]` |

**Key insight:** In this stack the runtime (Bun) already provides password hashing and S3 presigning natively, and the framework (Elysia) provides validation via TypeBox. The only genuinely hand-written piece is **down-migrations**, because drizzle-kit deliberately doesn't emit them.

## Common Pitfalls

### Pitfall 1: Elysia consumes the request body → LINE signature fails
**What goes wrong:** `x-line-signature` is an HMAC-SHA256 over the exact raw request bytes. Elysia parses `body` in its lifecycle, consuming the stream; a later handler can only see the parsed object, and re-`JSON.stringify`-ing it produces different bytes → every signature check fails (or worse, you disable the check).
**Why it happens:** Elysia's parse phase reads the body stream; by the time a handler or `beforeHandle` runs, the raw stream is gone. (Documented in elysiajs/elysia issue #1511.)
**How to avoid:** Capture the raw text *before* parse, scoped to the webhook route. Two viable approaches:
- A route-scoped `parse` hook that reads `request.text()` (or `request.arrayBuffer()`), validates the signature, then returns the parsed JSON so the handler still gets a typed body; or
- An `onRequest`/`parse` that stores the raw string on `store`/context, then validate in the handler.
```typescript
// api/src/routes/webhook.ts
// Source: developers.line.biz/verify-webhook-signature + elysiajs issue #1511 [CITED]
import { Elysia } from "elysia";
import { validateSignature, messagingApi } from "@line/bot-sdk";
import { env } from "../env";

const client = new messagingApi.MessagingApiClient({ channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN });

export const webhookRoutes = new Elysia().post(
  "/webhook",
  async ({ request, set }) => {
    const raw = await request.text();                        // RAW bytes, before JSON.parse
    const sig = request.headers.get("x-line-signature") ?? "";
    if (!validateSignature(raw, env.LINE_CHANNEL_SECRET, sig)) {
      set.status = 401;
      return "invalid signature";
    }
    const body = JSON.parse(raw);
    for (const ev of body.events ?? []) {
      if (ev.type === "message" && ev.message?.type === "text") {
        await client.replyMessage({ replyToken: ev.replyToken, messages: [{ type: "text", text: ev.message.text }] });
      }
    }
    return "ok";
  },
  // Do NOT attach a TypeBox body schema here that forces Elysia to parse first;
  // read request.text() manually so the raw bytes survive for HMAC.
);
```
**Warning signs:** Signature check passes in unit tests (where you control bytes) but fails against real LINE traffic; intermittent failures when body contains non-ASCII (Thai) characters.

### Pitfall 2: Neon PgBouncer transaction mode breaks prepared statements
**What goes wrong:** Neon's default pooled endpoint (`...-pooler...`) runs PgBouncer in transaction mode, which discards prepared statements between transactions. postgres.js prepares statements by default → "prepared statement s1 already exists" / "cached plan must not change result type" errors, appearing only under concurrency (i.e., exactly during NFR-01 spikes). drizzle-kit migrations against the pooled endpoint also fail.
**Why it happens:** Transaction-mode pooling ≠ session-mode; prepared-statement session state is not preserved.
**How to avoid:** Two connection strings, two uses:
- **Runtime (app):** Neon **pooled** endpoint + postgres.js `prepare: false`.
- **Migrations (drizzle-kit):** Neon **direct/unpooled** endpoint (no `-pooler` in host).
- Dev (Docker PG): plain local connection; `prepare: false` is harmless, so you can use the same client config in both environments.
```typescript
// api/src/db/client.ts
// Source: neon.com/docs/connect/choose-connection + orm.drizzle.team/docs/connect-neon [CITED]
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../env";
import * as schema from "./schema";

// prepare:false is REQUIRED against Neon's pooled (PgBouncer transaction-mode) endpoint.
const sql = postgres(env.DATABASE_URL, { prepare: false, max: 10 });
export const db = drizzle(sql, { schema });
```
```typescript
// api/drizzle.config.ts — migrations use the DIRECT (unpooled) URL
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! }, // unpooled
});
```
**Warning signs:** Works locally (Docker, no PgBouncer) but throws prepared-statement errors on Neon under load; migrations hang or error only against prod.

### Pitfall 3: drizzle-kit has no down migration (blocks success criterion 2)
**What goes wrong:** `drizzle-kit generate` emits only forward SQL. There is no `drizzle-kit down`/rollback. Success criterion 2 requires "apply and roll back cleanly" — drizzle can't do the rollback half.
**Why it happens:** By design; the Drizzle team recommends forward-only + new reversing migrations for prod.
**How to avoid:** Adopt a convention from migration #0000: for each `NNNN_name.sql`, hand-write `NNNN_name.down.sql` with the exact reverse DDL, and write a tiny runner that executes the latest down file. Verify apply→down→apply in a Bun test (criterion 2 is small in Phase 0: just the users/roles tables).
```typescript
// api/src/lib/migrate-down.ts
// Source: drizzle-team discussion #1339 (no built-in down) [CITED]
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false });
const file = process.argv[2];                    // e.g. drizzle/0000_init.down.sql
await sql.file(file);
await sql.end();
```
```jsonc
// api/package.json scripts
{
  "db:generate": "drizzle-kit generate",
  "db:migrate":  "drizzle-kit migrate",
  "db:down":     "bun run src/lib/migrate-down.ts"
}
```
**Warning signs:** Planner assumes `drizzle-kit migrate` can roll back; verification for criterion 2 has no down path to test.

### Pitfall 4: R2 must be a private bucket + short-lived presigned URLs (not public-read)
**What goes wrong:** PLAT-03 requires slips/customer data accessible only to the authorized. Using `acl: "public-read"` presigns (from generic S3 tutorials) or a public R2 bucket leaks slips.
**Why it happens:** Many S3 presign examples default to public-read for convenience.
**How to avoid:** Keep the R2 bucket private (no public access, no custom public domain). Serve every object via a short-TTL presigned GET (e.g. 300s) minted only after an auth/role check. Upload via presigned PUT, also short-TTL. Do not set a public ACL.
```typescript
// Source: developers.cloudflare.com/r2/api/s3/presigned-urls + bun.com/docs/runtime/s3 [CITED]
const putUrl = storage.presignPut(`slips/${orderId}/${crypto.randomUUID()}.jpg`, 300);
const getUrl = storage.presignGet(key, 300); // only after requireRole/owner check
```
**Warning signs:** Object URLs work without a signature; presigned URLs with multi-hour TTLs; bucket has a public dev URL enabled.
**Note:** Bun issue #25750 reports `response-content-disposition` is ignored for GET presigns on some S3-compatibles — not blocking for Phase 0 (we only need working upload/download), but relevant later if forcing download filenames.

### Pitfall 5: LINE idToken from LIFF is ES256, not HS256
**What goes wrong:** A jose verifier written only for HS256 (channel secret) rejects LIFF-issued tokens, which are **ES256** signed and verified against LINE's remote JWKS. LIFF is Saladee's primary surface, so an HS256-only verifier fails for real customers.
**Why it happens:** LINE uses HS256 for web login but **ES256 for LIFF/native/SDK**; the ES256 public key comes from `https://api.line.me/oauth2/v2.1/certs` (selected by `kid`).
**How to avoid:** Verify with jose `createRemoteJWKSet` (ES256) and validate `iss=https://access.line.me`, `aud=<LINE_LOGIN_CHANNEL_ID>`, `exp`, and `nonce`. (LINE also offers a server endpoint `POST https://api.line.me/oauth2/v2.1/verify` as an alternative, but CONTEXT D-08 chose jose.)
```typescript
// api/src/plugins/auth.plugin.ts (idToken verify)
// Source: developers.line.biz/verify-id-token + github.com/panva/jose [CITED]
import { jwtVerify, createRemoteJWKSet } from "jose";
import { env } from "../env";
const LINE_JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));
export async function verifyLineIdToken(idToken: string) {
  const { payload } = await jwtVerify(idToken, LINE_JWKS, {
    issuer: "https://access.line.me",
    audience: env.LINE_LOGIN_CHANNEL_ID,
    algorithms: ["ES256"],           // LIFF; add "HS256" only if you also support web-login tokens
  });
  return payload;                    // sub = LINE userId
}
```
**Warning signs:** idToken verify works in a curl test with a web-login token but fails from inside the LIFF app; "unsupported algorithm" or signature errors.

### Pitfall 6: Bun native S3 config against R2 needs the account-scoped endpoint
**What goes wrong:** Omitting `endpoint` (or using a bucket-scoped URL) makes Bun's S3 client target AWS, not R2.
**How to avoid:** Set `endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and pass R2 access key/secret from env. R2 ignores/needs a region set to `auto` in some clients; Bun's client works with the endpoint alone. Verify with a real upload/download round-trip in a test (criterion 3).
**Warning signs:** `NoSuchBucket`/403 from AWS domains; presigned URLs pointing at `s3.amazonaws.com`.

## Code Examples

### Health endpoints (D-14)
```typescript
// api/src/routes/health.ts
import { Elysia } from "elysia";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

export const healthRoutes = new Elysia()
  .get("/health", () => ({ status: "ok" }))                 // liveness: process up
  .get("/health/ready", async ({ set }) => {
    try {
      await db.execute(sql`SELECT 1`);                       // readiness: DB reachable
      return { status: "ready" };                            // config already validated at boot
    } catch {
      set.status = 503;
      return { status: "unavailable" };
    }
  });
```

### Staff auth: hash on create, verify on login, mint jose session
```typescript
// Source: bun.com/docs (Bun.password) + github.com/panva/jose [CITED]
import { SignJWT } from "jose";
import { env } from "../env";

const key = new TextEncoder().encode(env.JWT_SECRET);

export async function hashPassword(pw: string) {
  return Bun.password.hash(pw);                    // Argon2id, params self-encoded
}
export async function verifyPassword(pw: string, hash: string) {
  return Bun.password.verify(pw, hash);
}
export async function issueSession(userId: string, role: string) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("2h")
    .sign(key);
}
```

### RBAC schema scaffold (D-07: owner/admin/grower/packer)
```typescript
// api/src/db/schema.ts
// Source: orm.drizzle.team pg-core [CITED]
import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "admin", "grower", "packer"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),   // Bun.password Argon2id output
    role: roleEnum("role").notNull().default("packer"),
    lineUserId: text("line_user_id"),                // set when a staff member links LINE
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }),
);
```

### Caddyfile (prod, in front of Bun)
```
# Caddyfile — Source: caddyserver.com/docs/caddyfile/directives/reverse_proxy [CITED]
api.saladee.example {
    reverse_proxy localhost:3000
    encode gzip zstd
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
    }
}
```

### systemd unit (prod, supervises the Bun process; injects secrets — D-11)
```ini
# deploy/saladee-api.service
[Unit]
Description=Saladee API (Bun/Elysia)
After=network.target

[Service]
Type=simple
User=saladee
WorkingDirectory=/opt/saladee/api
EnvironmentFile=/opt/saladee/api/.env      # chmod 600, written at deploy from GH Secrets
ExecStart=/home/saladee/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=2
StandardOutput=journal                      # JSON logs → journald (D-15)
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### GitHub Actions: build → SSH deploy → migrate → restart (path-filtered, D-03/D-12)
```yaml
# .github/workflows/deploy-api.yml
name: Deploy API
on:
  push:
    branches: [main]
    paths: ["api/**", ".github/workflows/deploy-api.yml"]   # path filter (D-09)
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - run: bun install --frozen-lockfile
      - run: bun test                                        # gate on tests
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/saladee && git pull --ff-only
            cd api && bun install --frozen-lockfile
            DATABASE_URL_DIRECT='${{ secrets.DATABASE_URL_DIRECT }}' bun run db:migrate
            sudo systemctl restart saladee-api
```
> Verify `oven-sh/setup-bun` and `appleboy/ssh-action` action versions at plan time (Open Questions Q2). The `db:migrate` step uses the **direct** Neon URL (Pitfall 2).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| argon2/bcrypt npm (native node-gyp) | `Bun.password` built-in (Argon2id) | Bun ≥0.6.8 | No native binary; removes Bun/ARM build pain — no dependency at all. |
| AWS SDK v3 `@aws-sdk/s3-request-presigner` | `Bun` `S3Client.presign()` native | Bun 1.1+ | No AWS SDK dependency; synchronous presign. |
| Certbot + cron for TLS | Caddy automatic HTTPS | mature | Zero-config cert provision/renew. |
| body-parser + manual HMAC | Raw-body capture + `@line/bot-sdk` `validateSignature` | current | Framework-specific raw-body handling still required (Pitfall 1). |
| Single Postgres conn string | Neon dual (pooled runtime + direct migrate) | Neon PgBouncer | Prevents prepared-statement failures under load (Pitfall 2). |

**Deprecated/outdated:**
- Prisma (CLAUDE.md "What NOT to Use") — heavy query-engine binary, weak `FOR UPDATE` control on Bun/ARM. Use Drizzle.
- Serverless free tiers (Fly/Railway/Render free) — cold starts break the webhook + future reservation timer. Use always-on VPS.
- `@line/bot-sdk` pre-v11 API surface — v11+ uses `messagingApi.MessagingApiClient`; use the v11 surface.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bun `S3Client.presign(key, { method, expiresIn })` signature is current in Bun 1.3.14 | Pattern 2 / Pitfall 4/6 | LOW — documented at bun.com/docs/runtime/s3; verify exact arg shape (`presign(key, opts)` vs `file(key).presign(opts)`) against installed Bun before coding. |
| A2 | A route-scoped manual `request.text()` reliably yields raw bytes before Elysia parses in 1.4.29 | Pitfall 1 | MEDIUM — behavior confirmed via issue #1511 discussion, not tested in-session on 1.4.29. Verify with a signature round-trip test (Thai/non-ASCII payload) early. |
| A3 | postgres.js `prepare: false` fully resolves Neon PgBouncer transaction-mode prepared-statement errors | Pitfall 2 | LOW-MEDIUM — widely reported fix; confirm under a small concurrency test against a real Neon instance. |
| A4 | LIFF idTokens are ES256 and verifiable via LINE's remote JWKS with jose | Pitfall 5 | LOW — CITED from developers.line.biz; confirm `kid`/alg on a real LIFF token during Phase 0 wiring. |
| A5 | `@line/bot-sdk` 11.0.2 (locked) vs 11.1.0 (registry) API is source-compatible for `validateSignature` + `MessagingApiClient` | Standard Stack | LOW — minor bump; pin one version in the lockfile and read its changelog. |
| A6 | `Bun.password` Argon2id defaults are acceptable for PLAT-03 without tuning | Don't Hand-Roll | LOW — defaults are secure; revisit params only if login latency matters. |
| A7 | Hetzner VPS + Neon + R2 + LINE OA accounts/credentials will be provisioned by the user | Environment Availability | HIGH impact if absent — these are external accounts the planner must sequence as human-setup tasks; none can be probed from the dev box. |

## Open Questions

1. **Pin @line/bot-sdk at 11.0.2 (CLAUDE.md) or bump to 11.1.0 (current registry)?**
   - What we know: 11.1.0 is a minor release; CLAUDE.md locks 11.0.2.
   - What's unclear: whether 11.1.0 changes anything used here.
   - Recommendation: pin 11.0.2 to honor the lock, or bump with a one-line note to CLAUDE.md after reading the 11.1.0 changelog. Either is low-risk; do not float the version.

2. **Exact GitHub Action versions for Bun setup + SSH deploy.**
   - What we know: `oven-sh/setup-bun` and `appleboy/ssh-action` are the conventional choices.
   - What's unclear: current major versions and whether the user prefers `rsync` over `git pull` on the VPS.
   - Recommendation: verify action versions at plan time; keep the deploy script minimal (git pull + bun install + migrate + restart).

3. **Where does the VPS get code — `git pull` on the box or artifact push?**
   - Recommendation: `git pull --ff-only` on the VPS is simplest for a solo dev and keeps CI credentials minimal (SSH only). Revisit if build must happen off-box.

4. **Does Phase 0 provision the LINE Messaging channel AND a separate LINE Login channel?**
   - What we know: webhook uses Messaging API (channel secret + access token); idToken verify uses the LINE **Login** channel ID as `aud`.
   - Recommendation: the planner should include a human-setup task to create/confirm both channels and capture `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, and `LINE_LOGIN_CHANNEL_ID`.

## Environment Availability

| Dependency | Required By | Available (local) | Version | Fallback |
|------------|-------------|-------------------|---------|----------|
| Bun | API runtime/build/test | ✓ | 1.3.14 (exact match) | — |
| Docker | Dev PostgreSQL (D-01) | ✓ | 28.1.1 | — |
| Node | Vite build tooling | ✓ | v24.10.0 | Bun can run Vite too |
| git | CI + VPS pull deploy | ✓ | 2.43.0 | — |
| gh CLI | Repo/secret management | ✓ | 2.45.0 | GitHub web UI |
| psql | Manual DB inspection | ✗ | — | Bun scripts / Docker `exec`; not required for migrations (drizzle-kit) |
| Caddy | Prod TLS reverse proxy | ✗ (prod-only) | — | Installed on the VPS at deploy, not the dev box |

**External accounts/services (cannot be probed locally — planner must sequence as human-setup tasks):**
- Neon project (prod PG17) → `DATABASE_URL` (pooled) + `DATABASE_URL_DIRECT` (unpooled).
- Cloudflare R2 private bucket + API token → `R2_*` vars; Cloudflare Pages project for `web/`.
- LINE Messaging API channel → `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`; LINE Login channel → `LINE_LOGIN_CHANNEL_ID`.
- Hetzner VPS (Ubuntu) with a DNS A record → SSH secrets for CI; Caddy + systemd installed on it.

**Missing dependencies with no fallback:** none locally. All local dev tools are present.
**Missing dependencies with fallback:** psql (use Docker exec / Bun scripts); Caddy (prod-only, install on VPS).

## Validation Architecture

> nyquist_validation is enabled (config `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (built-in, no dependency) |
| Config file | none — Bun test needs no config; place tests in `api/tests/*.test.ts` |
| Quick run command | `cd api && bun test` |
| Full suite command | `bun test` (root, runs all workspace tests) |

### Phase Requirements → Test Map
| Req / Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------------|----------|-----------|-------------------|-------------|
| Criterion 1 | Boot fails with clear error on missing env var | unit | `cd api && bun test tests/env.test.ts` | ❌ Wave 0 |
| Criterion 1 | `/health` returns 200 | integration | `cd api && bun test tests/health.test.ts` | ❌ Wave 0 |
| Criterion 2 | migrate up → down → up applies cleanly | integration (Docker PG) | `cd api && bun test tests/migrate.test.ts` | ❌ Wave 0 |
| Criterion 3 | presigned PUT upload then GET download round-trips | integration (R2 or S3-compat) | `cd api && bun test tests/storage.test.ts` | ❌ Wave 0 |
| Criterion 4 / D-06 | valid signature → echo; invalid → 401 | unit | `cd api && bun test tests/webhook.test.ts` | ❌ Wave 0 |
| D-08 / PLAT-03 | hash→verify round-trip; jose sign→verify; LINE idToken verify | unit | `cd api && bun test tests/auth.test.ts` | ❌ Wave 0 |
| `/health/ready` | returns 503 when DB down, 200 when up | integration | `cd api && bun test tests/health.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd api && bun test <the-file-you-touched>`
- **Per wave merge:** `bun test` (full API suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `api/tests/env.test.ts` — boot validation (Criterion 1)
- [ ] `api/tests/health.test.ts` — liveness + readiness (Criterion 1)
- [ ] `api/tests/migrate.test.ts` — up/down/up against Docker PG (Criterion 2)
- [ ] `api/tests/storage.test.ts` — R2 presign round-trip (Criterion 3)
- [ ] `api/tests/webhook.test.ts` — signature valid/invalid + echo (Criterion 4)
- [ ] `api/tests/auth.test.ts` — Bun.password + jose + LINE idToken (D-08)
- [ ] Docker Compose (or a test helper) to spin an ephemeral PG17 for migrate/health/ready tests
- [ ] Framework install: none — Bun test is built-in.

## Security Domain

> `security_enforcement` is not set to `false` in config → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `Bun.password` (Argon2id) for staff; jose ES256 verify of LINE idToken for customers; short-lived HS256 session JWT. |
| V3 Session Management | yes | jose JWT with `exp` (2h), signed with `JWT_SECRET` (≥32 bytes, from env). No session in localStorage on a public page beyond LIFF norms. |
| V4 Access Control | yes (scaffold) | `role` enum (owner/admin/grower/packer); `requireRole` guard plugin. Enforcement per-endpoint as features arrive (D-07). |
| V5 Input Validation | yes | TypeBox schemas on every endpoint (Elysia-native) + boot-time env validation. |
| V6 Cryptography | yes | Never hand-roll: `Bun.password`, jose, `validateSignature` (constant-time), Caddy TLS. `JWT_SECRET`/secrets only from env. |
| V7 Error/Logging | yes | Structured JSON logs to stdout (D-15); never log secrets, raw slips, or full tokens. |
| V8 Data Protection | yes | R2 **private** bucket + short-TTL presigned URLs (Pitfall 4); slips never public. Aligns with PLAT-03/PDPA groundwork. |
| V12 Files/Resources | yes | Upload only via presigned PUT with constrained key prefixes; validate content-type/size before issuing presign. |
| V13 API/Webhook | yes | `x-line-signature` HMAC validation on `/webhook`; reject invalid (D-06). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged LINE webhook / replayed events | Spoofing | `validateSignature` over raw body; reject on mismatch (Pitfall 1/D-06). |
| Forged/tampered LINE idToken | Spoofing/Tampering | jose verify (ES256 remote JWKS) + `iss`/`aud`/`exp`/`nonce` checks (Pitfall 5). |
| Secret leakage via commit or logs | Information Disclosure | `.env` gitignored, `.env.example` only; boot-validate presence not value; never log secrets (D-10/D-11/D-15). |
| Public/over-broad object access | Information Disclosure | Private R2 bucket + short-TTL presigned URLs gated by role (Pitfall 4). |
| SQL injection (later query surfaces) | Tampering | Drizzle parameterized queries; never string-concat SQL. |
| Credential stuffing on staff login | Spoofing | Argon2id hashing; add rate limiting when login UI ships (note for Phase 1). |
| TLS downgrade / MITM | Tampering/Info Disclosure | Caddy auto-HTTPS + HSTS header; Bun listens localhost-only behind Caddy. |
| Prepared-statement error surface under load (availability, not attack) | DoS-adjacent | postgres.js `prepare:false` on Neon pooled (Pitfall 2) — prevents cascading 500s during spikes (NFR-01). |

## Sources

### Primary (HIGH confidence)
- bun.com/docs/runtime/s3 + bun.com/reference/bun/S3Client/presign — native S3 `presign(key, { method, expiresIn })`, R2 endpoint config.
- bun.com/docs/guides/util/hash-a-password + bun.com/reference/bun/password — `Bun.password` Argon2id/bcrypt, self-encoded params.
- developers.line.biz/en/docs/messaging-api/verify-webhook-signature/ — x-line-signature HMAC over raw body.
- developers.line.biz/en/docs/line-login/verify-id-token/ — HS256 (web) vs ES256 (LIFF/native), JWKS at `/oauth2/v2.1/certs`, iss/aud/exp/nonce claims.
- neon.com/docs/connect/choose-connection + neon.com/docs/guides/drizzle-migrations + neon.com/docs/connect/connection-pooling — pooled (`-pooler`) vs direct; migrations use direct.
- orm.drizzle.team/docs/connect-neon + orm.drizzle.team/docs/migrations + drizzle-kit-migrate — connection + migration workflow.
- github.com/drizzle-team/drizzle-orm/discussions/1339 — no built-in down/rollback; hand-written reverse migrations.
- caddyserver.com/docs/quick-starts/reverse-proxy + /caddyfile/directives/reverse_proxy — auto-HTTPS reverse proxy, systemd.
- github.com/panva/jose — `SignJWT`, `jwtVerify`, `createRemoteJWKSet`; runs on Bun.
- elysiajs.com (life-cycle, cheat-sheet) — plugins, TypeBox validation, Eden Treaty.
- npm registry (`npm view`) 2026-07-02 — elysia 1.4.29, @elysiajs/eden 1.4.9, drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, @line/bot-sdk 11.1.0, jose 6.2.3; local `bun --version` 1.3.14.

### Secondary (MEDIUM confidence)
- github.com/elysiajs/elysia issue #1511 — request body consumed during parse; raw body inaccessible in later hooks (drives Pitfall 1).
- seedfa.st / crunchydata / planetscale (2026) — PgBouncer transaction-mode prepared-statement failures; `prepare:false` fix (corroborates Pitfall 2).
- encore.dev Neon 2026 guide — Neon serverless TS patterns.

### Tertiary (LOW confidence)
- github.com/oven-sh/bun issue #25750 — presign ignores `response-content-disposition` on some S3-compatibles (noted, not blocking Phase 0).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked in CLAUDE.md, all versions re-verified on npm 2026-07-02; Bun 1.3.14 confirmed locally.
- Architecture / patterns: HIGH — plugin structure + Eden Treaty + Caddy/systemd are directly documented.
- Pitfalls: HIGH for Neon dual-connection, drizzle down, LINE ES256, R2 private bucket (all CITED); MEDIUM for exact Elysia 1.4.29 raw-body mechanism (verify with a round-trip test early — A2).

**Research date:** 2026-07-02
**Valid until:** ~2026-08-01 (stable stack; re-verify @line/bot-sdk and GitHub Action versions at plan time; re-check Bun S3 presign arg shape against the installed Bun).
