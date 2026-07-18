---
phase: 04-web-store-marketing-scale
plan: 10
subsystem: ui
tags: [liff, vue, coupon, loyalty-points, pdpa, consent, marketing-opt-out, elysia, drizzle]

# Dependency graph
requires:
  - phase: 04-01
    provides: pdpaPolicyVersion/pdpaPolicyText settings keys (hot config)
  - phase: 04-03
    provides: POST /orders couponCode/redeemPoints server-side discount resolution + PromptPay QR
  - phase: 04-06
    provides: broadcast audience filter (latest marketing consent_logs row per customer)
provides:
  - LIFF checkout coupon-code field + points-redeem entry (code + bounded count only, no money)
  - LIFF launch-link segment code auto-apply for coupons (D-14)
  - member marketing opt-out endpoint + LIFF opt-out surface (D-17)
  - version-aware PDPA re-consent gate on the next order after a policy-version bump
affects: [verify-work, gsd-code-review, phase-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only PDPA consent trail extended: opt-out + re-consent are new consent_logs rows, never UPDATEs"
    - "LIFF member-gated discount inputs mirror the web-store 04-09 contract (code/count only; server resolves money)"

key-files:
  created:
    - api/tests/consent-optout.test.ts
    - web/src/components/CouponField.vue
    - web/src/components/PointsRedeem.vue
    - web/src/views/ConsentSettings.vue
  modified:
    - api/src/services/consent.ts
    - api/src/routes/me-orders.ts
    - web/src/lib/checkout.ts
    - web/src/views/CheckoutWizard.vue
    - web/src/router.ts

key-decisions:
  - "Coupon 'applied' state in LIFF is optimistic (shows the code, defers the discount to the pay screen) because no money may be computed client-side (T-04-32)"
  - "needsReconsent is derived from the member's LATEST marketing row vs the current pdpaPolicyVersion; opting out (a granted=false row at the current version) also satisfies re-consent"
  - "PointsRedeem defaults the toggle to the full balance so the common 'redeem all' case is one tap; QtyStepper fine-tunes (UI-SPEC QtyStepper idiom)"

patterns-established:
  - "getConsentStatus(db, customerId): current policy version + latest marketing grant + needsReconsent, read at LIFF wizard load"
  - "optOutMarketing(tx, {customerId, policyVersion, source}): single append-only marketing granted=false row honored by the broadcast filter"

requirements-completed: [MKT-01, CUST-03, MKT-03]

coverage:
  - id: D1
    description: "Member marketing opt-out appends a granted=false marketing consent_logs row (append-only, prior rows untouched) and the broadcast audience excludes them"
    requirement: MKT-03
    verification:
      - kind: integration
        ref: "api/tests/consent-optout.test.ts#opt-out appends a granted=false marketing row; prior rows untouched"
        status: pass
      - kind: integration
        ref: "api/tests/consent-optout.test.ts#after opt-out the broadcast audience excludes the member"
        status: pass
    human_judgment: false
  - id: D2
    description: "getConsentStatus.needsReconsent flips true after a pdpaPolicyVersion bump; opt-out + status routes reject guest (403) and missing token (401)"
    requirement: CUST-03
    verification:
      - kind: integration
        ref: "api/tests/consent-optout.test.ts#consent-status: needsReconsent flips true after a pdpaPolicyVersion bump"
        status: pass
      - kind: integration
        ref: "api/tests/consent-optout.test.ts#opt-out + consent-status reject a guest (403) and a missing token (401)"
        status: pass
    human_judgment: false
  - id: D3
    description: "buildOrderBody carries optional couponCode/redeemPoints (code+count only, no money) and a version-sourced consent policyVersion; web build green"
    requirement: MKT-01
    verification:
      - kind: unit
        ref: "cd web && bun test (member-checkout.test.ts, checkout-wizard.test.ts)"
        status: pass
      - kind: integration
        ref: "cd web && bun run build"
        status: pass
    human_judgment: false
  - id: D4
    description: "LIFF checkout shows a coupon field + member-only points redeem, auto-applies a launch-link segment code, and gates the pay CTA behind a re-shown consent when needsReconsent"
    requirement: MKT-01
    verification: []
    human_judgment: true
    rationale: "Segment auto-apply from a real LIFF launch link, the coupon/points UI, and the re-consent gate need a human to exercise the LIFF flow end-to-end (visual + interaction)."
  - id: D5
    description: "LIFF /consent surface lets a member view marketing-consent state and opt out behind a confirm, reflecting the opted-out state"
    requirement: MKT-03
    verification: []
    human_judgment: true
    rationale: "Opt-out surface state transitions + confirm dialog are a visual/interaction flow best verified by a human in the LIFF."

# Metrics
duration: 9min
completed: 2026-07-18
status: complete
---

# Phase 4 Plan 10: LIFF Coupon/Points + PDPA Opt-out Summary

**LIFF checkout gains a coupon-code field, member-only points redeem, launch-link segment auto-apply, plus an append-only marketing opt-out endpoint/surface and a version-aware PDPA re-consent gate — closing D-14 on LINE/LIFF and D-17 + the PDPA-versioning specifics.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-18T01:13:57Z
- **Completed:** 2026-07-18T01:22:40Z
- **Tasks:** 3
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- Marketing opt-out (`POST /me/marketing-opt-out`) + version-aware `GET /me/consent-status`, member-gated behind the existing me-orders line_user_id guard; the opt-out appends a single `granted=false` marketing `consent_logs` row (never an UPDATE) that the 04-06 broadcast audience filter honors (D-17, NFR-04).
- LIFF checkout coupon-code field + member-only points-redeem entry sending only `couponCode`/`redeemPoints` (code + bounded count, no money — server resolves the discount + QR, 04-03/T-04-32); a LIFF launch-link `code`/`liff.state` segment code prefills + auto-applies the coupon (D-14).
- Version-aware re-consent: the wizard reads the current `pdpaPolicyVersion` from `GET /me/consent-status` at load, stamps the order body with it, and — when `needsReconsent` is true — re-shows `ConsentCheckboxes` and blocks the pay CTA until usage is re-granted.
- LIFF `/consent` opt-out surface: a member views their marketing-consent state and opts out behind a confirm dialog, then sees the opted-out state.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing test for opt-out + consent-status** - `7e3e090` (test)
2. **Task 1 (GREEN): opt-out + consent-status endpoints** - `8297614` (feat)
3. **Task 2: LIFF coupon/points fields + segment auto-apply + re-consent gate** - `ab27c31` (feat)
4. **Task 3: LIFF marketing opt-out surface + /consent route** - `54e1316` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `api/src/services/consent.ts` - Added `optOutMarketing()` (append-only marketing granted=false row) + `getConsentStatus()` (current policy version + latest grant + needsReconsent).
- `api/src/routes/me-orders.ts` - Added `POST /me/marketing-opt-out` + `GET /me/consent-status` behind the member gate.
- `api/tests/consent-optout.test.ts` - Append-only opt-out, broadcast exclusion, version-bump re-consent, guest/token rejection.
- `web/src/lib/checkout.ts` - `OrderBody`/`buildOrderBody` carry optional `couponCode`/`redeemPoints` + a version-sourced consent `policyVersion` (POLICY_VERSION fallback for guests).
- `web/src/components/CouponField.vue` - Coupon input + "ใช้คูปอง" confirm + auto-apply of a launch-link code (optimistic applied state, no money).
- `web/src/components/PointsRedeem.vue` - Member-only balance display + QtyStepper choosing `redeemPoints`.
- `web/src/views/CheckoutWizard.vue` - Mounts the fields in the review step, fetches balance + consent-status for members, auto-applies the segment code, and gates the pay CTA behind re-consent.
- `web/src/views/ConsentSettings.vue` - Member opt-out surface (state + confirm + POST opt-out).
- `web/src/router.ts` - Registered the `/consent` route.

## Decisions Made
- Coupon "applied" in LIFF is optimistic (code only; discount shown on the pay screen) — no client-side money (T-04-32).
- `needsReconsent` is the latest marketing row's `policy_version` vs the current version; opting out at the current version also clears re-consent.
- Points toggle defaults to the full balance (one-tap redeem-all), QtyStepper fine-tunes.

## Deviations from Plan
None - plan executed exactly as written. (The plan referenced mirroring web-store 04-09 CouponField/PointsRedeem; those siblings did not yet exist on disk — 04-09 is a parallel wave-3 plan — so the LIFF components were built fresh against the same UI-SPEC copy + Plan-03 contract, which is the intended "mirror". No behavioral change vs plan.)

## Issues Encountered
- The full api suite showed one flaky failure on the first run (shared PostgreSQL test DB race) that did not reproduce; a clean re-run was 369 pass / 0 fail. Not related to this plan's changes.

## User Setup Required
None - no external service configuration required. The coupon/points/PDPA-version settings are owner-editable via the existing hot-config settings (04-01).

## Next Phase Readiness
- D-14 (coupon at checkout) now closed on BOTH web (04-09) and LIFF (this plan); D-17 opt-out + PDPA re-consent closed.
- Reservation guard untouched (no second oversell path — NFR-02); discounts stay server-resolved (04-03).
- Human LIFF UAT recommended for D4/D5 (segment auto-apply from a real launch link, opt-out surface transitions).

## Self-Check: PASSED

All 9 created/modified files present on disk; all 4 task commits (`7e3e090`, `8297614`, `ab27c31`, `54e1316`) found in git history.

---
*Phase: 04-web-store-marketing-scale*
*Completed: 2026-07-18*
