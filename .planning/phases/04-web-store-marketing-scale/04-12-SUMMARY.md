---
phase: 04-web-store-marketing-scale
plan: 12
subsystem: api
tags: [line, flex-message, broadcast, marketing, messaging-api, vue, pdpa]

# Dependency graph
requires:
  - phase: 04-11
    provides: catalog coverUrl (product image URLs reused as the Flex hero image)
  - phase: 04-06
    provides: broadcast service (resolveAudience/chunk/runBroadcast) + composer
provides:
  - buildBroadcastFlex(fields) — canonical LINE Flex marketing bubble (hero/body/footer CTA)
  - normalizeMessages hardened to guarantee a non-empty altText on any stored Flex message
  - BroadcastComposer Flex mode capturing hero/headline/body/CTA and posting Flex messageJson
affects: [broadcast, marketing, line-messaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical Flex shape lives server-side (buildBroadcastFlex); web-admin mirrors it field-for-field with a drift-guard comment (no cross-package import available)"
    - "normalizeMessages ensures LINE-required altText at the delivery seam so any stored Flex (from any client) is safe to multicast"

key-files:
  created:
    - api/tests/broadcast-flex.test.ts
  modified:
    - api/src/services/broadcast.ts
    - web-admin/src/views/BroadcastComposer.vue

key-decisions:
  - "buildBroadcastFlex is the single source-of-truth Flex shape; composer flexPayload() mirrors it (comment guard) since web-admin cannot import api types"
  - "altText derived from headline, trimmed and capped to LINE's 400-char limit; falls back to default marketing copy when headline empty"
  - "hero and CTA footer are omitted when their fields are empty so no invalid empty-uri/empty-url node is emitted (T-04-12-03)"
  - "normalizeMessages injects fallback altText per array element AND for a single Flex object, guaranteeing altText regardless of client shape"

patterns-established:
  - "Server-owned canonical message shape + client mirror with explicit drift-guard comment"
  - "Delivery-seam altText enforcement decouples LINE's Flex requirement from client correctness"

requirements-completed: [MKT-03, LINE-04]

coverage:
  - id: D1
    description: "buildBroadcastFlex produces a valid Flex bubble (hero/body/footer CTA) with a guaranteed non-empty altText; hero/CTA omitted when fields empty; altText capped to 400"
    requirement: "MKT-03"
    verification:
      - kind: unit
        ref: "api/tests/broadcast-flex.test.ts#buildBroadcastFlex"
        status: pass
    human_judgment: false
  - id: D2
    description: "normalizeMessages guarantees a non-empty altText on any stored Flex message (missing/empty/array) and preserves the plain-text fallback for undefined/plain input"
    requirement: "LINE-04"
    verification:
      - kind: unit
        ref: "api/tests/broadcast-flex.test.ts#normalizeMessages altText guarantee"
        status: pass
      - kind: unit
        ref: "api/tests/broadcast-audience.test.ts (consent + ≤500 chunking regression)"
        status: pass
    human_judgment: false
  - id: D3
    description: "web-admin BroadcastComposer offers a plain-text|Flex toggle; Flex mode captures hero/headline/body/CTA and posts a Flex messageJson matching buildBroadcastFlex; plain-text path unchanged"
    requirement: "MKT-03"
    verification:
      - kind: automated_ui
        ref: "web-admin vue-tsc --noEmit (BroadcastComposer.vue clean)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A consented recipient receives the styled Flex card (hero/headline/body/CTA) on a real LINE device; plain-text fallback still delivers as text; opted-out account receives neither"
    requirement: "LINE-04"
    verification:
      - kind: manual_procedural
        ref: "human-verify checkpoint (Task 3): Flex card confirmed on device, plain-text fallback confirmed, consent/audience intact"
        status: pass
    human_judgment: true
    rationale: "End-to-end delivery of a rendered Flex card to a real LINE client and PDPA consent scoping cannot be asserted by unit tests — requires a device and a marketing-consented test account. Confirmed approved by coordinator."

# Metrics
duration: 20 min
completed: 2026-07-18
status: complete
---

# Phase 4 Plan 12: Broadcast Flex Message Summary

**Marketing broadcasts can now be composed and delivered as styled LINE Flex cards (hero image, headline, body, CTA button) with a guaranteed non-empty altText, while the plain-text path and PDPA consent-scoped ≤500 chunking stay untouched.**

## Performance

- **Duration:** ~20 min (code); + human-verify checkpoint
- **Started:** 2026-07-18T13:35:40Z (first commit)
- **Completed:** 2026-07-18T13:39:47Z (code) — device verification approved by coordinator
- **Tasks:** 3 (2 automated + 1 human-verify checkpoint, approved)
- **Files modified:** 3

## Accomplishments
- `buildBroadcastFlex(fields)` — canonical LINE Flex marketing bubble mirroring the notify.ts Flex idiom: optional cover hero, bold headline + body text, optional primary uri CTA button; altText derived from headline (trimmed, capped to LINE's 400 limit) with a default fallback.
- `normalizeMessages` exported and hardened: guarantees a non-empty altText on any stored Flex message (single object OR per array element), injecting the default marketing altText when missing/empty — LINE rejects a Flex without altText.
- BroadcastComposer gains a "ข้อความธรรมดา | การ์ด Flex" toggle; Flex mode captures hero URL / headline / body / CTA label + link and posts a Flex `messageJson` that matches `buildBroadcastFlex` field-for-field; plain-text `messagePayload()` path unchanged as the fallback.
- Consent invariants intact: `resolveAudience`, consent filtering, and ≤500 chunking are untouched (regression test green) — this is a message-shape change only.

## Task Commits

Each task committed atomically:

1. **Task 1 (TDD): Flex builder + altText-hardened normalizeMessages**
   - `7866f02` (test — RED)
   - `081035c` (feat — GREEN)
2. **Task 2: Composer captures Flex fields, posts Flex messageJson** - `18ba11b` (feat)
3. **Task 3: Human-verify checkpoint** — approved by coordinator (Flex card confirmed on device, plain-text fallback confirmed, consent/audience intact)

**Plan metadata:** see final docs commit below.

## Files Created/Modified
- `api/src/services/broadcast.ts` - Added `buildBroadcastFlex` (canonical bubble) + `BroadcastFlexFields`; exported and hardened `normalizeMessages` with `ensureAltText` altText guarantee.
- `api/tests/broadcast-flex.test.ts` - Pure unit test (no DB): builder shape + hero/CTA omission + altText cap; normalizeMessages altText guarantee + plain-text fallback.
- `web-admin/src/views/BroadcastComposer.vue` - Message-type toggle, Flex-field capture, `flexPayload()` mirror of `buildBroadcastFlex`, Flex-mode validation.

## Decisions Made
- Server-owned canonical Flex shape (`buildBroadcastFlex`) with a client mirror in the composer plus an explicit drift-guard comment, because web-admin and api cannot share types across packages.
- altText enforced at the delivery seam (`normalizeMessages`) rather than trusting the client, so any stored Flex is safe to multicast.
- hero/CTA nodes omitted when their fields are empty to avoid emitting invalid empty-uri nodes (T-04-12-03).

## Deviations from Plan

None — plan executed as written. No auto-fixes were required to complete the tasks.

One out-of-scope pre-existing issue was observed and left untouched (already logged in `deferred-items.md` since 04-06):

**[Out-of-scope] `web-admin/src/views/CouponComposer.vue:86` vue-tsc TS2345**
- **Found during:** Task 2 typecheck (`bun run typecheck`)
- **Issue:** `Record<string, unknown>` not assignable to the coupon create body type (missing `code`, `discountKind`, `discountValue`).
- **Decision:** Pre-existing before 04-12 (confirmed: error present with 04-12 changes stashed). NOT in this plan's `files_modified` scope — not fixed. `BroadcastComposer.vue` itself typechecks clean.
- **Tracking:** `.planning/phases/04-web-store-marketing-scale/deferred-items.md`.

---

**Total deviations:** 0 auto-fixed. 1 pre-existing out-of-scope issue logged (not fixed).
**Impact on plan:** None — all plan tasks completed; the broadcast Flex path works end-to-end and device-verified.

## Issues Encountered
None during planned work.

## User Setup Required
None - no external service configuration required (uses the existing LINE Messaging API creds from 04-06).

## Next Phase Readiness
- UAT Gap 2 (test 3 enhancement — Flex message) closed and device-verified.
- Marketing broadcasts now support both plain-text and Flex campaigns with PDPA invariants intact.

---
*Phase: 04-web-store-marketing-scale*
*Completed: 2026-07-18*

## Self-Check: PASSED
- `api/src/services/broadcast.ts` exists with `buildBroadcastFlex` + exported `normalizeMessages` (FOUND)
- `api/tests/broadcast-flex.test.ts` exists — 11 pass / 0 fail (FOUND)
- `web-admin/src/views/BroadcastComposer.vue` Flex mode present (heroImageUrl x6) (FOUND)
- Commits `7866f02`, `081035c`, `18ba11b` present in git log (FOUND)
- Regression: `broadcast-audience.test.ts` 4 pass / 0 fail (consent + chunking untouched)
