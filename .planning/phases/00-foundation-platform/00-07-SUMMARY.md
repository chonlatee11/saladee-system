# 00-07 SUMMARY — External provisioning + live verification (PARTIAL: cloud verified, VPS host deferred)

**Plan:** 00-07 (wave 4, `autonomous: false`)
**Status:** ⏸️ **Partially complete** — cloud services provisioned + live-verified; Hetzner VPS host and the two host-dependent criteria are **deferred** by operator decision ("provision cloud, defer VPS").
**Date:** 2026-07-02

## Decision context

Operator chose to provision and verify the cloud services now, and defer the always-on
Hetzner VPS host (matching the earlier "host deferred" note). This splits 00-07's four
success criteria into **verified-now** (do not need a public HTTPS host) and **deferred**
(require the VPS + public domain).

## What was provisioned (Task 1 — human action)

| Service | Provisioned | Notes |
|---------|-------------|-------|
| Neon PostgreSQL 17 | ✅ | Pooled `DATABASE_URL` (`-pooler`) + direct `DATABASE_URL_DIRECT` (unpooled). Region ap-southeast-1. |
| Cloudflare R2 | ✅ | **Private** bucket (`saladee-uploads`), Object Read/Write API token. No public access. |
| Cloudflare Pages | ✅ (project) | `saladee-web` project created for the web/ deploy (deploy run pending — depends on GitHub secrets). |
| LINE Messaging API channel | ✅ | `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN`. Webhook URL **not yet set** (needs the public API domain from the VPS). |
| LINE Login channel | ✅ | Separate channel, `LINE_LOGIN_CHANNEL_ID` (distinct aud, Research Q4). |
| Hetzner VPS | ⏸️ **deferred** | Host, DNS A record, Bun+Caddy+systemd install, `VPS_*` secrets — not done. |

Secrets are held in a local **git-ignored `api/.env`** (chmod-safe, never committed) for the
local smoke tests. GitHub Actions Secrets population + the LINE webhook URL are deferred with the VPS.

## Criteria verification (Task 2)

| Criterion | Result | How verified |
|-----------|--------|--------------|
| **2 — migrations apply on prod DB + readiness** | ✅ **VERIFIED (live)** | `bun run db:migrate` applied `0000_init` to **prod Neon** (DIRECT url); `bun run smoke:neon` confirmed `SELECT 1`, `users` table present, and `role` enum = owner/admin/grower/packer. |
| **3 — real R2 signed-URL round-trip** | ✅ **VERIFIED (live)** | `bun run smoke:r2`: presigned PUT upload → presigned GET download (bytes match, incl. Thai payload) against the **real private R2 bucket**; unsigned GET denied (HTTP 400 → bucket is private, Pitfall 4). Reuses the app's own `storage.presign*` helpers, so the production code path is proven. Test object cleaned up. |
| **1 — HTTPS `/health` 200 with valid cert** | ⏸️ **DEFERRED** | Requires the VPS + Caddy + public domain. Config (Caddyfile, systemd unit) is committed in 00-06 and ready. |
| **4 — live LINE echo + 401 on forgery** | ⏸️ **DEFERRED** | The webhook needs a public HTTPS URL (VPS). Signature-verify + echo logic is unit-tested green in 00-04 (HMAC over a Thai payload); only the *live* round-trip is deferred. |

## Verification tooling added (this plan)

- `api/scripts/r2-smoke.ts` (`bun run smoke:r2`) — real R2 round-trip + unsigned-denied.
- `api/scripts/neon-smoke.ts` (`bun run smoke:neon`) — prod Neon reachability + schema check.
- `api/package.json` — `smoke:r2` / `smoke:neon` scripts.

These reuse the application's real presign/env code, so a green run proves the production path
(not a throwaway harness).

## Deferred items (to close Phase 0 fully)

Carry forward — these are all VPS-host-dependent:

1. Provision Hetzner Ubuntu VPS; create DNS A record for the API domain.
2. Install Bun 1.3.14 + Caddy; deploy `deploy/saladee-api.service` (systemd); set the real domain in `Caddyfile`.
3. Populate GitHub Actions Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DATABASE_URL`, `DATABASE_URL_DIRECT`, all `R2_*`, all `LINE_*`, `JWT_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
4. Set the LINE Messaging webhook URL to `https://<api-domain>/webhook` and enable "Use webhook".
5. Trigger the deploy pipeline (00-06) and verify **Criterion 1** (HTTPS `/health` + `/health/ready` live) and **Criterion 4** (real LINE echo + forged-signature 401).
6. Deploy `web/` to Cloudflare Pages via `deploy-web.yml` (after `CLOUDFLARE_*` secrets).

Resume with `/gsd-execute-phase 0 --wave 4` (or continue 00-07 directly) once the VPS is ready.

## Self-Check: PARTIAL

- [x] Cloud services provisioned (Neon, R2 private bucket, Pages project, 2 LINE channels)
- [x] Criterion 2 verified live on prod Neon (migrate + schema)
- [x] Criterion 3 verified live on real R2 (signed-URL round-trip, unsigned denied)
- [ ] Criterion 1 (HTTPS live) — deferred with VPS
- [ ] Criterion 4 (live LINE echo) — deferred with VPS
- [x] No secrets committed (`api/.env` git-ignored; verified via `git check-ignore`)
