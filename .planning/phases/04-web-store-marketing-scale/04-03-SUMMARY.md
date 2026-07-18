---
phase: 04-web-store-marketing-scale
plan: 03
subsystem: payments
tags: [coupons, loyalty, promptpay, drizzle, elysia, vue, tanstack-query]

# Dependency graph
requires:
  - phase: 04-01
    provides: "migration 0005 (coupons, coupon_redemptions, loyalty_ledger, orders.discount_satang) + loyalty/pdpa HOT_KEYS"
  - phase: 04-02
    provides: "frozen inert stub routers (coupons.ts, loyalty.ts) + web-admin routes (CouponComposer.vue, LoyaltySettings.vue) + OWNER_ADMIN nav"
  - phase: 01-commerce-core
    provides: "reserve() guarded UPDATE, POST /orders tx, order-transition applyTransition, PromptPay payload builder"
  - phase: 02-payments
    provides: "payments.ts slip-verify → paid path, isUniqueViolation 23505 arbiter, settings hot-config, me-orders member gate"
provides:
  - "coupon.ts redeemCouponGuarded() — guarded global-limit UPDATE + UNIQUE per-customer arbiter"
  - "loyalty.ts earnPoints()/redeemPointsGuarded()/getBalance() — append-only ledger, idempotent earn"
  - "orders.ts checkout composes coupon+points discount pre-QR (whole-baht net); payments.ts expected-amount subtracts discount"
  - "order-transition.ts earns loyalty points once on entering paid (in-tx, idempotent)"
  - "coupons.ts admin CRUD (owner|admin); loyalty.ts member balance route"
  - "CouponComposer.vue + LoyaltySettings.vue admin surfaces"
