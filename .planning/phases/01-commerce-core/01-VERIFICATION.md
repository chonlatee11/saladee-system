---
phase: 01-commerce-core
verified: 2026-07-03T00:19:49Z
status: verified
score: 5/5 success criteria verified (17/17 concurrency proofs pass; full suite 109/109 excl. pre-existing R2 test)
mode_note: "ROADMAP declares mode: mvp, but the phase goal is NOT a User Story (no 'As a…, I want…, so that…' form). Verified via standard goal-backward against the 5 ROADMAP Success Criteria (the roadmap contract) rather than MVP User-Flow coverage."
requirements_verified:
  - PLAT-01   # atomic guarded-decrement oversell core — proven real-PG N=8
  - PLAT-03   # hashed passwords (Argon2id) + requireRole RBAC + private R2 bucket
  - INV-01    # variety CRUD (name/img/category/desc/sale units)
  - INV-02    # B2C + B2B tiered pricing
  - INV-03    # fixed-weight packs (250/500g) via sale_units
  - INV-04    # per-kg daily/round price, auto pack price, price history retained
  - INV-05    # selling rounds: cut-off/harvest/delivery + per-variety manual quota
  - INV-06    # per-round oversell decrement on order
  - INV-07    # mixed box scarcest-component limit + all-or-nothing multi-component reserve
  - INV-08    # sold-out "หมดรอบนี้" label + back-in-stock request
  - INV-09    # per-order substitution policy (allow/disallow)
  - SALE-01   # pre-order-by-round (saleMode=preorder derived from future harvest)
  - SALE-02   # ready-to-ship (saleMode=ready)
  - SALE-04   # one variety surfaces multiple rounds/modes on one surface
  - CUST-01   # guest + member order path (LINE Login exchange present; customer identity binding deferred to Phase 2)
  - ORD-02    # status pipeline created→awaiting_payment→paid→packing→shipping→done/cancelled
  - PAY-04    # price-at-order-time frozen snapshot + taxId capture (PDF issuance is Phase 2 scope)
deferred:
  - truth: "LINE customer identity model + owner-of-customerId binding (WR-02 / IN-03)"
    addressed_in: "Phase 2"
    evidence: "REQUIREMENTS CUST-01/PAY-04 note customer identity + LINE Login land with the storefront; auth.ts:77 TODO(Phase 2) is an explicit deferral. No route grants the placeholder 'packer' role any capability today."
  - truth: "Invoice/receipt PDF generation (pdfmake + Thai font)"
    addressed_in: "Phase 2"
    evidence: "PAY-04 Phase-1 scope is explicitly 'capture price-at-order-time'; CLAUDE.md lists pdfmake as Phase 2."
  - truth: "CORS methods allowlist widened to PATCH/PUT/DELETE for the staff browser dashboard"
    addressed_in: "Phase 3 (back-office/staff dashboard)"
    evidence: "deferred-items.md: staff write routes have no browser frontend in Phase 1; same-origin/server-side callers unaffected."
warnings:
  - "WR-04 (open): OrderLineBody.qty / BoxLineBody.qty have no upper bound (t.Integer minimum:1, no maximum). A very large qty could overflow int4 subtotal_satang / plants arithmetic → unhandled 500 (cheap DoS). Does NOT break the oversell invariant. Deferred per 01-REVIEW."
  - "WR-05 (open): POST /rounds/:id/stock upserts quota unconditionally; lowering quota below reserved_plants trips the CHECK and returns an opaque 500 instead of a clean 409. Data stays safe (CHECK protects it). Deferred."
  - "IN-01 (open): pricing.ts deriveUnitPriceSatang uses float division before Math.ceil, technically breaking the integer-satang convention. Empirically exact across realistic inputs; coupled to WR-04's missing bound. Deferred."
  - "WR-02 (open, deferred to Phase 2): POST /auth/line still mints the staff-enum role 'packer' for any valid LINE idToken. Inert today (no route gates on packer) but a latent privilege footgun once a packer surface exists."
---

# Phase 1: Commerce Core — Verification Report

**Phase Goal:** The oversell-safe, harvest-bound order engine is proven — an admin can set up varieties, fixed-weight packs, daily per-variety pricing, and selling rounds, and orders (including mixed boxes) reserve stock atomically without ever overselling, each with a frozen price snapshot.
**Verified:** 2026-07-03T00:19:49Z
**Status:** verified (5/5 success criteria)
**Re-verification:** No — initial verification

## Method

