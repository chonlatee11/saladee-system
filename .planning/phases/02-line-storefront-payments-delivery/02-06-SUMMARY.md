---
phase: 02-line-storefront-payments-delivery
plan: 06
subsystem: slip-verify-payments
tags: [slipok, slip-verify, adapter-seam, dedup, promptpay, r2, private-bucket, sharp, applyTransition, admin-confirm, pdpa]
status: complete

requires:
  - "02-01: payments table (status/transRef/amountSatang/rejectReason/slipKey/rawJson) + partial UNIQUE payments_trans_ref_idx; OrderError/applyTransition; SLIPOK_*/SLIP_VERIFY_PROVIDER env defaults"
  - "02-04: makePaymentsRoutes(db) + GET /orders/:id/qr (EXTENDED here); awaiting_payment checkout + qrPayload snapshot"
  - "00-03: storage.plugin (private R2 S3Client, presignPut/presignGet 300s)"
provides:
  - "SlipVerifier seam (api/src/services/slip-verify/{types,slipok.adapter,index}.ts) — swappable slip-verification vendor, env-selected via SLIP_VERIFY_PROVIDER"
  - "POST /orders/:id/slip — compress → private R2 → verify → paid/awaiting_review/rejected; system-wide transRef dedup"
  - "POST /orders/:id/confirm-payment (admin) — manual confirm for parked orders (D-04)"
  - "GET /orders/:id/slip (admin) — short-lived signed GET URL to view a private slip (D-28)"
affects:
  - "02-07 hold-expiry sweep reads payments.status='awaiting_review' to no-op an under-review order (must not auto-cancel a pending slip)"
  - "02-07 notify hook fires post-commit off the clean slip→paid applyTransition"

tech-stack:
  added: [sharp@0.35.2]
  patterns:
    - "Adapter seam (D-01): call sites import only the SlipVerifier interface from slip-verify/index.ts; the concrete vendor is an env-selected switch — SlipOK swappable with zero payments.ts edits"
    - "Money-safe default mapping: any unrecognized/quota/5xx/network response → 'unavailable' → admin review; never auto-pay on ambiguity, never hard-reject a possibly-valid payment"
    - "Exact-satang amount compare re-enforced in OUR adapter (D-03), not trusting the vendor's compare alone"
    - "System-wide dedup = DB UNIQUE index, not vendor: a 23505 unique-violation on the transRef insert IS the duplicate rejection (unwrapped from DrizzleQueryError.cause) → 409"
    - "Server-assigned object key slips/{orderId}/{uuid}.jpg — client never supplies the key (anti-clobber/anti-read, T-02-22); private bucket + signed-URL-only view (never /files/presign)"
    - "DI on makePaymentsRoutes(db, {verifier,storage,compress,putSlip}) so route tests run without live SlipOK/R2/sharp"

key-files:
  created:
    - api/src/services/slip-verify/types.ts
    - api/src/services/slip-verify/slipok.adapter.ts
    - api/src/services/slip-verify/index.ts
  modified:
    - api/src/routes/payments.ts
    - api/tests/slip-verify.test.ts
    - api/tests/slip-dedup.test.ts
    - bruno/Saladee/payments/upload-slip.bru
    - api/package.json
    - bun.lock

key-decisions:
  - "The DB partial UNIQUE index (payments_trans_ref_idx) is the SOLE system-wide dedup arbiter (D-06). Drizzle wraps the postgres.js error in DrizzleQueryError, so the SQLSTATE 23505 lives on `.cause` — isUniqueViolation walks the cause chain (a plain top-level `.code` check silently returned 500 instead of 409; caught by the dedup test)."
  - "Amount correctness is enforced to the satang inside the adapter even on a vendor 'success' (D-03) — we do not trust SlipOK's own amount compare alone."
  - "SlipOK numeric error codes (1002/1012/1013/1014/1015) are the documented set but could NOT be exercised against a live branch (no credential provisioned). They are isolated in one CODE_REASON constant; unrecognized codes fall through to the money-safe 'unavailable' default. Flagged for live confirmation (Deferred)."
  - "Tests live under api/tests/ (repo convention), not the plan's api/test/ — mirrors the 02-04 path correction; the Wave-0 scaffolds already lived there."
  - "Route tests use the QR-string path (qrPayload, no image) so they exercise verify+dedup+transition against real PostgreSQL 17 without needing sharp or an R2 write; the sharp compress + R2 PUT path is proven by inspection + the existing storage round-trip test (00-03)."

requirements-completed: [PAY-02, PLAT-04]

metrics:
  duration: ~35m
  completed: 2026-07-04
  tasks: 2
  files_created: 3
  files_modified: 6
  tests: "173 pass / 6 todo / 0 fail (full suite, was 162/11 after 02-04); +slip-verify 9, +slip-dedup 2"