affects: [04-04, 04-05, 04-10, web-store, verify-phase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coupon global-limit as a DB property via guarded conditional UPDATE (mirrors reserve())"
    - "Per-customer cap = UNIQUE(coupon,customer) row; 23505 IS 'already used' (payments dedup idiom)"
    - "Loyalty balance = SUM of an append-only ledger; earn idempotent via partial UNIQUE(order_id) WHERE kind='earn'"
    - "Discount composes INSIDE the existing order tx after reserve + order insert, before the net PromptPay QR (no second reservation path)"
    - "Client sends only couponCode + bounded redeemPoints; server resolves every satang (T-04-07)"

key-files:
  created:
    - api/src/services/coupon.ts
    - api/src/services/loyalty.ts
    - api/tests/coupon.test.ts
    - api/tests/coupon-race.test.ts
    - api/tests/loyalty.test.ts
    - api/tests/checkout-discount.test.ts
  modified:
    - api/src/routes/orders.ts
    - api/src/routes/payments.ts
    - api/src/services/order-transition.ts
    - api/src/routes/coupons.ts
    - api/src/routes/loyalty.ts
    - api/src/routes/settings.ts
    - web-admin/src/views/CouponComposer.vue
    - web-admin/src/views/LoyaltySettings.vue

key-decisions:
  - "redeemCouponGuarded takes orderId (coupon_redemptions.order_id is NOT NULL + FK) — plan's 5-arg shape widened to 6"
  - "redeemPointsGuarded takes payableSatang so the point discount caps at the amount still owed after any coupon"
  - "Discount applied only on the checkout (delivery) path; the legacy `created` path carries no QR/discount"
  - "settings PUT closed schema extended with loyaltyEarnRate/loyaltyPointBaht so LoyaltySettings can save economics (schema stays closed)"

patterns-established:
  - "Guarded-UPDATE money gate: correctness is a DB property, service throws OrderError to roll back the whole order tx"
  - "In-tx earn-on-paid inside applyTransition (durable), never the fire-and-forget notifier"

requirements-completed: [MKT-01, CUST-03]

coverage:
  - id: D1
    description: "Coupon redemption is money-safe: guarded global-limit UPDATE + UNIQUE per-customer cap, whole-baht discount, expiry/min/applicability guards"
    requirement: "MKT-01"
    verification:
      - kind: integration
        ref: "api/tests/coupon.test.ts#redeemCouponGuarded — money-safe coupon redemption (MKT-01)"
        status: pass
      - kind: integration
        ref: "api/tests/coupon-race.test.ts#N=8 concurrent redemptions of a limit-1 coupon → exactly 1 success"
        status: pass
    human_judgment: false
  - id: D2
    description: "Loyalty ledger: earn once per order (idempotent, guest never earns), redeem bounded/capped, balance = SUM"
    requirement: "CUST-03"
    verification:
      - kind: integration
        ref: "api/tests/loyalty.test.ts#earnPoints/redeemPointsGuarded (CUST-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Checkout composes coupon+points into a whole-baht net QR; discounted expected amount auto-pays; earn fires once on paid"
    requirement: "MKT-01"
    verification:
      - kind: integration
        ref: "api/tests/checkout-discount.test.ts#percent coupon + points → whole-baht net QR, discounted expected amount auto-pays, earn once"
        status: pass
    human_judgment: false
  - id: D4
    description: "Coupon admin CRUD gated owner|admin; loyalty balance route member-gated"
    requirement: "MKT-01"
    verification:
      - kind: integration
        ref: "api/tests/coupon.test.ts#coupon admin routes — RBAC + CRUD (T-04-10 / V4)"
        status: pass
      - kind: integration
        ref: "api/tests/loyalty.test.ts#GET /loyalty/balance — member-gated (CUST-03 / D-19)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CouponComposer + LoyaltySettings admin views render and build (no longer stubs)"
    requirement: "MKT-01"
    verification:
      - kind: automated_ui
        ref: "cd web-admin && bun run build (CouponComposer + LoyaltySettings chunks emitted, vue-tsc clean)"
        status: pass
    human_judgment: true
    rationale: "Build proves the SFCs compile/type; visual layout, accent-only-on-CTA discipline, and Thai copy need a human glance in UAT."

# Metrics
duration: 23min
completed: 2026-07-18
status: complete
---

# Phase 4 Plan 03: Coupons + Loyalty Money Slice Summary

**Coupon (guarded global-limit UPDATE + UNIQUE per-customer cap) and loyalty points (append-only ledger, idempotent earn) compose into the existing POST /orders tx and PromptPay path, keeping the whole-baht QR + expected-amount invariants; admin coupon CRUD + loyalty economics surfaces shipped.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-07-18T06:35Z (approx)
- **Completed:** 2026-07-18T06:56Z
- **Tasks:** 3
- **Files modified:** 14 (6 created, 8 modified)

## Accomplishments
- `redeemCouponGuarded()` — a guarded conditional UPDATE makes the global usage cap a DB property (mirrors `reserve()`), the `UNIQUE(coupon,customer)` row is the per-customer arbiter (23505 → `coupon_already_used`), and discounts are floored to whole baht. Proven by an N=8 over-redemption race (exactly 1 winner).
- `earnPoints()/redeemPointsGuarded()/getBalance()` — append-only ledger; earn is idempotent per order (partial `UNIQUE(order_id) WHERE kind='earn'`), a guest never earns, redeem is bounded by balance and capped at the payable.
- Checkout composition: coupon + points resolve INSIDE the order tx (after `reserve()`, after the order insert), the net stays whole baht (`netSatang % 100 === 0`), the PromptPay QR encodes the discounted amount, and `payments.ts` subtracts the discount in BOTH the GET-qr total and the slip expected amount so a discounted order auto-pays.
- Entering `paid` credits loyalty points once, in-tx, via `applyTransition`.
- Owner|admin coupon CRUD + member-gated loyalty balance route + `CouponComposer.vue` (DataTable + create form + deactivate confirm) and `LoyaltySettings.vue` (earn-rate/point-value hot config).

## Task Commits

1. **Task 1 (RED): failing coupon + loyalty tests** - `545f56d` (test)
2. **Task 1 (GREEN): coupon.ts + loyalty.ts services** - `6db944c` (feat)
3. **Task 2: compose discount into checkout + earn-on-paid** - `e908ee7` (feat)
4. **Task 3: coupon admin CRUD + loyalty route + admin views** - `527d405` (feat)

## Files Created/Modified
- `api/src/services/coupon.ts` - redeemCouponGuarded (guarded UPDATE + 23505 arbiter, whole-baht discount)
- `api/src/services/loyalty.ts` - earnPoints/redeemPointsGuarded/getBalance (append-only ledger, hot economics)
- `api/src/routes/orders.ts` - accept couponCode/redeemPoints; discount pre-QR; net whole-baht assert; persist discount
- `api/src/routes/payments.ts` - GET-qr total + slip expectedAmountSatang subtract discount_satang
- `api/src/services/order-transition.ts` - earn-on-paid branch (in-tx, idempotent)
- `api/src/routes/coupons.ts` - owner|admin create/list/deactivate
- `api/src/routes/loyalty.ts` - member-gated GET /loyalty/balance
- `api/src/routes/settings.ts` - loyaltyEarnRate/loyaltyPointBaht added to the closed PUT schema
- `web-admin/src/views/CouponComposer.vue` - coupon roster + create form + deactivate confirm
- `web-admin/src/views/LoyaltySettings.vue` - loyalty economics hot-config form
- `api/tests/{coupon,coupon-race,loyalty,checkout-discount}.test.ts` - invariant + race + RBAC tests

## Decisions Made
- **redeemCouponGuarded(…, orderId):** `coupon_redemptions.order_id` is NOT NULL + FK, so the service needs the orderId to record a redemption — the plan's 5-arg signature was widened to 6 (redemption row references the order).
- **redeemPointsGuarded(…, payableSatang):** capping the point discount at the amount still owed (after any coupon) requires the payable, so the signature carries it.
- **Discount only on the checkout path:** coupon/points apply where a QR + payment exist; the legacy `created` staff path is untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] settings PUT closed schema rejected the loyalty keys**
- **Found during:** Task 3 (LoyaltySettings.vue)
- **Issue:** `HotSettingsPatchSchema` in `settings.ts` is a closed object (`additionalProperties:false`) over only the four original hot fields, so a PUT carrying `loyaltyEarnRate`/`loyaltyPointBaht` failed `Value.Check` → 422 — LoyaltySettings could never save. (04-01 added the keys to `HOT_KEYS` + `getHotSettings` but not to the route's write schema.)
- **Fix:** Added `loyaltyEarnRate`/`loyaltyPointBaht` (both `t.Number({minimum:0})`, optional) to `HotSettingsPatchSchema`. The schema stays closed — a secret-shaped key is still a 422.
- **Files modified:** api/src/routes/settings.ts (not in the plan's file list)
- **Verification:** settings.test.ts green (unknown/secret key still 422); LoyaltySettings.vue saves via api.settings.put.
- **Committed in:** `527d405` (Task 3 commit)

**2. [Rule 3 - Blocking] Service signatures widened for NOT-NULL FK + payable cap**
- **Found during:** Task 1/2
- **Issue:** `coupon_redemptions.order_id` is NOT NULL + FK (redeemCouponGuarded needs orderId); point-discount capping needs the payable amount.
- **Fix:** `redeemCouponGuarded(tx, code, customerId, subtotalSatang, tier, orderId)` and `redeemPointsGuarded(tx, customerId, orderId, points, payableSatang)`.
- **Files modified:** api/src/services/coupon.ts, api/src/services/loyalty.ts, api/src/routes/orders.ts
- **Verification:** coupon/loyalty/checkout-discount tests green.
- **Committed in:** `6db944c`, `e908ee7`

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking).
**Impact on plan:** Necessary to complete the delivery; no scope creep. The reservation guard and all existing transitions are untouched (full suite 325/325 green).

## Issues Encountered
None beyond the deviations above.

## TDD Gate Compliance
- **Task 1:** explicit RED (`545f56d`, failing tests) → GREEN (`6db944c`, services). Gate honored.
- **Task 2:** test + implementation committed together (`e908ee7`) — the whole checkout-composition change was verified green (checkout-discount.test.ts + full suite) in one atomic commit rather than a separate RED. No RRED-then-GREEN split; behavior fully covered.
- **Task 3:** `type="auto"` (not TDD); RBAC/CRUD tests added alongside the routes.

## Verification
- `bun test` full backend suite: **325 pass / 0 fail** (58 files).
- `bun tsc --noEmit`: no errors.
- `cd web-admin && bun run build`: builds; CouponComposer + LoyaltySettings emit chunks.
- Threat register: T-04-06 (race), T-04-07 (client-resolved money), T-04-08 (expected-amount desync), T-04-09 (fractional QR), T-04-10 (admin RBAC), T-04-11 (guest guard) all covered by tests.

## User Setup Required
None - no external service configuration required. Loyalty economics default to 1 point / 100 baht and 1 baht / point; the owner can retune them in the สะสมแต้ม admin screen.

## Next Phase Readiness
- The money slice (Success Criterion 2) is complete without touching the oversell guard.
- Web-store checkout (04-04+) can call the SAME `POST /orders` with `couponCode`/`redeemPoints`; the customer-facing coupon field + points block (UI-SPEC copy) are the next surfaces.

## Self-Check: PASSED

All created files present on disk; all four task commits (`545f56d`, `6db944c`, `e908ee7`, `527d405`) exist in history.

---
*Phase: 04-web-store-marketing-scale*
*Completed: 2026-07-18*
