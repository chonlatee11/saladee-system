---
phase: 00-foundation-platform
plan: 04
subsystem: api
tags: [line, webhook, hmac, signature-validation, elysia, bun, messaging-api]

# Dependency graph
requires:
  - phase: 00-foundation-platform (plan 00-01)
    provides: env (LINE_CHANNEL_SECRET/TOKEN), linePlugin+webhookRoutes stubs, logger, index.ts composition
provides:
  - Real @line/bot-sdk v11 MessagingApiClient built from validated env (linePlugin)
  - POST /webhook that validates x-line-signature over the RAW request body and echoes text messages
  - Automated proof (valid Thai payload -> 200 echo, forged/absent signature -> 401)
affects: [phase-2-status-notifications, line-rich-menu, liff-auth, any-line-webhook-driven-feature]

# Tech tracking
tech-stack:
  added: []  # @line/bot-sdk@11.0.2 already declared in 00-01; only restored node_modules
  patterns:
    - "Raw-body-first webhook: read request.text() BEFORE JSON.parse; NO TypeBox schema on the route (Pitfall 1)"
    - "HMAC signature trust boundary via @line/bot-sdk validateSignature over raw bytes; reject 401 on forged/absent"
    - "Plugin-provided context: linePlugin decorates { client, channelSecret }; route .use(linePlugin) for typed access"
    - "Secrets sourced only from env, never logged (T-00-15)"

key-files:
  created:
    - api/tests/webhook.test.ts
  modified:
    - api/src/plugins/line.plugin.ts
    - api/src/routes/webhook.ts

key-decisions:
  - "No TypeBox body schema on /webhook — a schema forces Elysia to parse first and destroys raw bytes"
  - "Empirically confirmed Elysia 1.4.29 does NOT pre-consume the body without a schema; request.text() returns exact raw string (Thai preserved)"
  - "Spy on MessagingApiClient.prototype.replyMessage in tests to assert echo without network calls"

patterns-established:
  - "LINE webhook: raw bytes -> validateSignature -> 401-or-parse -> reply"
  - "TDD gate: test(RED) commit precedes feat(GREEN) commit"

requirements-completed: [PLAT-05]

# Metrics
duration: ~15min
completed: 2026-07-02
---

# Phase 00 Plan 04: LINE Webhook Slice Summary

**Signature-validated LINE echo webhook — @line/bot-sdk v11 MessagingApiClient from env plus a POST /webhook that HMAC-validates x-line-signature over the RAW body (Thai-safe) and echoes text, with forged/absent signatures rejected 401.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-02T02:26Z (approx)
- **Completed:** 2026-07-02T02:33Z
- **Tasks:** 2 (1 auto, 1 TDD)
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- Replaced the `line.plugin.ts` stub with a real `@line/bot-sdk` v11 `MessagingApiClient` built from validated env; decorates context with `{ client, channelSecret }` (no literals, name kept "line").
- Replaced the `webhook.ts` stub with a raw-body-first `POST /webhook`: reads `request.text()` before any parse, validates `x-line-signature` via `validateSignature`, echoes text messages via the reply API, rejects forged/absent signatures with 401.
- Added `webhook.test.ts` proving Criterion 4 / D-06: a valid HMAC over a **Thai** payload (`สวัสดีจากสวนสลัด`) yields 200 + echoed reply; wrong signature and missing header both yield 401 with no reply.
- Full suite green (9 tests across 3 files), `tsc --noEmit` clean, Biome clean, `api/src/index.ts` untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: LINE Messaging plugin from env** - `4a72081` (feat)
2. **Task 2: POST /webhook — raw-body signature validation + echo**
   - RED: `e8cc78b` (test) — failing signature/echo tests
   - GREEN: `9b197b1` (feat) — raw-body validation + echo implementation

_TDD gate satisfied: test(RED) commit precedes feat(GREEN) commit._