Goal-backward: started from the 5 ROADMAP Success Criteria (the contract), traced each to real source artifacts, verified wiring in `index.ts`, and **re-ran the concurrency/oversell proof suites myself** against the live PostgreSQL 17 container (`:55432`) rather than trusting SUMMARY.md PASS claims. Also independently confirmed the three fixes the 01-REVIEW flagged as resolved (CR-01 multi-round leak, WR-01 auth timing, WR-03 lock-order) are actually present in the code, not just claimed.

- `bun test tests/reservation.test.ts tests/order-endpoint-race.test.ts tests/box-reservation.test.ts tests/box-order.test.ts tests/multi-round-order.test.ts` → **17 pass / 0 fail** (self-executed).
- `bun test <all tests except storage.test.ts>` → **109 pass / 0 fail** (self-executed).
- `tests/storage.test.ts` excluded — pre-existing R2-connectivity hook timeout, out of scope (deferred-items.md). Not treated as a gap.

## Goal Achievement — Observable Truths (Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Admin creates products w/ fixed-weight packs (250/500g), sets daily/round B2C+B2B price; auto-computes pack price + retains history | ✓ VERIFIED | `routes/varieties.ts` (variety+sale_units CRUD, INV-01/03), `routes/prices.ts` POST (NULL default = round, dated = daily override — **both rows persist ⇒ history**), `/prices/resolve` derives whole-baht pack price via `services/pricing.ts:deriveUnitPriceSatang`. Tiers b2c/b2b are enum-constrained. Proven by `catalog-crud.test.ts` (Criterion-1 end-to-end) + `prices-resolution.test.ts` (override wins its day, both rows retained, derived pack = multiple of 100). |
| 2 | Two concurrent orders for last pack → exactly one success + one sold-out; never oversold | ✓ VERIFIED | `services/reservation.ts:reserve()` = single guarded conditional `UPDATE … WHERE quota_plants - reserved_plants >= n RETURNING id` (no SELECT-then-check). DB CHECKs `reserved_plants <= quota_plants`. **Self-ran** `reservation.test.ts` (N=8 service) + `order-endpoint-race.test.ts` (N=8 HTTP) → exactly one winner, `reserved === quota`. |
| 3 | Mixed box orderable only up to scarcest component; decrements every component all-or-nothing | ✓ VERIFIED | `services/reservation.ts:reserveBox()` sorts components by varietyId (global lock order), per-component guarded `reserve()`, first shortfall throws `BoxShortfallError` → whole tx rolls back. `boxAvailability()` = `min(floor((quota−reserved)/plantsPerBox))`. **Self-ran** `box-reservation.test.ts` + `box-order.test.ts` (over-quota → zero net decrement on every component; N=8 last-box race → one 201). |
| 4 | Frozen price/pack snapshot at creation; pre-order + ready-to-ship modes; status pipeline; invoice-ready record | ✓ VERIFIED | `order_lines` snapshot cols (`variety_name`, `unit_label`, `plants_per_unit`, `price_per_kg_satang`, `unit_price_satang`, `box_bom_json`) written in `orders.ts` tx; server never trusts client price (body has no price field). `order-snapshot.test.ts` proves mutating the live price does NOT change the order + a bogus client price is ignored. Pipeline: `services/order-status.ts` TRANSITIONS + `PATCH /orders/:id/status` (`order-status.test.ts`, `cancel-release.test.ts`). saleMode preorder/ready derived from harvest_date (`catalog.ts:saleModeFor`). Invoice-ready: `orders.tax_id` + `subtotal_satang` + per-line snapshot. |
| 5 | Sold-out shows "หมดรอบนี้" + back-in-stock alert request; per-order substitution; per-role access (hashed pw, private buckets) | ✓ VERIFIED | `catalog.ts:41 SOLD_OUT_LABEL = "หมดรอบนี้"` emitted when availability ≤ 0. `stock.ts` POST /stock/back-in-stock (open, data-only) + GET (staff). `orders.substitution_policy` enum captured per order (INV-09). RBAC: `requireRole` on every write; **real** staff login `auth.ts` verifies vs STORED Argon2id hash (`hashPassword`/`verifyPassword` = Bun.password Argon2id). Private R2 bucket: `storage.plugin.ts` — no ACL/public-read, presigned short-TTL URLs only. Proven by `soldout-notify.test.ts`, `auth-boundary.test.ts`, `staff-login.test.ts`. |

**Score:** 5/5 truths verified.

## Fixed-Issue Re-Verification (from 01-REVIEW)

