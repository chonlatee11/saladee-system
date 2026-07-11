---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 08
subsystem: ui
tags: [liff, vue, eden, subscription, b2b, standing-order, substitution, mobile]

# Dependency graph
requires:
  - phase: 03-06
    provides: "staff-gated B2B approval/wholesale/standing routes + wholesaleVisible() gate; standing_orders/standing_order_items tables"
  - phase: 03-07
    provides: "shared subscriptions pause/skip/cancel/resume (customer ownership + cut-off gate D-14); box_bom_json substitution flag; generateForRound"
  - phase: 02-line-storefront-payments-delivery
    provides: "web/ LIFF SPA — router, Eden api client, liff.ts session/idToken, cart.ts store pattern, EmptyState/BusyOverlay, mobile tokens; me-orders member guard (D-19)"
provides:
  - "web/ LIFF subscription signup (S/M/L by value + frequency) → POST /me/subscriptions"
  - "web/ LIFF subscription manage: pause/skip/cancel confirm + after-cut-off locked notice (D-14)"
  - "web/ LIFF B2B account: apply → pending gate → approved (gated wholesale prices + standing-order set)"
  - "in-order substitution detail line in OrderDetailView (D-16, pairs with 03-07 Flex push)"
  - "api customer /me endpoints: GET/POST /me/subscriptions, GET /me/b2b, POST /me/b2b/apply, GET /me/b2b/prices, GET/POST /me/standing-orders"
