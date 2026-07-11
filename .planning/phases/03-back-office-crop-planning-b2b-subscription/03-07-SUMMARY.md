---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 07
subsystem: subscriptions
tags: [pg-boss, drizzle, reservation, idempotency, line-flex, vue, tanstack-query, tdd]

# Dependency graph
requires:
  - phase: 03-01
    provides: "subscriptions / subscription_skips / subscription_orders tables + UNIQUE(subscription_id, round_id); pg-boss booted (02-01/02-07 hold-expiry worker)"
  - phase: 03-03
    provides: "web-admin scaffold — DataTable.vue, session store, router meta.roles, Subscriptions.vue stub, TanStack Query app-wide"
  - phase: 01-commerce-core
    provides: "reserve()/reserveBox() guarded oversell path, applyTransition, orders/order_lines, requireRole + customer session (session.role/session.sub)"
  - phase: 02-line-storefront-payments-delivery
    provides: "notify.ts Flex push seam (buildOrderFlex/pushOrderUpdate, guest-skip), payment/hold-expiry pipeline"
provides:
  - "subscription.ts fillBox() — pure deterministic value-fill (OQ3) from round availability to package value"
  - "subscription.ts generateForRound() — one box order per active sub, reserved via existing reserveBox(), idempotent via DB UNIQUE (23505 no-op)"
  - "pg-boss subscription-generate queue+worker (workerDb DIRECT) — queue/worker ONLY; trigger owned by 03-05 publishQuota post-publish"
  - "routes/subscriptions.ts — staff roster + pause/skip/cancel/resume shared admin+customer guard (ownership + cut-off, D-14)"
  - "notify.ts notifySubstitution + buildSubstitutionFlex (member-only, D-16)"
  - "web-admin Subscriptions.vue admin roster + useSubscriptions.ts composables"