| Review ID | Claim | Verified in Code | Status |
|-----------|-------|------------------|--------|
| CR-01 (BLOCKER) | Multi-round cancel stranded stock — fixed by enforcing single-round-per-order | `orders.ts:305-318` rejects distinctRounds.size > 1 with `400 multi_round_order_unsupported` **before any reservation**; `multi-round-order.test.ts` asserts 400 + zero reserved in either round. | ✓ FIXED (confirmed) |
| WR-01 | Auth timing enumeration side-channel | `auth.ts:31-56` — `DUMMY_PASSWORD_HASH` + always-run `verifyPassword` on both branches; identical generic 401. | ✓ FIXED (confirmed) |
| WR-03 | Inconsistent lock order → deadlock | `orders.ts:391-426` merges all (round,variety) draws, sorts by (roundId, varietyId), issues guarded reserve() in one global order. | ✓ FIXED (confirmed) |

## Required Artifacts

| Artifact | Provides | Status | Details |
|----------|----------|--------|---------|
| `api/src/services/reservation.ts` | reserve/release/reserveBox/boxAvailability | ✓ VERIFIED | Guarded conditional UPDATE; parameterized `sql` only (no sql.raw); wired into orders.ts + catalog.ts |
| `api/src/services/pricing.ts` | deriveUnitPriceSatang (ceil-to-baht) | ✓ VERIFIED | Consumed by orders/prices/catalog. (IN-01 float note — deferred) |
| `api/src/services/order-status.ts` | TRANSITIONS + canTransition | ✓ VERIFIED | shipping→done only (OQ-1); done/cancelled terminal; used by PATCH |
| `api/src/routes/orders.ts` | POST /orders + PATCH status | ✓ VERIFIED | Server-resolved snapshot, single-tx reserve, cancel-release (variety + box) |
| `api/src/routes/varieties.ts` | variety+sale_unit CRUD | ✓ VERIFIED | Public GET / staff writes; soft-delete |
| `api/src/routes/rounds.ts` | round CRUD + quota upsert | ✓ VERIFIED | INV-05 quota upsert; open/closed |
| `api/src/routes/prices.ts` | tiered price CRUD + resolve | ✓ VERIFIED | History retained; auto pack price |
| `api/src/routes/catalog.ts` | public catalog + boxes | ✓ VERIFIED | availability, "หมดรอบนี้", saleMode, box min-availability |
| `api/src/routes/stock.ts` | back-in-stock request | ✓ VERIFIED | Data-only POST (open) + staff GET |
| `api/src/routes/boxes.ts` | box + BOM CRUD | ✓ VERIFIED | Staff writes; soft-delete |
| `api/src/routes/auth.ts` | real staff login | ✓ VERIFIED | Stored-hash verify; forgery path removed |
| `api/src/db/schema.ts` | 12 commerce tables + 5 enums | ✓ VERIFIED | round_stock quota/reserved split + CHECKs |

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `index.ts` | all 9 route modules | `.use(...)` | ✓ WIRED | orders/varieties/rounds/prices/catalog/stock/boxes/auth all composed (lines 45-52) |
| `orders.ts` POST | `reservation.reserve/reserveBox` | in db.transaction | ✓ WIRED | Guarded reserve per draw; throw → rollback |
| `orders.ts` PATCH cancel | `reservation.release` | same tx, branch on line_kind | ✓ WIRED | Box path releases each component from box_bom_json |
| write routes | `requireRole('owner','admin')` | beforeHandle | ✓ WIRED | varieties(4)/rounds(3)/prices/boxes(3)/stock GET/orders PATCH; GET catalog reads open |
| `auth.ts` /staff | `users.password_hash` | verifyPassword (Argon2id) | ✓ WIRED | Role from row, never request |
| `catalog.ts` | `boxAvailability` | in-memory stock map | ✓ WIRED | Box min-availability + "หมดรอบนี้" |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real Data | Status |
|----------|------|--------|-----------|--------|
| `GET /catalog` | varieties/boxes availability | live round_stock (quota−reserved), prices, sale_units | Yes — real DB selects, no static returns | ✓ FLOWING |
| `POST /orders` snapshot | order_lines cols | server-resolved from prices/sale_units/boxes | Yes — client price never read | ✓ FLOWING |
| `/prices/resolve` | pack unitPriceSatang | deriveUnitPriceSatang(live price, sale_unit grams) | Yes | ✓ FLOWING |

## Behavioral Spot-Checks (self-executed)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Oversell impossible (service + HTTP) | `bun test reservation + order-endpoint-race + box-reservation + box-order + multi-round-order` | 17 pass / 0 fail | ✓ PASS |
| Full commerce suite | `bun test <all except storage.test.ts>` | 109 pass / 0 fail | ✓ PASS |
| No blocker debt markers in src | `grep -rnE "TBD|FIXME|XXX" src/` | none | ✓ PASS |

## Requirements Coverage