affects: [phase-04-web-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Customer /me/* self-service routes reuse the me-orders member gate (customer session + line_user_id, D-19) and are session-scoped (customerId = session.sub) — never a client id (T-03-20)"
    - "Subscription package value is SERVER-resolved from the S/M/L code (PACKAGE_VALUES map) — the client body carries the code only, never a money value (T-03-20)"
    - "Wholesale price + standing-order create reuse 03-06 wholesaleVisible() approval gate on the customer surface (T-03-21)"
    - "LIFF views mirror the 02-09 pattern: async setup, injectable sessionToken/loader/action props for DOM-free SSR view tests, EmptyState/BusyOverlay, mobile tokens verbatim"

key-files:
  created:
    - web/src/stores/subscription.ts
    - web/src/views/SubscriptionSignup.vue
    - web/src/views/SubscriptionManage.vue
    - web/src/views/B2bAccount.vue
    - web/tests/subscription-view.test.ts
    - web/tests/b2b-account-view.test.ts
    - api/tests/me-account.test.ts
  modified:
    - web/src/router.ts
    - web/src/views/OrderDetailView.vue
    - api/src/routes/subscriptions.ts
    - api/src/routes/b2b.ts
    - api/src/routes/me-orders.ts

key-decisions:
  - "Subscription package value is server authority (S=฿300/M=฿500/L=฿800 satang map) — the LIFF sends the CODE only, closing the T-03-20 money-tamper surface"
  - "Customer /me/* endpoints added to the EXISTING subscriptions.ts / b2b.ts routers (fill-body, not a new composed router) to respect the fixed index.ts composition-order invariant"
  - "B2B customer surface reuses 03-06 wholesaleVisible() — wholesale price + standing-order create are refused (403) until staff approve (T-03-21); UI pending gate is cosmetic only"
  - "Substitution surfaced as a single order-level boolean derived from box_bom_json (raw BOM stripped from the payload) so the in-order notice renders without leaking the fill snapshot"

patterns-established:
  - "Self-service customer route = shared derive(session) + requireMember(customer + line_user_id) + session-scoped query; mirrors me-orders"
  - "DOM-free SSR view test per LIFF screen (createSSRApp + renderToString + injected loaders) asserting each UI-SPEC state"

requirements-completed: [SALE-03, CUST-02, CUST-05]

coverage:
  - id: D1
    description: "LIFF subscription signup: pick S/M/L (by value) + frequency → POST /me/subscriptions; package value resolved server-side from the code (T-03-20)"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "api/tests/me-account.test.ts#member signs up: packageValueSatang is resolved SERVER-side from the CODE (T-03-20)"
        status: pass
      - kind: unit
        ref: "web/tests/subscription-view.test.ts#shows the package + frequency picker for a member with no subscription"
        status: pass
    human_judgment: false
  - id: D2
    description: "Subscription self-service manage: pause/skip/cancel until cut-off; after-cut-off locked notice (D-14)"
    requirement: "SALE-03"
    verification:
      - kind: unit
        ref: "web/tests/subscription-view.test.ts#shows the active box with pause / skip / cancel before cut-off"
        status: pass
      - kind: unit
        ref: "web/tests/subscription-view.test.ts#shows the after-cut-off locked notice once the cut-off has passed (D-14)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Subscription self-service is session-scoped — a member never sees/acts on another member's subscription (T-03-20 IDOR)"
    requirement: "SALE-03"
    verification:
      - kind: integration
        ref: "api/tests/me-account.test.ts#list is scoped to the session member — never another member's (T-03-20 IDOR)"
        status: pass
      - kind: integration
        ref: "api/tests/me-account.test.ts#guest (no token) → 401; a customer without a line_user_id → 403"
        status: pass
    human_judgment: false
  - id: D4
    description: "B2B account: apply → pending gate → approved; wholesale price + standing-order create gated on approval (T-03-21)"
    requirement: "CUST-02"
    verification:
      - kind: integration
        ref: "api/tests/me-account.test.ts#wholesale price is refused until approved (T-03-21)"
        status: pass
      - kind: integration
        ref: "api/tests/me-account.test.ts#apply flips a B2C member null → pending; status is readable"
        status: pass
      - kind: unit
        ref: "web/tests/b2b-account-view.test.ts#shows the pending-approval gate (D-08)"
        status: pass
    human_judgment: false
  - id: D5
    description: "B2B customer standing order (CUST-05): created for the session customer only; gated on approval"
    requirement: "CUST-05"
    verification:
      - kind: integration
        ref: "api/tests/me-account.test.ts#standing order: 403 unless approved; created for the SESSION customer (T-03-20)"
        status: pass
      - kind: unit
        ref: "web/tests/b2b-account-view.test.ts#shows wholesale prices + the standing-order CTA once approved (D-09)"
        status: pass
    human_judgment: false
  - id: D6
    description: "In-order substitution detail line (D-16) — pairs with the 03-07 member Flex push"
    verification:
      - kind: unit
        ref: "cd web && bun run build (OrderDetailView compiles the substitution notice; api me-account/order tests green)"
        status: pass
    human_judgment: true
    rationale: "The end-to-end substitution path (a generated box filled around a sold-out variety → box_bom_json.substitution=true → the notice on the real order) requires a running API + a triggered round-open generation; it is exercised in the Task-3 human-verify checkpoint. The order-level flag derivation is covered by the api suite + build."
  - id: D7
    description: "LIFF subscription + B2B customer flows verified live on mobile (LINE in-app browser)"
    verification:
      - kind: manual_procedural
        ref: "03-08-PLAN.md Task 3 checkpoint:human-verify (gate=blocking)"
        status: unknown
    human_judgment: true
    rationale: "Signup/manage/B2B flows on a real device + a live API + a seeded approved B2B account and open round are the UX/RBAC round-trip that only a human can sign off (checkpoint:human-verify, gate=blocking). Automated view tests + build + api integration tests are green; the live mobile path is the pending item."

# Metrics
duration: ~40min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 08: LIFF Subscription + B2B Customer Surface Summary

**LIFF customer surface for recurring boxes and wholesale — subscription signup (S/M/L by value + frequency), self-service pause/skip/cancel with a server-authoritative cut-off lock (D-14), and a B2B account (apply → pending gate → approved wholesale prices + standing order) — wired to new session-scoped `/me/*` endpoints that reuse the me-orders member gate and the 03-06 approval gate, plus an in-order substitution notice (D-16).**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-11
- **Tasks:** 2 auto tasks done (Task 1, Task 2); Task 3 = human-verify checkpoint (pending, gate=blocking)
- **Files created:** 7 · **Files modified:** 5

## Accomplishments
- **Subscription signup (SALE-03 / D-12):** `SubscriptionSignup.vue` — a package picker (S/M/L by value) + frequency, POSTing `/me/subscriptions`. The client sends the CODE only; the box value is resolved server-side from `PACKAGE_VALUES` (฿300/500/800), closing the money-tamper surface (T-03-20). Guest-gate · not-a-member · already-a-member states. `subscription.ts` store mirrors `cart.ts` (reactive singleton + sessionStorage, holds no money).
- **Subscription self-service manage (D-14):** `SubscriptionManage.vue` — active box + pause/skip/cancel confirm modals (UI-SPEC copy verbatim) and the after-cut-off locked notice. The server (03-07) is the authority: ownership (customerId = session) and the cut-off gate are enforced there; the UI mirrors them (skip disabled after cut-off; the API also 409s it).
- **B2B account (CUST-02 / CUST-05 / D-08/D-09):** `B2bAccount.vue` — apply (`POST /me/b2b/apply` flips B2C→pending), the pending-approval gate, rejected notice, and the approved view: wholesale prices fetched through the GATED `/me/b2b/prices` (reuses 03-06 `wholesaleVisible`, 403 until approved) + a per-variety standing-order setter POSTing `/me/standing-orders`.
- **In-order substitution notice (D-16):** `GET /me/orders/:id` now derives an order-level `substitution` boolean from the box line's `box_bom_json` (raw BOM stripped from the payload); `OrderDetailView.vue` renders the customer notice, pairing with the 03-07 member Flex push.
- **Enabling backend `/me/*` surface:** the customer-facing subscription create/list + B2B status/apply/prices/standing endpoints (handed off by 03-06/03-07 but never added) — all session-scoped, member-gated (customer + line_user_id, D-19), reusing existing gates. 6 api integration tests + 12 SSR view tests.

## Task Commits

1. **Enabling backend — customer `/me` subscription + B2B endpoints** - `1f018ee` (feat)
2. **Task 1: LIFF subscription signup + manage views + store + router** - `ab10d3e` (feat)
3. **Task 2: LIFF B2B account view + in-order substitution notice** - `9286823` (feat)

Task 3 (`checkpoint:human-verify`, gate=blocking) is pending live device verification.

## Files Created/Modified
- `web/src/stores/subscription.ts` (new) - signup draft singleton (code + frequency only)
- `web/src/views/SubscriptionSignup.vue` (new) - package/frequency picker → signup
- `web/src/views/SubscriptionManage.vue` (new) - pause/skip/cancel + cut-off lock
- `web/src/views/B2bAccount.vue` (new) - apply/pending/approved wholesale + standing
- `web/tests/subscription-view.test.ts` (new) - 7 SSR view tests
- `web/tests/b2b-account-view.test.ts` (new) - 5 SSR view tests
- `api/tests/me-account.test.ts` (new) - 6 customer-endpoint integration tests
- `web/src/router.ts` - +3 routes (/subscription, /subscription/manage, /b2b)
- `web/src/views/OrderDetailView.vue` - substitution detail line (D-16)
- `api/src/routes/subscriptions.ts` - GET/POST /me/subscriptions + PACKAGE_VALUES + member gate
- `api/src/routes/b2b.ts` - GET /me/b2b, POST /me/b2b/apply, GET /me/b2b/prices, GET/POST /me/standing-orders
- `api/src/routes/me-orders.ts` - order-level substitution flag on GET /me/orders/:id

## Decisions Made
- **Package value is server authority** — the LIFF body carries only the S/M/L code; `PACKAGE_VALUES` maps it to satang (T-03-20). A tampered client can change WHICH package, never the box value.
- **Customer endpoints fill the existing routers** — added to `subscriptions.ts`/`b2b.ts` (their own files) rather than a new composed router, respecting the fixed `index.ts` composition-order invariant.
- **Reuse the existing gates** — member gate = me-orders D-19 pattern (customer + line_user_id); wholesale/standing gate = 03-06 `wholesaleVisible` (approved-only). No new auth surface.
- **Substitution as a stripped boolean** — surfaced order-level, raw `box_bom_json` never sent to the client.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added the customer-facing `/me/*` subscription + B2B API surface**
- **Found during:** Task 1 & Task 2 (the LIFF has nothing to call)
- **Issue:** The plan's `files_modified` listed only `web/` files and assumed the customer endpoints existed. In reality 03-06/03-07 shipped ONLY staff-gated routes + the shared pause/skip/cancel — there was no customer subscription create/list, no customer B2B status/apply/prices, and no customer standing-order create. 03-06 explicitly exported `wholesaleVisible()` "for 03-08 to reuse", confirming the customer surface was delegated here but never built. Without these endpoints the signup CTA, manage load, and the entire B2B view are dead.
- **Fix:** Added session-scoped, member-gated endpoints to the existing routers: `GET/POST /me/subscriptions` (subscriptions.ts, server-resolved package value), `GET /me/b2b` · `POST /me/b2b/apply` · `GET /me/b2b/prices` · `GET/POST /me/standing-orders` (b2b.ts, reusing `wholesaleVisible`). All reuse the me-orders member gate and scope by `session.sub`.
- **Files modified:** api/src/routes/subscriptions.ts, api/src/routes/b2b.ts
- **Verification:** `api/tests/me-account.test.ts` (6 cases: server-derived value, IDOR scoping, apply, wholesale/standing approval gate) — all pass; full api suite 298 pass; `bunx tsc --noEmit` clean.
- **Committed in:** `1f018ee`

**2. [Rule 2 - Missing Critical] Exposed the substitution flag on `GET /me/orders/:id`**
- **Found during:** Task 2 (the in-order substitution notice)
- **Issue:** D-16 requires an in-order substitution detail line, but the order-detail endpoint did not select `box_bom_json`, so the view could not know a box was substituted.
- **Fix:** Added `box_bom_json` to the select, derived a single order-level `substitution` boolean, and stripped the raw BOM from the response. `OrderDetailView.vue` renders the notice.
- **Files modified:** api/src/routes/me-orders.ts, web/src/views/OrderDetailView.vue
- **Verification:** full api suite green (additive field, no regression); `web` build + view tests green.
- **Committed in:** `9286823`

---

**Total deviations:** 2 auto-fixed (both missing-critical). **Impact:** Both are the natural completion of a customer surface the phase design delegated to 03-08 but under-scoped in the plan's `files_modified`. All new endpoints are session-scoped and reuse existing gates — no new security surface, no schema change, no `index.ts` reorder.

## Issues Encountered
- `bunx vue-tsc --noEmit` (the plan's Task-1 verify command) is not wired to a local install and pulls an incompatible `vue-tsc@latest` (`ERR_PACKAGE_PATH_NOT_EXPORTED './lib/tsc'`). Used the project's actual toolchain instead: `bun run build` (vite, authoritative compile/bundle) + `bun test` DOM-free SSR view tests. Both green. Logged the missing `vue-tsc` devDep to `deferred-items.md` (out of scope to add here).

## Threat Surface
- **T-03-20 (customer edits another's subscription / standing; money tamper):** mitigated — every `/me/*` route is member-gated and scoped to `session.sub`; subscription package value is server-resolved from the code (no client money value); standing-order `customerId` is the session, never a client field. IDOR + server-value tests pass.
- **T-03-21 (B2B price before approval):** mitigated — `/me/b2b/prices` and `POST /me/standing-orders` reuse `wholesaleVisible()` (approved-only, 403 otherwise); the UI pending gate is cosmetic. Test asserts pending→403, approved→200.
- **T-03-22 (edit after cut-off):** mitigated — the cut-off gate is the 03-07 server authority (customer skip 409s after cut-off); the manage view mirrors it with the D-14 locked notice + disabled skip.
- No new security surface beyond the plan's threat register; no schema migration.

## User Setup Required
None for the code. The Task-3 checkpoint needs a running API (:3000) + `web` LIFF (dev or preview) with: a logged-in LINE member, at least one open round, and (for the B2B path) a staff-approved B2B account + a b2b-tier price seeded for the round.

## Next Phase Readiness
- SALE-03 / CUST-02 / CUST-05 customer surfaces shipped in LIFF; phase back-office + admin (03-06/03-07) + this customer surface complete the requirements.
- Customer `/me/*` endpoints are the reusable contract for the Phase-4 web store (same session/gate model).
- **PENDING human verification (Task 3, gate=blocking):** on a device / LIFF preview — sign up for a box, pause/skip/cancel before and after cut-off (confirm the lock), and run the B2B path (pending gate → after admin approval see wholesale prices → set a standing order). Automated api integration (6) + SSR view tests (12) + build are green; the live mobile round-trip is the only unverified item.
- **Deferred (out of scope):** `web/catalog GET /` returns the `b2b` tier price in its payload unconditionally — a potential pre-existing wholesale-price exposure unrelated to this task; logged to `deferred-items.md` for a follow-up review. `vue-tsc` is not a local devDep (see Issues).

## Self-Check: PASSED
- All 7 created files present on disk; all 5 modified files updated.
- 3 task commits in git log: 1f018ee (feat), ab10d3e (feat), 9286823 (feat).
- Automated verification green: api `bun test` 298 pass / 0 fail (6 new), `bunx tsc --noEmit` (api) clean; web `bun test` 30 pass / 0 fail (12 new), `bun run build` (vite) clean.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*
