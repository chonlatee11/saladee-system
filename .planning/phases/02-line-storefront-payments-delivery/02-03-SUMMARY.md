---
phase: 02-line-storefront-payments-delivery
plan: 03
subsystem: delivery
tags: [delivery, fee-engine, freshness-gating, care-content, config, public-read]
status: complete
requires:
  - "02-01: varieties.delivery_class + storage_tips/washing_tips columns, rounds.delivery_date, box_components"
provides:
  - "computeDeliveryFee(zone, method, subtotal, cfg) — server-authoritative flat fee (imported by 02-04 checkout)"
  - "allowedMethodsForCart(classes) — freshness intersection (re-enforced at checkout 02-04)"
  - "deliveryConfig — committed TypeBox-validated zone×method config"
  - "GET /delivery/quote — public quote read for the LIFF checkout"
  - "varieties CRUD deliveryClass + care fields; public catalog surfaces care copy"
affects:
  - "02-04 checkout: snapshots delivery_method/zone/fee_satang onto the order, drives QR amount"
tech-stack:
  added: []
  patterns:
    - "TypeBox validate-at-boot config file (mirrors env.ts fail-fast)"
    - "Pure server-authoritative compute service (mirrors reservation.ts/pricing.ts)"
    - "Public no-guard Elysia read route via makeXxxRoutes(db) DI (mirrors catalog.ts)"
key-files:
  created:
    - api/src/config/delivery.ts
    - api/src/services/delivery.ts
    - api/src/routes/delivery.ts
  modified:
    - api/src/index.ts
    - api/src/routes/varieties.ts
    - api/src/routes/catalog.ts
    - api/tests/delivery.test.ts
decisions:
  - "Test file lives at api/tests/delivery.test.ts (repo convention) not the plan's api/test/ path"
  - "DeliveryMethod type is canonical in services/delivery.ts; config imports it type-only (no runtime cycle)"
  - "Seed zones: samut_prakan (all 4 methods) + upcountry (cold/general only) per D-12"
  - "Quote takes subtotalSatang (t.Numeric, coerced) so the ฿500 free-shipping rule is applied at quote time; still display-only"
metrics:
  duration: ~25m
  completed: 2026-07-04
  tasks: 2
  files_created: 3
  files_modified: 4
  tests: "24 delivery cases + existing catalog suites green"
---

# Phase 2 Plan 3: Delivery Fee + Freshness Engine Summary

Server-authoritative delivery capability — config-driven zone×method flat-rate fees with a ฿500 free-shipping rule (self/general only), freshness-based method gating (very_fresh forces self/cold, mixed carts use the strictest class), and care-content editing/surfacing — exposed as a public `GET /delivery/quote` the checkout UI consumes. Pure compute + config; no carrier API (deferred to Phase 4).

## What was built

**Task 1 — config + fee/freshness engine (pure, tested)** — commit `5209ed7`
- `api/src/config/delivery.ts`: a committed `DeliveryConfig` (zones[], `freeShippingThresholdSatang: 50000`, `freeShippingMethods: ["self","general"]`) with a TypeBox schema validated at module load. `additionalProperties:false` on the fees object makes an unknown method key fail boot; `t.Integer({minimum:0})` rejects negative fees. `validateDeliveryConfig()` is a pure exported function (testable without `process.exit`), mirroring `env.ts`.
- `api/src/services/delivery.ts`: `ALLOWED_METHODS`, `allowedMethodsForCart(classes)` (canonical-ordered intersection, empty cart = unconstrained), `computeDeliveryFee(zone, method, subtotal, cfg)` — throws `method_not_available_in_zone` for an unoffered pair; free-shipping applies to self/general only, on_demand/cold always charged (D-15).
- `api/tests/delivery.test.ts`: filled the Wave-0 scaffold with 24 cases — fee matrix (6 pairs), free-shipping incl. inclusive-threshold edge, unavailable-method throws, freshness intersection (very_fresh/normal/mixed/empty), and config validation (negative fee + unknown key rejected, valid config passes).