| Requirement | Description (Phase-1 scope) | Status | Evidence |
|-------------|-----------------------------|--------|----------|
| PLAT-01 | Atomic guarded-decrement oversell core | ✓ SATISFIED | reservation.ts + N=8 races |
| PLAT-03 | Hashed pw + RBAC + private bucket/signed URL | ✓ SATISFIED | auth.ts (Argon2id) + requireRole + storage.plugin.ts (private R2, presign) |
| INV-01 | Variety management | ✓ SATISFIED | varieties.ts CRUD |
| INV-02 | B2C + B2B tiers | ✓ SATISFIED | prices.ts tier enum + resolve |
| INV-03 | Fixed-weight packs | ✓ SATISFIED | sale_units (gramsPerUnit 250/500) |
| INV-04 | Per-kg daily/round price, auto pack, history | ✓ SATISFIED | prices.ts (dated override + NULL default both persist) + deriveUnitPriceSatang |
| INV-05 | Selling rounds + manual quota | ✓ SATISFIED | rounds.ts POST /rounds/:id/stock upsert |
| INV-06 | Per-round oversell decrement | ✓ SATISFIED | reserve() in orders tx |
| INV-07 | Mixed box scarcest-limit + one-tx | ✓ SATISFIED | reserveBox + box-order.test.ts |
| INV-08 | "หมดรอบนี้" + back-in-stock request | ✓ SATISFIED | catalog.ts + stock.ts |
| INV-09 | Per-order substitution policy | ✓ SATISFIED | orders.substitution_policy captured |
| SALE-01 | Pre-order-by-round | ✓ SATISFIED | saleMode=preorder (future harvest) |
| SALE-02 | Ready-to-ship | ✓ SATISFIED | saleMode=ready |
| SALE-04 | Multi-mode on one surface | ✓ SATISFIED | catalog groups variety across rounds; catalog.test.ts asserts both modes |
| CUST-01 | Guest + member ordering | ✓ SATISFIED (Phase-1 scope) | guest insert + member validate in orders.ts; LINE Login exchange present. Owner-of-customerId binding deferred to Phase 2 (IN-03) |
| ORD-02 | Status pipeline | ✓ SATISFIED | order-status.ts + PATCH |
| PAY-04 | Price-at-order-time from Phase 1 | ✓ SATISFIED (Phase-1 scope) | Frozen order_lines snapshot + tax_id capture; PDF issuance is Phase 2 |

No orphaned requirements: all 17 IDs from the plans map to REQUIREMENTS.md Phase-1 rows, and every Phase-1 ID is claimed by a plan.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `routes/orders.ts` | 58, 66 | qty has no upper bound (WR-04) | ⚠️ Warning | Large qty → int4 overflow → unhandled 500; does not break oversell. Deferred. |
| `routes/rounds.ts` | 100-114 | quota upsert has no reserved-check (WR-05) | ⚠️ Warning | Lowering quota below reserved → opaque 500; data safe via CHECK. Deferred. |
| `services/pricing.ts` | 18 | float division before ceil (IN-01) | ℹ️ Info | Empirically exact; breaks stated integer-satang convention. Deferred. |
| `routes/auth.ts` | 80 | /auth/line mints staff-enum 'packer' (WR-02) | ⚠️ Warning | Inert today; latent footgun. Deferred to Phase 2 customer-role model. |
| `routes/auth.ts` | 77 | TODO(Phase 2) marker | ℹ️ Info | Warning-level marker, references formal Phase-2 follow-up — acceptable. |

No 🛑 blocker anti-patterns. No TBD/FIXME/XXX in source.

## Human Verification Required

None required for phase sign-off. The entire phase is a backend/API surface with no Phase-1 UI (LIFF is Phase 2), and every success criterion is proven by real-PostgreSQL-17 automated tests that were **re-executed during this verification** (109 pass). The "หมดรอบนี้" label, sold-out state, snapshot immutability, oversell races, and RBAC boundary are all asserted programmatically.

## Gaps Summary

No gaps block the phase goal. The oversell-safe, harvest-bound order engine is proven at both the service and HTTP layers, for single lines and multi-component boxes, with server-resolved frozen price snapshots and a real RBAC boundary. The one review BLOCKER (CR-01) and the two fixed warnings (WR-01, WR-03) are confirmed resolved in the actual code. Remaining items (WR-02, WR-04, WR-05, IN-01, CORS methods) are pre-existing low-severity warnings the review already classified as deferred; none breaks the phase's stock-correctness invariant, and the customer-identity/PDF items belong to Phase 2 by the ROADMAP. `tests/storage.test.ts` is a pre-existing environmental R2 timeout, out of scope.

---

_Verified: 2026-07-03T00:19:49Z_
_Verifier: Claude (gsd-verifier)_
