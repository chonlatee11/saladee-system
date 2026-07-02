---
phase: 00-foundation-platform
plan: 03
subsystem: infra
tags: [object-storage, cloudflare-r2, bun-s3, presigned-url, minio, elysia, s3-compatible]

# Dependency graph
requires:
  - phase: 00-01
    provides: env schema (R2_* vars), storagePlugin/filesRoutes stubs, index.ts composition, logger
provides:
  - Bun-native S3Client wired to a private Cloudflare R2 bucket (account-scoped endpoint)
  - storage.presignPut / storage.presignGet helpers (short TTL, default 300s)
  - POST /files/presign (PUT) and GET /files/:key/url (GET) endpoints
  - isSafeKey key-validation guard (rejects traversal/absolute/empty keys)
  - Automated presigned PUT->GET round-trip proof against MinIO (Criterion 3)
  - R2_ENDPOINT seam so any S3-compatible server can stand in for R2 on the same code path
affects: [phase-2-slips, phase-2-photos, payments, 00-07-r2-validation, pdpa]

# Tech tracking
tech-stack:
  added: [MinIO (test-only S3-compatible server via Docker Compose)]
  patterns:
    - "Bun S3Client.presign(key, { method, expiresIn }) — native SigV4, no AWS SDK (A1 verified on Bun 1.3.14)"
    - "Private bucket + short-TTL presigned URLs only (no public-read ACL)"
    - "Optional endpoint override (R2_ENDPOINT) to test prod S3 code path against MinIO in CI"
    - "Untrusted key validation before signing (reject .., leading /, backslash, empty)"

key-files:
  created:
    - api/tests/docker-compose.minio.yml
    - api/tests/storage.test.ts
  modified:
    - api/src/plugins/storage.plugin.ts
    - api/src/routes/files.ts

key-decisions:
  - "Verified Bun 1.3.14 presign arg shape s3.presign(key, { method, expiresIn }) before coding (A1 resolved)"
  - "Added an optional R2_ENDPOINT override (read from process.env) so MinIO exercises the exact prod signing path; prod default stays the account-scoped R2 endpoint"
  - "Key policy centralized in isSafeKey (schema is t.String()) so all invalid keys return a consistent 400"
  - "Round-trip test uses a flat (single-segment) key to satisfy GET /files/:key/url; PUT accepts nested keys via the JSON body"

patterns-established:
  - "Pattern: external client as a named Elysia plugin decorated onto context (storagePlugin name 'storage')"
  - "Pattern: S3-compatible test double (MinIO) in an ephemeral compose file, up/down -v around the test"

requirements-completed: [PLAT-02]

# Metrics
duration: ~22min
completed: 2026-07-02
---

# Phase 00 Plan 03: Object Storage (Cloudflare R2) Summary

**Bun-native S3Client to a private R2 bucket with short-TTL presignPut/presignGet helpers and `/files` endpoints, proven by an automated presigned PUT→GET round-trip against MinIO (Criterion 3).**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-02T09:30:00Z (approx)
- **Completed:** 2026-07-02T09:34:00Z
- **Tasks:** 2 (Task 2 is TDD: RED→GREEN)
- **Files modified:** 4 (2 created, 2 filled from stubs)

## Accomplishments
- Storage plugin: Bun `S3Client` targeting the account-scoped R2 endpoint (`<ACCOUNT_ID>.r2.cloudflarestorage.com` — Pitfall 6), exposing `presignPut`/`presignGet` at a 300s default TTL, private bucket, no public-read ACL (Pitfall 4).
- `/files` routes: `POST /files/presign` (presigned PUT) and `GET /files/:key/url` (presigned GET), both delegating to `storage.presign*` (never hand-rolled SigV4), with `isSafeKey` guarding against path traversal / absolute keys (T-00-09 / V12).
- Criterion 3 proven automatically: presigned PUT upload → presigned GET download returns identical bytes against MinIO; unsigned GET of the object is rejected (403/401), confirming the bucket stays private.
- Same code path exercises prod R2 — only the endpoint differs via the optional `R2_ENDPOINT` override.

## Task Commits

Each task was committed atomically:

1. **Task 1: Storage plugin — Bun S3Client → R2 with short-TTL presign** - `9b5c145` (feat)
2. **Task 2 (RED): failing presigned round-trip test + MinIO compose** - `05e0864` (test)
3. **Task 2 (GREEN): /files routes + S3-compat endpoint seam** - `f0bcf86` (feat)

