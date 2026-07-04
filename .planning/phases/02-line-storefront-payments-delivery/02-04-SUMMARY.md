---
phase: 02-line-storefront-payments-delivery
plan: 04
subsystem: checkout-payments
tags: [promptpay, qr, emvco, checkout, delivery-snapshot, pg-boss, hold-expiry, pdpa, consent, elysia, typebox]
status: complete

requires:
  - "02-01: orders hold/qr/delivery snapshot columns, consent_logs table, pg-boss hold-expiry queue, OrderError/applyTransition"
  - "02-03: computeDeliveryFee + allowedMethodsForCart + deliveryConfig (server-authoritative fee/freshness)"
provides:
  - "buildPromptPayPayload + renderQrDataUrl (api/src/services/promptpay.ts) — EMVCo QR, CRC from library"
  - "POST /orders as the LINE checkout: delivery snapshot + awaiting_payment + QR + hold schedule (optional delivery block)"
  - "GET /orders/:id/qr (api/src/routes/payments.ts) — idempotent QR re-fetch; EXTENDED by 02-06 with POST /slip"
  - "logConsent(tx, ...) (api/src/services/consent.ts) — two-row usage+marketing PDPA logging"
  - "HoldExpiryScheduler DI seam on makeOrdersRoutes(db, scheduler) for worker-free testing"
affects:
  - "02-06 slip-verify EXTENDS payments.ts (POST /orders/:id/slip); reads awaiting_payment + qrPayload"
  - "02-07 hold-expiry job/sweep reads orders.holdExpiresAt (the authoritative deadline scheduled here)"

tech-stack:
  added: [promptpay-qr@0.5.0, qrcode@1.5.4, "@types/qrcode@1.5.6"]
  patterns:
    - "Pure lib-wrap service (promptpay.ts mirrors pricing.ts) — CRC never hand-rolled"
    - "Checkout behaviour gated on presence of a delivery choice — preserves Phase-1 created semantics for the legacy/staff path (zero test regressions)"
    - "Injected HoldExpiryScheduler so route tests assert scheduling without a running pg-boss worker; post-commit best-effort schedule (T-02-14 self-heals via 02-07 sweep)"
    - "Consent logged inside the order tx (atomic with the order) as two independent rows (D-26)"

key-files:
  created:
    - api/src/services/promptpay.ts
    - api/src/routes/payments.ts
    - api/src/services/consent.ts
    - bruno/Saladee/payments/create-order-with-qr.bru
  modified:
    - api/src/routes/orders.ts
    - api/src/index.ts
    - api/tests/promptpay.test.ts
    - api/tests/hold-idempotent.test.ts
    - api/tests/consent.test.ts
    - api/package.json
    - bun.lock

key-decisions:
  - "Delivery + consent are OPTIONAL request blocks; the full checkout behaviour (fee snapshot, awaiting_payment, QR, hold schedule, consent) activates only when a delivery choice is supplied — exactly what the LIFF checkout always sends. Forcing all orders to awaiting_payment would have broken the Phase-1 concurrent-cancel oversell tests (which assert entry status 'created'). This preserves the crown-jewel oversell proof with zero edits."
  - "Golden CRC vector pinned AND independently re-derived (CRC-16/CCITT-FALSE) in the test, so the payload's checksum is proven, not merely equal to the library's own output."
  - "Hold-expiry scheduling is a post-commit best-effort (T-02-14): a scheduling failure never rolls back the committed order; holdExpiresAt is snapshotted and the 02-07 sweep is the authoritative self-heal."

requirements-completed: [ORD-01, PAY-01, DEL-04, PLAT-04]

metrics:
  duration: ~30m
  completed: 2026-07-04
  tasks: 3
  files_created: 4
  files_modified: 7
  tests: "162 pass / 11 todo / 0 fail (full suite); +promptpay 3, +hold-idempotent 2, +consent 3"
---

# Phase 2 Plan 4: LINE Checkout — PromptPay QR, Delivery Snapshot, Hold Schedule, Consent Summary

Turned `POST /orders` into the real LINE checkout: when a delivery choice is supplied it re-enforces the freshness intersection, re-computes the fee server-side, snapshots delivery_method/zone/fee, lands the order `awaiting_payment`, builds+stores an amount-specified PromptPay QR for the **full total** (subtotal + fee), schedules the hold-expiry timer once (singletonKey=orderId), and logs PDPA usage+marketing consent — all in one flow. Added the idempotent `GET /orders/:id/qr` re-fetch. Covers ORD-01, PAY-01, DEL-04, PLAT-04 and the creation half of PAY-03.