---

# Phase 2 Plan 6: Slip Verification — SlipOK Adapter Seam, Private-Slip Upload, System-Wide Dedup, Admin Confirm Summary

Delivered the money-safety core of the payment flow: a customer uploads a PromptPay slip and is auto-confirmed to `paid` on a clean verify, or parked for an admin when the verifier is unavailable — with duplicate slips blocked system-wide by the database, forged/wrong-amount/wrong-payee slips rejected, and slips stored in a private, signed-URL-only bucket under a server-assigned key. Covers PAY-02 and the private-slip half of PLAT-04.

## What was built

**Task 1 — SlipVerifier seam + SlipOK adapter (D-01/D-02/D-03)** — commits `54b1c0a` (test/RED), `753f43e` (feat/GREEN)
- `api/src/services/slip-verify/types.ts`: the swappable `SlipVerifier` interface + a narrow `SlipVerifyResult` union (`clean` | `rejected{reason}` | `unavailable`) — a pure types module (mirrors `order-status.ts`). Call sites depend only on the interface.
- `api/src/services/slip-verify/slipok.adapter.ts`: the first outbound HTTP client — `POST https://api.slipok.com/api/line/apikey/<branchId>` with `x-authorization: <key>` (env-only, header-only, never logged/bodied — T-02-24). Sends the slip as multipart `files` + `amount` + `log:true`, or the QR string as JSON `data`. Maps the response to the union, re-checking the amount to the satang in our own code (D-03) and defaulting any ambiguous/transient failure to `unavailable` (money-safe, D-04). SlipOK error codes are isolated in one `CODE_REASON` constant.
- `api/src/services/slip-verify/index.ts`: env-selected provider (`SLIP_VERIFY_PROVIDER`, default `slipok`) exposing the `slipVerifier` singleton + the interface re-export.
- `api/tests/slip-verify.test.ts`: 9 cases via an injected `fetch` stub (no live credential) — clean, flat-body + string-amount, wrong_amount (our compare), wrong_payee, duplicate, not_a_slip, network→unavailable, quota/5xx→unavailable, and an assertion the api key rides the header and never the body.

**Task 2 — POST /orders/:id/slip + admin confirm + system-wide dedup** — commit `b065032`
- `api/src/routes/payments.ts` (EXTENDED): `POST /orders/:id/slip` compresses the image with sharp (rotate + resize 1080 + jpeg q72), stores it under the SERVER-ASSIGNED key `slips/${orderId}/${uuid}.jpg` in the private R2 bucket, reads the order's snapshotted total (subtotal + deliveryFee) as `expectedAmountSatang`, and calls the `SlipVerifier`. On `clean`: inside one tx, insert the `payments` row with the UNIQUE `transRef` — a 23505 unique-violation maps to `409 duplicate_slip` (D-06) — then `applyTransition(tx, orderId, "paid")` (D-05). On `rejected`: persist a rejected row and return the reason (409 for duplicate, else 422). On `unavailable`: persist an `awaiting_review` row and leave the order `awaiting_payment` (D-04). Added `POST /orders/:id/confirm-payment` (admin `requireRole("owner","admin")`) to hand-confirm parked orders, and `GET /orders/:id/slip` (admin) to mint a 300s signed GET URL for the private slip (D-28).
- `api/tests/slip-dedup.test.ts`: two independent `awaiting_payment` orders present a slip with the SAME transRef against real PostgreSQL 17 — first pays (200), second is rejected `409 duplicate_slip` by the partial UNIQUE index (system-wide, not vendor-only); order A ends `paid`, order B untouched. A second case proves multiple NULL-transRef `awaiting_review` rows coexist.
- `bruno/Saladee/payments/upload-slip.bru`: the multipart slip-upload request + the four documented outcomes.

## Verification
- `bunx tsc --noEmit` → clean.
- `bun test tests/slip-verify.test.ts tests/slip-dedup.test.ts` → 11 pass / 0 fail.
- Full suite `bun test` → **173 pass / 6 todo / 0 fail** (was 162/11 after 02-04) — the two slip scaffolds are now green, zero regressions across the Phase-1 order/oversell tests.
- Acceptance greps: `/orders/:id/slip`≥1, `slips/`≥1, `applyTransition`≥1, `confirm-payment`≥1 in payments.ts; `SLIPOK_API_KEY`≥1 and no literal key in the adapter; `SlipVerifier`≥1 in index.ts.