**Task 2 — public quote route + care-content edit/surface** — commit `7925a2a`
- `api/src/routes/delivery.ts`: `makeDeliveryRoutes(db)` exposing PUBLIC `GET /delivery/quote` (no `requireRole`, D-03). Reads each cart variety's `delivery_class` (direct items + box BOM components), computes the freshness intersection, computes the flat fee per allowed method (omitting methods not offered in the zone), and returns `{ allowedMethods, fees, deliveryDate }` with the round's read-only `deliveryDate`. Composed in `index.ts` via `.use(deliveryRoutes)` (appended; order preserved).
- `api/src/routes/varieties.ts`: added `deliveryClass` (very_fresh|normal) + nullable `storageTips`/`washingTips` to Create/Update bodies, the POST insert, and the PUT patch-builder — staff-gated by the existing `requireRole("owner","admin")`.
- `api/src/routes/catalog.ts`: surfaced `deliveryClass` + care fields on both public variety-detail payloads (`/catalog` and `/catalog/rounds/:id`); reads stay public (D-24).

## Verification
- `bun test tests/delivery.test.ts` → 24 pass / 0 fail.
- `bunx tsc --noEmit` → clean (0 errors).
- `bun test tests/delivery.test.ts tests/catalog.test.ts tests/catalog-crud.test.ts` → 31 pass / 0 fail (existing catalog contract unaffected by the care-field additions).
- Acceptance greps: `/delivery/quote` present with 0 `requireRole`; `freeShippingMethods` and `allowedMethodsForCart` present; varieties/catalog carry the care fields.

## Threat mitigations applied
- **T-02-09 (client-spoofed fee):** fee is computed server-side from the committed config; `/delivery/quote` is display-only. Checkout (02-04) will recompute + snapshot — the client never sets a fee.
- **T-02-10 (bypass freshness):** `allowedMethodsForCart` intersection enforced at the quote; the same helper is re-enforced at checkout (02-04). very_fresh forces self/cold.
- **T-02-11 (non-staff editing care/class):** varieties writes keep `requireRole("owner","admin")`; the new fields ride the existing guard.

## Deviations from Plan
**1. [Rule 3 — blocking] Test file path corrected to repo convention**
- **Found during:** Task 1
- **Issue:** The plan's `files_modified` and verify command reference `api/test/delivery.test.ts`, but the repo's test directory is `api/tests/` (all 20 existing suites live there) and a Wave-0 scaffold already existed at `api/tests/delivery.test.ts`.
- **Fix:** Filled the existing `api/tests/delivery.test.ts` scaffold; ran verification as `cd api && bun test tests/delivery.test.ts`.
- **Files:** api/tests/delivery.test.ts
- **Commit:** 5209ed7

**2. [Rule 2 — missing input] `subtotalSatang` added to the quote query**
- **Found during:** Task 2
- **Issue:** The free-shipping rule (D-15) needs the cart subtotal to decide whether self/general are free, but the plan's quote input listed only roundId/zoneId/variety ids. Without a subtotal the quote could not honor D-15.
- **Fix:** Added an optional coerced `subtotalSatang` (t.Numeric, default 0) to the quote query so `computeDeliveryFee` applies free-shipping at quote time. Still display-only.
- **Files:** api/src/routes/delivery.ts
- **Commit:** 7925a2a

**3. [Rule 1 — type] Test avoided unchecked array indexing**
- **Found during:** Task 2 (tsc)
- **Issue:** `ALLOWED_METHODS[classes[0]]` tripped `noUncheckedIndexedAccess` (TS2538).
- **Fix:** Used explicitly-typed `DeliveryClass` locals instead of array indices.
- **Files:** api/tests/delivery.test.ts
- **Commit:** 7925a2a

## Known Stubs
None. The engine and route are fully wired; `computeDeliveryFee`/`allowedMethodsForCart` are the real dependencies 02-04 checkout will import.

## Deferred Items
- **Carrier API integration** — deferred to Phase 4 per plan (MVP is pure compute + config).
- **DB-backed editable delivery zones** — deferred to Phase 3 admin UI (RESEARCH OQ3); the committed config file is the MVP choice. Admin edits via git/redeploy.
- No env vars required by this plan (no `.env` changes).

## Requirements covered
DEL-01 (methods), DEL-02 (zone×method fee + free-shipping), DEL-03 (freshness gating), DEL-04 (quote endpoint), plus D-24 care content.

## Self-Check: PASSED
- FOUND: api/src/config/delivery.ts, api/src/services/delivery.ts, api/src/routes/delivery.ts
- FOUND commits: 5209ed7, 7925a2a