## Files Created/Modified
- `api/src/plugins/line.plugin.ts` - Builds v11 `MessagingApiClient` from `env.LINE_CHANNEL_ACCESS_TOKEN`; decorates `line` with `{ client, channelSecret }`.
- `api/src/routes/webhook.ts` - `POST /webhook`: `request.text()` first, `validateSignature` over raw body, 401 on forged/absent, echo text via `line.client.replyMessage`; no body schema.
- `api/tests/webhook.test.ts` - Real-HMAC valid/invalid/missing coverage over a non-ASCII Thai payload; reply spy asserts echo.

## Decisions Made
- **No TypeBox body schema on /webhook.** A schema makes Elysia parse the body first, which changes/consumes the raw bytes and breaks the HMAC. Reading `request.text()` first preserves the exact bytes (Pitfall 1).
- **Empirically verified Elysia 1.4.29 body behavior.** Probed that, without a schema, Elysia does not eagerly consume the body — `request.text()` in the handler returns the exact raw string with Thai preserved. Adding an `onParse` that reads the body would consume it and break `request.text()`, so none was added.
- **Reply spy over network.** Tests `spyOn` `MessagingApiClient.prototype.replyMessage` (mockResolvedValue) to assert the echoed text without hitting the LINE API.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored missing node_modules for the api workspace**
- **Found during:** Setup before Task 1
- **Issue:** `api/node_modules` was absent in the worktree, so `@line/bot-sdk`/`elysia` could not resolve and nothing could typecheck or run.
- **Fix:** Ran `bun install` in `api/` to restore the **already-declared** dependencies (`@line/bot-sdk@11.0.2` was already pinned in `api/package.json` and the CLAUDE.md locked stack — no new package added).
- **Files modified:** none tracked (node_modules is gitignored; lockfile unchanged).
- **Verification:** `@line/bot-sdk@11.0.2` resolved; `validateSignature` and `messagingApi.MessagingApiClient` importable.

**2. [Rule 3 - Blocking] Type-safe test access + Biome formatting**
- **Found during:** Task 2 (after GREEN)
- **Issue:** `tsc --noEmit` flagged `replySpy.mock.calls[0][0]` as possibly-undefined (strict null); Biome flagged line-width formatting.
- **Fix:** Switched to `.at(0)?.at(0)` optional access (avoids `noNonNullAssertion`); ran `biome check --write` to apply project formatting.
- **Files modified:** api/tests/webhook.test.ts, api/src/routes/webhook.ts (formatting only)
- **Verification:** `tsc --noEmit` clean, Biome clean, 9/9 tests pass.
- **Committed in:** `9b197b1` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Both were environment/toolchain prerequisites, not scope changes. Implementation matches the plan exactly (raw-body-first, no schema, validateSignature, echo). No scope creep.

## Issues Encountered
- The worktree branch was initially based on the wrong commit (`dbd9d40 "Initial commit"`, README-only) instead of the intended base `3023468`. Resolved with the startup `git reset --hard 3023468` (allowed worktree setup step; `dbd9d40` is an ancestor of the base — fast-forward-safe), which brought in the `.planning/` and `api/` trees.

## Threat Model Coverage
- **T-00-12 (Spoofing):** `validateSignature` (constant-time) over raw body; forged signature -> 401 (tested).
- **T-00-13 (Tampering / body re-serialization):** `request.text()` before parse, no TypeBox schema; Thai-payload test guards regressions.
- **T-00-14 (Replay):** accepted for Phase 0 (echo is idempotent/harmless); dedup deferred to Phase 2 as planned.
- **T-00-15 (Info disclosure):** secret/token only from `env`, never logged; the 401 warn log omits the secret.

## User Setup Required
None for automated verification. NOTE: real LINE OA delivery/echo (a provisioned Messaging channel + public HTTPS webhook URL) is verified manually in plan 00-07.

## Next Phase Readiness
- LINE inbound trust boundary is live and tested end-to-end (not stubbed) — Phase 2 status-notifications and push flows can build on `linePlugin.client` and the validated webhook.
- No blockers. index.ts composition remains untouched, so parallel wave-2 slices stay conflict-free.

## Self-Check: PASSED

---
*Phase: 00-foundation-platform*
*Completed: 2026-07-02*