## Threat mitigations applied
- **T-02-19 (forged/other slip):** payee bound to the branch-linked account (D-02, `log:true`) + exact-satang amount compare in our adapter (D-03); mismatch → rejected.
- **T-02-20 (one slip pays two orders):** transRef under the partial UNIQUE index; the 23505 violation IS the 409 duplicate (D-06), proven system-wide vs real PG.
- **T-02-21 (slip leaking via public URL):** private bucket + server-assigned key + 300s signed-GET-only view (`GET /orders/:id/slip`, admin); never public, never `/files/presign`.
- **T-02-22 (client clobbering another order's slip):** the server assigns `slips/{orderId}/{uuid}.jpg`; the client never supplies the key.
- **T-02-23 (SlipOK down blocks all payments):** `unavailable` → `awaiting_review` + admin `confirm-payment`; the store never hard-depends on the vendor.
- **T-02-24 (key/slip in logs):** the adapter logs nothing; the key is env-only and header-only, asserted absent from the request body by test.

## Deviations from Plan

**1. [Rule 1 — Bug] Unique-violation was returning 500 instead of 409 (dedup silently broken)**
- **Found during:** Task 2 (slip-dedup test).
- **Issue:** Drizzle wraps the postgres.js error in a `DrizzleQueryError` whose top-level `.code` is `undefined`; the SQLSTATE `23505` lives on `.cause` (the `PostgresError`). A plain `e.code === "23505"` check missed it, so the second duplicate slip fell through to a 500 instead of `409 duplicate_slip` — the money-safety dedup contract would have been broken in production.
- **Fix:** `isUniqueViolation` now walks the `.cause` chain (bounded to 5 hops) to find the 23505 code.
- **Files:** api/src/routes/payments.ts
- **Commit:** b065032

**2. [Rule 3 — path correction] Tests placed under api/tests/ (repo convention), not the plan's api/test/**
- **Found during:** both tasks.
- **Issue:** The plan text wrote `api/test/…`; the repo convention is `api/tests/…`, where the Wave-0 scaffolds already lived (same correction as 02-04).
- **Fix:** Filled the existing `api/tests/{slip-verify,slip-dedup}.test.ts` scaffolds.
- **Commit:** 753f43e / b065032

**3. [Rule 2 — added surface] Admin slip-view endpoint (GET /orders/:id/slip)**
- **Found during:** Task 2.
- **Issue:** The must_have requires the slip be "viewable only via a short-lived signed URL", but no view path existed — a private object with no signed-GET route is un-viewable by the admin resolving an exception.
- **Fix:** Added `GET /orders/:id/slip` (admin `requireRole`) that mints a 300s `presignGet` URL for the latest payment's slipKey — realizes D-28/PLAT-04 viewing without exposing the bucket. Small, in scope for the private-slip requirement.
- **Files:** api/src/routes/payments.ts
- **Commit:** b065032

## Known Stubs
None. The adapter, route, dedup, transition, and storage paths are wired against the real schema, the shared `applyTransition`, and the private R2 storage decoration. The only unexercised runtime is the live SlipOK HTTP call (no credential) — the mapping is fully unit-tested against mocked responses and the vendor is behind the swappable seam.

## Deferred Items
- **SlipOK live credentials (SLIPOK_API_KEY / SLIPOK_BRANCH_ID):** default to `""` (02-01); the executor cannot write `.env*` (harness-locked). Auto-verify (D-05) lights up once the operator creates a SlipOK branch, links the shop's receiving bank account, and sets these env vars. **Non-blocking:** the admin manual-confirm path (D-04) works without them today. **Operator action:** provision the SlipOK branch + set the two env vars before relying on auto-verify.
- **SlipOK error-code mapping confirmation:** the numeric codes (1002/1012/1013/1014/1015) in `CODE_REASON` are the documented set but could not be validated against a live account. Confirm them against a real branch once provisioned; unrecognized codes already fall through to the money-safe `unavailable`.
- **R2 slip-storage credentials:** the sharp-compress → private R2 PUT path uses the existing storage plugin (proven by the 00-03 MinIO round-trip); production requires the real R2 bucket/keys already validated at boot (`R2_*`). No new credential beyond Phase-0.
- **PROMPTPAY_PAYEE_ID (production):** must match the SlipOK branch's linked receiving account for D-02 payee verification (carried from 02-04).

## Requirements covered
PAY-02 (slip verify — duplicate/forged/wrong-amount rejected, admin confirm fallback) and the private-slip half of PLAT-04 (server-assigned private key, signed-URL-only view). Full PLAT-04 (PDPA consent) was closed in 02-04.

## Self-Check: PASSED
- FOUND: api/src/services/slip-verify/types.ts, api/src/services/slip-verify/slipok.adapter.ts, api/src/services/slip-verify/index.ts, api/src/routes/payments.ts, bruno/Saladee/payments/upload-slip.bru
- FOUND commits: 54b1c0a, 753f43e, b065032

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
