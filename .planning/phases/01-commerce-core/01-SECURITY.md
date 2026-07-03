---
phase: 01
slug: commerce-core
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-03
register_source: authored_at_plan_time
---

# Phase 01 — Security: commerce-core

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Audited:** 2026-07-03
**Disposition:** SECURED — all declared mitigations verified in implementation code.
**Threats Closed:** 24/24 (23 mitigate verified + 1 accept confirmed)
**ASVS Target:** L1
**Register source:** authored at PLAN time (`register_authored_at_plan_time: true`) — this audit VERIFIES each declared mitigation exists in code; it does not scan for new threats.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| guest/member client → POST /orders | untrusted body (customer, tier, qty, boxId); open per D-03 | order intent, customer contact |
| staff client → PATCH /orders/:id/status | must present a valid owner/admin session | order state transition |
| staff client → catalog/round/price/box writes | owner/admin session only | catalog + pricing config |
| staff client → POST /auth/staff | untrusted email/password; verified against stored hash | credentials |
| public client → catalog/price/box reads · back-in-stock POST | open, untrusted input; must expose no PII | catalog/price data only |
| staff client → GET /stock/back-in-stock | owner/admin only | customer contact list |
| concurrent orders → round_stock row(s) | the oversell + deadlock integrity boundary (PLAT-01) | reserved-plants counter |
| caller → reservation service | plants/ids flow into SQL; parameterized + non-negative | quantity, ids |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence file:line) | Status |
|-----------|----------|-----------|-------------|----------------------------------|--------|
| T-01-01 | Tampering | reserve()/round_stock oversell (PLAT-01) | mitigate | Single guarded `UPDATE round_stock SET reserved_plants += n WHERE quota_plants - reserved_plants >= n RETURNING` `services/reservation.ts:38-46`; no SELECT-then-check. Race proven `tests/order-endpoint-race.test.ts:51,89-91` (N=8 → one 201, N-1×409). | closed |
| T-01-02 | Tampering | negative-plants → stock inflation / negative reserve | mitigate | DB CHECKs `drizzle/0001_commerce.sql:158-160` (`reserved_plants >= 0`, `<= quota_plants`, `quota_plants >= 0`); TypeBox min:1 `orders.ts:58`, `boxes.ts:31`. | closed |
| T-01-03 | Tampering | SQL injection via ids/plants | mitigate | Parameterized drizzle `sql` template only `reservation.ts:38-46,61-69`; repo-wide `sql.raw`/`.raw(` = 0 matches. | closed |
| T-01-04 | Tampering | double-release inflates stock | mitigate | `release()` guarded `WHERE reserved_plants >= n RETURNING` `reservation.ts:61-69`; idempotent. | closed |
| T-01-05 | Tampering | POST /orders oversell under concurrency | mitigate | Guarded `reserve()` inside `database.transaction` `orders.ts:349,423-426`; shortfall → `OrderError("sold_out",409)` rolls back. | closed |
| T-01-06 | Tampering | client-supplied price/plants tampering | mitigate | `OrderLineBody` has NO price/plants field `orders.ts:54-59`; server resolves tier price `orders.ts:170-187`, computes plants `orders.ts:197`. | closed |
| T-01-07 | Elevation | unauth/wrong-role status change | mitigate | `beforeHandle: requireRole("owner","admin")` on PATCH `orders.ts:570`; POST open by design (D-03). `tests/auth-boundary.test.ts`. | closed |
| T-01-08 | Tampering | double-cancel double-release | mitigate | `canTransition` gate `orders.ts:522` + `next==="cancelled" && current!=="cancelled"` guard `orders.ts:532`; guarded `release()`; terminal states `order-status.ts:23-36`. | closed |
| T-01-09 | Tampering | negative/zero quantity | mitigate | TypeBox Integer min:1 `orders.ts:58`; DB CHECK `qty > 0` `drizzle/0001_commerce.sql:161`. | closed |
| T-01-10 | Info Disclosure | customer PII via order reads | mitigate | No order-read endpoint; only open POST + staff-guarded PATCH `orders.ts:506-572`. | closed |
| T-01-11 | Elevation | unauth/wrong-role catalog write | mitigate | `requireRole("owner","admin")` beforeHandle on every write: `varieties.ts:132,159,176` `rounds.ts:85,115,131` `prices.ts:80,99` `boxes.ts:135,176,193`; deny-by-default. | closed |
| T-01-12 | Tampering | negative/fractional price or quota | mitigate | TypeBox Integer min:0 `prices.ts:36` `rounds.ts:35`; integer-satang columns `db/schema.ts:124,105` (no float). | closed |
| T-01-13 | Tampering | SQL injection via CRUD bodies | mitigate | Drizzle parameterized queries throughout CRUD; no string-built SQL (grep 0 raw). | closed |
| T-01-14 | Info Disclosure | PII leak via public reads | mitigate | Public GETs return only catalog/price shapes — no customers/orders selected. | closed |
| T-01-15 | Info Disclosure | catalog read leaks PII | mitigate | Catalog queries select only variety/sale_unit/round/price/stock `catalog.ts:119-286`; test asserts no PII `tests/catalog.test.ts:162-166`. | closed |
| T-01-16 | Elevation | non-staff reads back-in-stock contact list | mitigate | `GET /stock/back-in-stock` guarded `staff` `stock.ts:61`; POST self-service open `stock.ts:38-54`. | closed |
| T-01-17 | Tampering | malformed ids in back-in-stock/catalog | mitigate | TypeBox `format:"uuid"` on ids `stock.ts:26-30`; parameterized Drizzle insert. | closed |
| T-01-18 | Tampering | box multi-row oversell of scarce component | mitigate | `reserveBox()` per-component guarded reserve in one tx; `BoxShortfallError` unwinds tx `reservation.ts:106-118`; all-or-nothing draw loop `orders.ts:403-426`. `tests/box-reservation.test.ts`. | closed |
| T-01-19 | Availability (DoS) | deadlock between concurrent box orders | mitigate | Global lock order: draws sorted by `(roundId, varietyId)` before reserve `orders.ts:419-422`; `reserveBox` sorts by varietyId `reservation.ts:113` (WR-03 fix). | closed |
| T-01-20 | Tampering | client-supplied box price | mitigate | `BoxLineBody` no price/BOM field `orders.ts:63-67`; box price resolved server-side — fixed override else sum of component prices `orders.ts:268-283`. | closed |
| T-01-21 | Elevation | non-staff defines/edits box BOM | mitigate | `requireRole("owner","admin")` on box POST/PUT/DELETE `boxes.ts:135,176,193`; GET public. | closed |
| T-01-22 | Elevation | broken access control — client-supplied hash forges admin token | mitigate | `POST /auth/staff` looks up row by email, verifies STORED `password_hash` via `Bun.password.verify`, role from row `auth.ts:44-61`; body = `{email,password}` only, no `passwordHash` field `auth.ts:66-69`. Forgery-regression `tests/staff-login.test.ts:103`. | closed |
| T-01-23 | Info Disclosure | user-enumeration (unknown-email vs wrong-password) | mitigate | Identical `401 {error:"invalid_credentials"}` both paths `auth.ts:57-60`; timing equalized via always-run Argon2id verify (dummy hash on no-row) `auth.ts:31-32,53-56` (WR-01). `tests/staff-login.test.ts:90-100`. | closed |
| T-01-SC | Tampering | supply chain (npm installs) | accept | No new packages this phase; `api/package.json` untouched by any Phase-1 commit; every SUMMARY declares `added: []`; `bun install --frozen-lockfile` only. See Accepted Risks Log. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-SC | Phase 1 installed NO new packages; every dependency is pre-existing and pinned from Phase 0 (last dep change was Phase-0 `@elysiajs/cors`). No new supply-chain surface introduced. Verified: no Phase-1 commit modifies `api/package.json`; installs used `--frozen-lockfile`. Residual risk (existing pinned deps) unchanged from Phase 0 and owned there. | chonlatee (owner) | 2026-07-03 |

---

## Informational — deferred code-review items (NOT in threat register, do not block this phase)

Surfaced by the phase code review (`01-REVIEW.md`), dispositioned as deferred, and outside the PLAN-time threat register. Noted for the record; they are not declared mitigations under audit here.

- **IN-01** — `deriveUnitPriceSatang` uses float division internally (`services/pricing.ts:18`) before `Math.ceil` to whole baht. The register's "no float" claims (T-01-06/12/20) concern *client-supplied* price/quota, which remain integer-validated — those threats stay CLOSED. Internal float derivation is a precision/code-quality item, deferred.
- **IN-02** — round cut-off/status re-check inside the order tx is not row-locked atomic with the reservation UPDATE (`orders.ts:376-389`); a narrow close-during-checkout window. Oversell itself is still prevented by the guarded UPDATE. Deferred.
- **IN-03** — `POST /orders` (open guest checkout by D-03) does not verify the caller owns a supplied member `customerId`; customer auth deferred to Phase 2. Not in register.
- **WR-04** — no upper bound on `qty` (DoS/overflow surface); deferred.
- **WR-05** — lowering a round's quota below reserved raises an unhandled 500; deferred.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-03 | 24 | 24 | 0 | gsd-security-auditor (/gsd:secure-phase 01) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-03