## What was built

**Task 1 — PromptPay QR service (golden CRC vector)** — commit `4d39328`
- `api/src/services/promptpay.ts`: `buildPromptPayPayload(payeeId, amountBaht)` wraps `promptpay-qr`'s `generatePayload` (EMVCo payload incl. CRC-16 — **never hand-rolled**); `renderQrDataUrl(payload)` renders a PNG data URL via `qrcode`. Satang→baht conversion happens once at this boundary.
- `api/tests/promptpay.test.ts`: pins a golden EMVCo string for payee `0899999999` @ ฿100.00 (`…6304CB89`) so a single wrong byte fails, AND independently re-derives the trailing CRC-16 (CRC-16/CCITT-FALSE) to prove the checksum. Also asserts the QR amount = (subtotal+fee)/100 (Pitfall 5) and that `renderQrDataUrl` returns a `data:image/png;base64,` URL.
- Deps: `promptpay-qr@0.5.0`, `qrcode@1.5.4`, `@types/qrcode@1.5.6` (RESEARCH-approved).

**Task 2 — checkout POST /orders + idempotent QR re-fetch** — commit `78c472f`
- `api/src/routes/orders.ts`: extended `CreateOrderBody` with optional `deliveryMethod` (4-method union) + `deliveryZone`. When both are present (a real checkout): re-enforce `allowedMethodsForCart` (T-02-13 → 422 `method_not_allowed_freshness`), recompute `computeDeliveryFee` (T-02-12; unavailable pair → 422 `method_not_available_in_zone`), set total = subtotal+fee, land `awaiting_payment`, snapshot `deliveryMethod/deliveryZone/deliveryFeeSatang/holdExpiresAt/qrPayload`, build the QR for total/100 (T-02-16 / Pitfall 5). After commit, render the QR and schedule `hold-expiry` with `singletonKey=orderId` via an injected `HoldExpiryScheduler` (best-effort; T-02-14).
- `api/src/routes/payments.ts` (NEW): `GET /orders/:id/qr` re-renders the SAME stored `qrPayload` with remaining hold time — never regenerates, never mutates `holdExpiresAt`, never schedules a second timer (D-11). 404 unknown order, 409 `no_qr` for a legacy/non-checkout order. Composed in `index.ts` via `.use(paymentsRoutes)` (appended).
- `api/tests/hold-idempotent.test.ts`: checkout lands `awaiting_payment` with fee-inclusive QR (`70.00` not `50.00`), snapshot columns set, and the scheduler fires **exactly once**; two `GET /qr` calls return identical payloads and add no second timer; a legacy no-delivery order returns 409 `no_qr`.
- `bruno/Saladee/payments/create-order-with-qr.bru`: the checkout request shape.

**Task 3 — PDPA consent logging at checkout** — commit `1aadae5`
- `api/src/services/consent.ts`: `logConsent(tx, {...})` inserts TWO independent rows — `usage` + `marketing` — each with `policyVersion` + `source="checkout"` (D-25/26 / T-02-15).
- `api/src/routes/orders.ts`: `CreateOrderBody.consent` (optional `{ usage, marketing, policyVersion }`); rejects `422 usage_consent_required` when `usage !== true` (before the tx, before personal data is trusted); logs both rows inside the order tx (atomic with the order). Marketing logged independently of its value.
- `api/tests/consent.test.ts`: usage=true/marketing=false → exactly two rows with the policy version + source; marketing=true logged as a granted marketing row; usage=false → 422 with no rows written.

## Verification
- `bunx tsc --noEmit` → clean.
- `bun test tests/promptpay.test.ts tests/consent.test.ts tests/hold-idempotent.test.ts` → 8 pass / 0 fail.
- Full suite `bun test` → **162 pass / 11 todo / 0 fail** (was 125/20 after 02-01) — the 3 filled scaffolds are green and NO Phase-1 order test regressed.
- Acceptance greps: `generatePayload`≥1 (lib, not hand-rolled); `awaiting_payment`, `deliveryFeeSatang|deliveryMethod`, `singletonKey` present in orders.ts; `/orders/:id/qr` present in payments.ts; `marketing` present in consent.ts.