_TDD gate sequence satisfied: `test(...)` (RED) → `feat(...)` (GREEN). No refactor needed._

## Files Created/Modified
- `api/src/plugins/storage.plugin.ts` - Bun `S3Client` → private R2, `presignPut`/`presignGet` (TTL 300s), account-scoped endpoint with optional `R2_ENDPOINT` override.
- `api/src/routes/files.ts` - `POST /files/presign` + `GET /files/:key/url`; `isSafeKey` validation; TTL constant 300s.
- `api/tests/docker-compose.minio.yml` - Ephemeral MinIO (S3-compatible), private bucket `saladee-uploads-test`, creds mirror `.env.test`.
- `api/tests/storage.test.ts` - Presigned PUT→GET round-trip, private-bucket (unsigned GET rejected), and key-validation specs.

## Decisions Made
- Resolved Assumption A1 empirically: `s3.presign(key, { method, expiresIn })` is the correct Bun 1.3.14 signature (probed before coding); Bun uses path-style URLs with `region=auto`, which MinIO accepts.
- Centralized key policy in `isSafeKey` and relaxed the TypeBox body to `t.String()` so every invalid key (empty, absolute, traversal) returns a uniform `400` rather than a `422` for the empty case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added an optional `R2_ENDPOINT` endpoint seam to the storage plugin**
- **Found during:** Task 2 (round-trip test wiring)
- **Issue:** A presigned URL signs its target host (SigV4). With the endpoint hard-fixed to `<ACCOUNT_ID>.r2.cloudflarestorage.com`, the URL minted by the route could not reach MinIO, so Criterion 3 could not be proven in CI without a real R2 account. Rewriting the host post-signing would invalidate the signature.
- **Fix:** `endpoint = process.env.R2_ENDPOINT ?? \`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com\``. Prod default is unchanged (still the account-scoped R2 endpoint, still contains `r2.cloudflarestorage.com`). Read from `process.env` directly because it is infra config, not a secret, and is intentionally kept out of the strict boot schema (env.ts is out of this plan's scope). The test sets `R2_ENDPOINT=http://localhost:9000` before a dynamic import of the app.
- **Files modified:** api/src/plugins/storage.plugin.ts
- **Verification:** Round-trip test passes against MinIO; source still asserts the R2 default endpoint; `bunx tsc --noEmit` clean.
- **Committed in:** `f0bcf86` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The seam is a test/config seam only; the production signing path and all Task 1 source assertions (account-scoped R2 endpoint, no public ACL, TTL 300s, plugin name "storage") are preserved. No scope creep.

## Issues Encountered
- Fresh worktree had no `node_modules`; ran `bun install` (installs already-declared lockfile deps — not a package add) so `bunx tsc` could resolve `@types/bun`.
- Docker Compose derives the project name `tests` from the compose file's directory, which is shared with another agent's `postgres` orphan container. Teardown used `down -v` WITHOUT `--remove-orphans`, so only my `minio`/`createbucket` services and their volumes were removed; the sibling postgres and the shared network were left intact.

## User Setup Required
None for this test path (MinIO is ephemeral and self-provisions). Real Cloudflare R2 (bucket + API token, `R2_*` env) is provisioned and validated separately in 00-07.

## Next Phase Readiness
- PLAT-03 groundwork ready: private bucket + short-lived signed URLs, the exact pattern Phase 2 slips/photos depend on.
- The `/files/presign` and `/files/:key/url` endpoints are unguarded by auth in this slice (Phase 0 groundwork); Phase 2 must gate GET presigns behind an owner/role check before serving customer slips (Pitfall 4 note).
- Real R2 round-trip verification remains for 00-07 (needs the provisioned bucket).

## Self-Check: PASSED

- All 5 target files exist on disk (2 created, 2 filled, 1 SUMMARY).
- All 4 commits present: `9b5c145` (plugin), `05e0864` (test/RED), `f0bcf86` (routes/GREEN), `68bff36` (SUMMARY).
- `api/src/index.ts` byte-identical to base `3023468` (0 diff lines).
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched (orchestrator-owned).
- MinIO stack torn down (`down -v`); no leftover `tests-minio`/`tests-createbucket` containers.

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*
