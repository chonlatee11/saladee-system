---
phase: quick-vr5-line-member-order-linkage
plan: 01
subsystem: line-checkout
tags: [line, checkout, orders, member, pdpa, uat-4]
requires: [customers.line_user_id (D-04), member session gating (D-19), recipient snapshot columns (D-21)]
provides: [member-linked order.customer_id, member recipient snapshot on LINE checkout]
affects: [POST /orders member path, LIFF checkout body, order history/detail, status push]
tech-stack:
  added: []
  patterns: [optional-on-schema + null-coalesce backward-compatible contract change, discriminated OrderBody union guest|member]
key-files:
  created:
    - api/tests/member-checkout-linkage.test.ts
    - web/tests/member-checkout.test.ts
  modified:
    - api/src/routes/orders.ts
    - web/src/liff.ts
    - web/src/lib/checkout.ts
    - web/src/views/CheckoutWizard.vue
decisions:
  - Recipient fields on MemberCustomer are OPTIONAL (t.Optional + minLength:1) so a legacy { customerId }-only body still validates 201; missing fields coalesce to null.
  - buildOrderBody keys off an optional customerId opt — present => member customer object, absent => byte-identical guest body.
  - loginWithLine persists customerId; setSessionToken(null) also clears it so a logged-out client always falls back to the guest body.
metrics:
  duration: ~35m
  completed: 2026-07-06
status: complete
---

# Phase quick-vr5 Plan 01: Wire LINE Member Order Linkage Summary

Member LINE checkout now binds `order.customer_id` to the logged-in member's customer id (which bears `line_user_id`) and snapshots `recipient_name/phone/address` from the checkout form, via an optional-on-schema + null-coalesce contract change — closing Phase-2 UAT-4 (empty order history/detail + no status push) while keeping the guest path byte-identical and touching no money/stock/consent logic.

## What Was Built

- **`api/src/routes/orders.ts`** — `MemberCustomer` TypeBox schema gains three OPTIONAL `minLength:1` recipient fields (`recipientName/recipientPhone/recipientAddress`); the narrowed `cust` member arm gains matching optional types; the transaction's member branch assigns the recipient locals from `cust.* ?? null`. The order insert already snapshots those locals (D-21), so persistence flows with no insert change. Guest `else` branch untouched.
- **`api/tests/member-checkout-linkage.test.ts`** (new) — real-PG DI harness modelled on `reorder.test.ts`. Test A: a member checkout (`self`/`samut_prakan` + consent) returns 201 `awaiting_payment`, and the order row has `customer_id === memberId` plus the three recipient columns set. Test B: a bare `{ customerId }` body still 201 (`created`) with NULL recipients.
- **`web/src/liff.ts`** — `CUSTOMER_KEY` + `getCustomerId()`/`setCustomerId()`; `loginWithLine` persists `data.customerId`; `setSessionToken(null)` also clears the customer id.
- **`web/src/lib/checkout.ts`** — `OrderBody.customer` widened to `GuestOrderCustomer | MemberOrderCustomer`; `buildOrderBody` takes an optional `customerId` and emits the member customer object when set, else the exact guest object as before.
- **`web/src/views/CheckoutWizard.vue`** — imports `getCustomerId`, passes `customerId: getCustomerId() ?? undefined` into `buildOrderBody`.
- **`web/tests/member-checkout.test.ts`** (new, plan-checker advisory) — (a) member `customerId` => `{ customerId, recipientName, recipientPhone, recipientAddress }`; (b) no `customerId` (and `undefined`) deep-equals today's guest body; (c) `loginWithLine` persists the id and `setSessionToken(null)` clears it (in-memory localStorage shim + mocked `./api` and `@line/liff`).

## Verification

- `cd api && bun test` — **201 pass, 1 fail**. The single failure is `tests/storage.test.ts`, which requires MinIO at `localhost:9000` (not running locally) — an infra-only failure, unrelated to this change. All money/oversell/reservation/consent tests, `reorder.test.ts`, `order-snapshot`, and the new `member-checkout-linkage.test.ts` (2/2) are green. Ran against an ephemeral `postgres:17` container on `:55432`.
- `cd web && bunx vue-tsc --noEmit` — clean.
- `bun run --cwd web build` — LIFF static build succeeds.
- `cd web && bun test` — 18/18 pass (guest byte-identity assertion in `checkout-wizard.test.ts` stays green; no mock leakage into sibling files).

## Deviations from Plan

None — plan executed as written, plus the plan-checker advisory (`web/tests/member-checkout.test.ts`) implemented.

## Security / Money Path

No client-sent money field added. Atomic stock reservation (NFR-02), server-side price/fee re-resolution, and PDPA usage-consent gating are unchanged. Threat register dispositions hold: T-VR5-02 (money tampering) mitigated — new body fields are identity + recipient strings only, verified by the money/oversell tests staying green; T-VR5-01 (customerId spoofing) accepted per existing D-03/D-19 design (POST /orders stays open; member-only surfaces remain session-gated by line_user_id).

## Notes for Follow-up

- The api DB-backed suite requires a Postgres 17 instance on `:55432` (env `TEST_DATABASE_URL_DIRECT`) and MinIO on `:9000` for `storage.test.ts`; neither is provisioned in-repo. An ephemeral container was used here for verification.

## Self-Check: PASSED