## Threat mitigations applied
- **T-02-12 (client-spoofed fee/QR amount):** no money field is accepted; fee recomputed via `computeDeliveryFee` from the committed config; QR amount = server total.
- **T-02-13 (freshness-disallowed method):** `allowedMethodsForCart` re-enforced at checkout → 422 (not only in the quote).
- **T-02-14 (commit-then-crash strands stock):** `holdExpiresAt` snapshotted; scheduling is post-commit best-effort; 02-07 sweep is the authoritative self-heal.
- **T-02-15 (disputed consent):** two consent_logs rows with policyVersion + timestamp per order.
- **T-02-16 (QR under-collects delivery):** QR amount = subtotal + fee; proven by the `70.00`-not-`50.00` assertion.

## Deviations from Plan

**1. [Rule 3 — blocking design] Delivery + consent are OPTIONAL blocks; checkout behaviour is gated on their presence**
- **Found during:** Task 2.
- **Issue:** The plan's literal reading (delivery required, all orders → `awaiting_payment`) would break the Phase-1 order tests — `cancel-release.test.ts` (the concurrent-cancel oversell crown jewel) and `order-snapshot.test.ts` assert the entry status is `created` and drive `created→awaiting_payment` transitions. 7 order-creating test files use the pre-delivery contract.
- **Fix:** Made `deliveryMethod`/`deliveryZone` and `consent` optional. The full checkout (fee snapshot, `awaiting_payment`, QR, hold, consent) activates ONLY when a delivery choice is supplied — exactly what the LIFF checkout always sends. Orders without a delivery choice keep the Phase-1 `created` path untouched. RESEARCH/PATTERNS explicitly allow this ("Set awaiting_payment … OR emit created then transition"). Every must_have holds for real checkouts; zero Phase-1 regressions.
- **Files:** api/src/routes/orders.ts
- **Commit:** 78c472f

**2. [Rule 3 — path correction] Tests placed under api/tests/ (repo convention), not the plan's api/test/**
- **Found during:** all tasks.
- **Issue:** The plan text wrote `api/test/…`; the repo convention is `api/tests/…` (the Wave-0 scaffolds already live there).
- **Fix:** Filled the existing `api/tests/{promptpay,hold-idempotent,consent}.test.ts` scaffolds.
- **Commit:** 4d39328 / 78c472f / 1aadae5

**3. [Rule 1 — TypeBox usage] `t.Boolean()` / `t.String()` must be called**
- **Found during:** Task 3 (tsc + Elysia schema compile).
- **Issue:** `t.Boolean` as a bare reference is a function, not a TSchema — Elysia failed to build the validator.
- **Fix:** Called `t.Boolean()` for the consent fields.
- **Commit:** 1aadae5

## Known Stubs
None. `promptpay.ts`, `payments.ts`, and `consent.ts` are fully wired against the real schema/config; the QR, hold schedule, and consent rows are produced on the real checkout path.

## Deferred Items
- **PROMPTPAY_PAYEE_ID (production value):** tests use the dummy `0000000000` already in `.env.test`. The real payee id (phone/national id) must be set in the deployed env before production checkout — the executor cannot write `.env*` (harness-locked). **Operator action:** set `PROMPTPAY_PAYEE_ID` to the real payee before go-live.
- **PAY-03 expiry half:** the hold-expiry job handler + safety-net sweep that read `orders.holdExpiresAt` are 02-07 (this plan schedules the timer + snapshots the deadline).
- **D-27 (self-serve PDPA access/deletion):** MVP is admin-manual per plan; the privacy-policy doc must state data access/deletion is admin-manual (no self-serve endpoint).

## Requirements covered
ORD-01 (order lands in the single backend), PAY-01 (PromptPay QR with correct CRC), DEL-04 (delivery choice at checkout, fee snapshot), PLAT-04 (PDPA consent logging). Creation half of PAY-03 (hold scheduled + holdExpiresAt snapshotted) — full PAY-03 closed by 02-07.

## Self-Check: PASSED
- FOUND: api/src/services/promptpay.ts, api/src/routes/payments.ts, api/src/services/consent.ts, bruno/Saladee/payments/create-order-with-qr.bru
- FOUND commits: 4d39328, 78c472f, 1aadae5

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
