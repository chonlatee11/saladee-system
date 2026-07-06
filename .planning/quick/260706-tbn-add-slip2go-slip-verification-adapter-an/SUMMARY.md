---
type: quick
slug: add-slip2go-slip-verification-adapter-an
quick_id: 260706-tbn
date: 2026-07-06
status: complete
---

# Summary — Add Slip2Go slip-verification adapter (new default)

Switched slip verification from SlipOK to Slip2Go, using the existing pluggable
`SlipVerifier` seam (02-06 / D-01) — `payments.ts` is untouched. SlipOK stays
selectable via `SLIP_VERIFY_PROVIDER=slipok`.

Contract from the user's Slip2Go API v1.2 PDF: base `https://connect.slip2go.com/api`,
auth `Authorization: Bearer {apiSecret}`, endpoints `POST /verify-slip/qr-code/info`
(JSON) and `POST /verify-slip/qr-image/info` (multipart). Every logical outcome is
HTTP 200 with a String `code`.

## Changes

- **api/src/services/slip-verify/slip2go.adapter.ts** (new) — `Slip2GoAdapter`
  implementing `SlipVerifier`. Sends `checkReceiver:[{accountNumber: PROMPTPAY_PAYEE_ID}]`
  (reuses the merchant payee, no new config) + `checkAmount:{type:"eq"}` +
  `checkDuplicate:true`. Code → outcome map:
  - `200000`/`200200` → clean (then re-check the satang ourselves, D-03)
  - `200401` → wrong_payee · `200402` → wrong_amount · `200404` → not_a_slip ·
    `200501` → duplicate
  - `200403` (date) / unknown code / 401 / 429 / 5xx / network → **unavailable**
    (admin review, D-04 — never auto-pay on ambiguity, never hard-reject on the unknown)
  - Secret is env-only, ridden in the `Authorization` header, never bodied/logged.
- **api/src/services/slip-verify/index.ts** — added `case "slip2go"` (first) in the
  provider switch.
- **api/src/env.ts** — `SLIP_VERIFY_PROVIDER` default `slipok` → `slip2go`; added
  `SLIP2GO_API_SECRET` (default `""`, like the SlipOK creds).
- **api/tests/slip2go-verify.test.ts** (new) — 13 tests over the full outcome union
  with an injected fetch stub (no live account).

## Verification

- `bun test tests/slip2go-verify.test.ts` → 13 pass. `bun test tests/slip-verify.test.ts`
  (SlipOK, still selectable) → 9 pass. `bunx tsc --noEmit` → exit 0.
- The 2 failing tests in the slip suite (slip-dedup, verified-slip-park) are DB
  integration tests needing PostgreSQL on :55432 (not run locally) — unrelated to
  this change and do not reference slip2go.

## Follow-up (prod)

- Set `SLIP2GO_API_SECRET` in `/opt/saladee/api/.env` (from Slip2Go "API Connect"),
  add the VPS IP to Slip2Go's IP Whitelist, recreate the api container.
- Resume Phase 2 UAT test 3 (slip auto-verification) against the live Slip2Go account.