affects: [03-08-subscription-liff, 03-05-round-open-orchestration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generator idempotency = DB UNIQUE(subscription_id, round_id) as the LAST insert in a per-subscription own-tx; 23505 rolls back order+reservation (never an in-code pre-check)"
    - "23505 detection walks drizzle's wrapped error .cause chain (drizzle 0.45 wraps postgres.js errors)"
    - "Pure deterministic fill fn (fillBox) unit-tested; DB-touching generator integration-tested against real PG"
    - "Shared route with per-request authorize() (staff bypass vs customer ownership+cutoff) instead of a single role beforeHandle"
    - "Substitution flag rides existing box_bom_json (jsonb) — surfaced to admin with NO schema migration"

key-files:
  created:
    - api/src/services/subscription.ts
    - api/tests/subscription-fill.test.ts
    - api/tests/subscription-gen.test.ts
    - web-admin/src/composables/useSubscriptions.ts
  modified:
    - api/src/jobs/boss.ts
    - api/src/services/notify.ts
    - api/src/routes/subscriptions.ts
    - web-admin/src/views/Subscriptions.vue

key-decisions:
  - "fillBox deterministic order = availableUnits desc (stock depth/freshness) → unitPriceSatang desc → varietyId asc; greedy whole-plant fill, never overshoot (OQ3 resolved)"
  - "Generated order created as awaiting_payment + holdExpiresAt so it rides the EXISTING payment/hold-expiry pipeline (D-15) — no billing engine, no ad-hoc status UPDATE"
  - "Substitution proxy (no fixed BOM): a priced round variety that is sold out → the box was filled around it → substitution=true; member notified, guest skipped (D-16/D-23)"
  - "subscription-generate trigger deliberately NOT fired here — 03-05 publishQuota owns the single boss.send post-publish"
  - "notify.ts extended (not listed in files_modified) to reuse its LINE client for the substitution Flex rather than duplicate a client in boss.ts"

patterns-established:
  - "Own-transaction-per-item generator loop with UNIQUE-last idempotency (mirrors sweepExpiredHolds batch isolation)"
  - "Injectable notifier (opts.notify) keeps the generator unit-testable; boss.ts wires the real notify.notifySubstitution"

requirements-completed: [SALE-03, ADM-02]

coverage:
  - id: D1
    description: "fillBox() pure deterministic value-fill from round availability to the package value (OQ3)"
    requirement: "SALE-03"
    verification:
      - kind: unit
        ref: "api/tests/subscription-fill.test.ts#fillBox() — deterministic value-fill (D-12 / OQ3)"
        status: pass
    human_judgment: false
  - id: D2
    description: "generateForRound reserves the box through the existing reserveBox() (reserve-before-B2C, no 2nd counter) and is idempotent via DB UNIQUE(subscription,round) (23505 no-op)"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "api/tests/subscription-gen.test.ts#creates one box order per active subscription and reserves its plants"
        status: pass
      - kind: integration
        ref: "api/tests/subscription-gen.test.ts#is idempotent: a second run creates no duplicate order and does not double-reserve"
        status: pass
    human_judgment: false
  - id: D3
    description: "Generator skips paused/cancelled subscriptions and subscriptions with a skip row (status read at run time, D-14)"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "api/tests/subscription-gen.test.ts#skips paused/cancelled subscriptions and subscriptions with a skip row (D-14)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sold-out variety → box filled from what's available + substitution notice to the member; guest (no line_user_id) skipped (D-16/D-23)"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "api/tests/subscription-gen.test.ts#substitution: a sold-out variety fills from what's available and notifies the member; guest is skipped"
        status: pass
    human_judgment: false
  - id: D5
    description: "pg-boss subscription-generate queue+worker (workerDb DIRECT) defined; trigger deferred to 03-05 publishQuota"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "cd api && bunx tsc --noEmit (worker wiring typechecks; generateForRound is exercised directly by subscription-gen.test.ts)"
        status: pass
    human_judgment: true
    rationale: "No test boots the pg-boss worker (import.meta.main guard keeps it out of the suite). The full round-open → boss.send → worker path is exercised live in the Task-3 checkpoint (and wired by 03-05). generateForRound itself is fully integration-tested."
  - id: D6
    description: "web-admin Subscriptions admin roster (member/package/frequency/latest-round + status badge + substitution flag) with pause/resume/cancel and destructive cancel-confirm"
    requirement: "ADM-02"
    verification:
      - kind: unit
        ref: "cd web-admin && bunx vue-tsc --noEmit"
        status: pass
      - kind: manual_procedural
        ref: "Task 3 checkpoint (gate=blocking): seed sub + open round, trigger generate, verify reserve-before-B2C + idempotent re-run + pause-skip + substitution Flex"
        status: unknown
    human_judgment: true
    rationale: "Live generator behavior (reserve-before-B2C ordering, retry idempotency, pause/skip skip, substitution Flex delivery) and the admin roster UX/RBAC round-trip require a running API + LINE — checkpoint:human-verify, gate=blocking. Automated typecheck + service integration tests are green; the end-to-end live path is the unverified item."

# Metrics
duration: ~7min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 07: Subscription Fill Service + pg-boss Generator Summary

**Deterministic value-fill `fillBox()` + idempotent pg-boss `subscription-generate` worker that creates one vegetable-box order per active subscription each round — reserving through the existing guarded `reserveBox()` (reserve-before-B2C, no second counter), safe to run twice via DB `UNIQUE(subscription,round)`, skipping paused/skipped/cancelled subs and notifying members of substitutions — plus the web-admin subscriptions roster.**

## Performance

- **Duration:** ~7 min
- **Completed:** 2026-07-07T16:50Z
- **Tasks:** 2 auto tasks done (Task 1 TDD, Task 2); Task 3 = human-verify checkpoint (pending, gate=blocking)
- **Files created:** 4 · **Files modified:** 4

## Accomplishments
- `fillBox()` — a pure, deterministic value-fill (OQ3 resolved): sorts candidates by stock-depth desc → price desc → varietyId asc, greedily fills whole plants up to the package value without overshoot, skipping sold-out/unpriced varieties. 6 unit cases.
- `generateForRound()` — per active, non-skipped subscription: fills the box, reserves every component through the UNCHANGED guarded `reserveBox()` (reserve-before-B2C, Pitfall 1 avoided), creates an `awaiting_payment` order + a box `order_lines` row (fill snapshot in `box_bom_json`), and links a `subscription_orders` row **as the last insert** so a retry trips the DB UNIQUE (23505) and rolls back the whole per-subscription tx — no duplicate box, no double reservation (Pitfall 2). Own-transaction-per-subscription so one failure never rolls back the batch.
- Reads subscription status + skip rows at RUN TIME → paused/cancelled/skipped subscriptions skipped (D-14). Sold-out round variety → box filled from what's available + substitution notice to the member; guest (no `line_user_id`) skipped silently (D-16/D-23).
- `jobs/boss.ts`: `subscription-generate` queue + worker on the DIRECT `workerDb`, mirroring hold-expiry. **Queue/worker ONLY — no `boss.send` trigger here**; the single trigger is 03-05 `publishQuota` post-publish. Worker wires `notify.notifySubstitution`.
- `routes/subscriptions.ts`: staff roster (member · package · frequency · latest-round + substitution flag from `box_bom_json`) + pause/skip/cancel/resume with a shared per-request guard (staff bypass; customer own-only + cut-off gate, D-14/T-03-18; non-owner → 404).
- web-admin `Subscriptions.vue` + `useSubscriptions.ts`: DataTable roster, status badges (active positive / paused neutral / cancelled negative), substitution-made flag, destructive cancel-confirm modal (UI-SPEC copy), Thai empty state.

## Task Commits

1. **Task 1 (RED): failing tests for fill + generator** - `c7c0c6b` (test)
2. **Task 1 (GREEN): fill service + generator + pg-boss queue + routes** - `3692b59` (feat)
3. **Task 2: web-admin subscriptions admin roster** - `f7aa35c` (feat)

_Task 1 followed TDD: RED (`test`) → GREEN (`feat`); no REFACTOR needed._

## Files Created/Modified
- `api/src/services/subscription.ts` (new) - `fillBox()` pure fn + `generateForRound()` generator
- `api/tests/subscription-fill.test.ts` (new) - 6 pure fillBox cases
- `api/tests/subscription-gen.test.ts` (new) - 4 integration cases (create/idempotent/skip/substitution)
- `api/src/jobs/boss.ts` - subscription-generate queue+worker (no trigger)
- `api/src/services/notify.ts` - `buildSubstitutionFlex` + `notifySubstitution` (member-only)
- `api/src/routes/subscriptions.ts` - staff roster + pause/skip/cancel/resume shared guard
- `web-admin/src/views/Subscriptions.vue` - admin roster (replaced stub)
- `web-admin/src/composables/useSubscriptions.ts` (new) - roster query + mutations

## Decisions Made
- fillBox order: stock-depth desc → price desc → id asc; greedy whole-plant, no overshoot (OQ3).
- Generated order = `awaiting_payment` + `holdExpiresAt` → rides existing payment/hold-expiry pipeline (D-15); no ad-hoc status UPDATE.
- Substitution proxy without a fixed BOM: a priced sold-out round variety ⇒ substitution=true.
- Trigger stays with 03-05 publishQuota (post-publish) — this plan defines queue+worker only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 23505 detection must walk drizzle's wrapped `.cause` chain**
- **Found during:** Task 1 (GREEN, idempotency test)
- **Issue:** drizzle 0.45 wraps the postgres.js error, so `err.code` was `undefined` on the wrapper and the UNIQUE-violation catch missed — the 23505 escaped to the test instead of being a no-op skip.
- **Fix:** `isUniqueViolation()` walks the error's `.cause` chain (depth-limited) checking `code === "23505"`. Same helper reused in `routes/subscriptions.ts` for the idempotent skip insert.
- **Files modified:** api/src/services/subscription.ts, api/src/routes/subscriptions.ts
- **Verification:** `subscription-gen.test.ts` idempotency case passes (no duplicate, reserved unchanged); full suite 245 pass.
- **Committed in:** 3692b59 (Task 1 GREEN commit)

**2. [Rule 2 - Missing Critical] Extended notify.ts (not in files_modified) to reuse its LINE client**
- **Found during:** Task 1 (GREEN, substitution notify)
- **Issue:** The plan's `files_modified` did not list `notify.ts`, but D-16 requires a substitution Flex push and the read_first said to reuse notify.ts. Building a second `MessagingApiClient` in `boss.ts` would duplicate the client + token handling (T-02-29 risk).
- **Fix:** Added `buildSubstitutionFlex` + `notifySubstitution` to `notify.ts` (reuses its module client, guest-skip done by caller, NODE_ENV=test guard); `boss.ts` wires it, `subscription.ts` stays LINE-agnostic (injectable notifier).
- **Files modified:** api/src/services/notify.ts
- **Verification:** substitution integration case asserts member notified once + guest skipped; tsc + suite green.
- **Committed in:** 3692b59

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical)
**Impact on plan:** Both necessary for correctness (idempotency actually working) and to satisfy D-16 without duplicating the LINE client. No scope creep; idempotency is enforced by the DB UNIQUE exactly as specified.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## Threat Surface
- **T-03-16 (duplicate box on retry):** mitigated — DB `UNIQUE(subscription,round)` as the last insert; idempotency integration test proves the retry is a no-op.
- **T-03-17 (oversell via subscription reserve):** mitigated — reservation flows only through the existing guarded `reserveBox()` (all-or-nothing sorted-lock); no second counter, no SELECT-then-check.
- **T-03-18 (customer edits another's subscription):** mitigated — `authorize()` staff-bypass vs customer ownership (customerId=session.sub); non-owner → 404; skip gated by round cut-off for customers.
- **T-03-19 (log LINE token):** mitigated — reuses notify.ts client; substitution notice carries no token; structured logs never carry secrets.
- No new security surface beyond the plan's threat register.

## User Setup Required
None. The Task-3 checkpoint needs a running API (:3000) + web-admin (:5174), at least one seeded active subscription, and an open round with stock to trigger `subscription-generate` (in isolation via a direct `generateForRound`/`boss.send`; in production 03-05 publishQuota fires it).

## Next Phase Readiness
- Backend generator + admin roster shipped; SALE-03 (backend + admin) delivered.
- **03-05 dependency:** `publishQuota` must fire `boss.send("subscription-generate", { roundId }, { singletonKey: roundId })` AFTER the round-open quota commit — this plan intentionally does NOT trigger it.
- **03-08 (customer LIFF):** reuses the same pause/skip/cancel/resume endpoints (customer session + ownership + cut-off already implemented); finer cut-off semantics for pause/cancel land there.
- **PENDING human verification (Task 3, gate=blocking):** seed a subscription + open round, trigger generation, and confirm reserve-before-B2C, retry idempotency, pause/skip skipping, and the substitution Flex per the plan's how-to-verify. Automated fillBox unit + generator integration tests (10) and typechecks are green; the live end-to-end path is the only unverified item.

## Self-Check: PASSED
- All 4 created files present on disk; all 4 modified files updated.
- 3 task commits found in git log: c7c0c6b (test), 3692b59 (feat), f7aa35c (feat).
- Automated verification green: `bun test` 245 pass / 0 fail (10 new), `bunx tsc --noEmit` (api) clean, `bunx vue-tsc --noEmit` (web-admin) clean.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
