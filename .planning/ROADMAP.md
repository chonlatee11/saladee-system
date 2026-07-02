# Roadmap: Saladee — ระบบร้านค้าออนไลน์ขายผักสลัด + วางแผนการปลูก

## Overview

Saladee is built as a modular monolith on one low-cost always-on VPS, and the roadmap follows a strict dependency chain endorsed by research. A thin **Foundation** (Phase 0) stands up the database, storage, LINE client, and HTTPS deploy. **Phase 1** then proves the project's defining risk — an oversell-safe, harvest-bound reservation core — behind an admin catalog before any customer UI or payment exists, with the `quota`/`reserved` split and price-snapshot built correct-from-day-one so later phases plug in without a rewrite. **Phase 2** wraps that core in the real LINE storefront (Rich Menu + LIFF), self-hosted PromptPay, verified slips, hold-expiry stock release, delivery, and PDPA consent — the point where the store can go live and take money. **Phase 3** moves the farm into a back-office: crop planning auto-feeds sellable quantity (replacing Phase 1's manual entry), B2B quota and subscriptions guarantee and recur revenue, and staff run packing, dashboards, and reports by role. **Phase 4** expands beyond LINE with a web storefront, promotions/loyalty, segmented broadcast, multi-carrier delivery, and demand-driven planting — closing the omnichannel loop on a proven order core.

## Phases

**Phase Numbering:**

- Integer phases (0, 1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Foundation & Platform** - Single deployable backend, DB, storage, LINE client, HTTPS on VPS (completed 2026-07-02)
- [x] **Phase 1: Commerce Core** - Oversell-safe harvest-bound reservation engine, catalog, pricing, rounds, mixed box (completed 2026-07-02)
- [ ] **Phase 2: LINE Storefront, Payments & Delivery** - LIFF + Rich Menu ordering, PromptPay + verified slips, hold-expiry, delivery, PDPA
- [ ] **Phase 3: Back-office, Crop Planning & B2B/Subscription** - Crop forecast auto-feeds stock, B2B quota, subscriptions, packing, dashboards, reports
- [ ] **Phase 4: Web Store, Marketing & Scale** - Web storefront, promotions/loyalty, broadcast, multi-carrier delivery, demand-driven planting

## Phase Details

### Phase 0: Foundation & Platform

**Goal**: A single deployable backend with database, object storage, and platform clients runs on always-on low-cost infrastructure, ready for feature development.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-02, PLAT-05
**Success Criteria** (what must be TRUE):

  1. The API responds over HTTPS on the production VPS (health endpoint returns 200) with config/secrets loaded from environment, no hardcoded secrets.
  2. Database migrations apply and roll back cleanly against a single PostgreSQL instance.
  3. A file uploads to and downloads from object storage via the storage client using a short-lived signed URL.
  4. The LINE API client and RBAC scaffold are wired and the app boots without them being stubbed out.

**Plans**: 7 plans

Plans:

- [x] 00-01-PLAN.md — Monorepo + env-validated bootable API + /health liveness (wave 1)
- [x] 00-02-PLAN.md — PostgreSQL client + RBAC schema + reversible migrations + /health/ready (wave 2)
- [x] 00-03-PLAN.md — Cloudflare R2 storage: presigned PUT/GET round-trip (wave 2)
- [x] 00-04-PLAN.md — LINE webhook: raw-body signature validation + echo (wave 2)
- [x] 00-05-PLAN.md — Auth/RBAC scaffold: Bun.password + jose sessions + LINE idToken verify (wave 2)
- [x] 00-06-PLAN.md — Deploy config: Caddy + systemd + CI workflows + web/ Eden Treaty scaffold (wave 3)
- [x] 00-07-PLAN.md — External provisioning + live verification (wave 4) — COMPLETE: all 4 criteria live (HTTPS, Neon, R2, LINE echo) on DigitalOcean/Docker

### Phase 1: Commerce Core

**Goal**: The oversell-safe, harvest-bound order engine is proven — an admin can set up varieties, fixed-weight packs, daily per-variety pricing, and selling rounds, and orders (including mixed boxes) reserve stock atomically without ever overselling, each with a frozen price snapshot.
**Mode:** mvp
**Depends on**: Phase 0
**Requirements**: PLAT-01, PLAT-03, INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07, INV-08, INV-09, SALE-01, SALE-02, SALE-04, CUST-01, ORD-02, PAY-04
**Success Criteria** (what must be TRUE):

  1. An admin creates products with fixed-weight packs (e.g. 250g/500g) and sets daily/round per-variety price with retail (B2C) and wholesale (B2B) tiers; the system auto-computes pack price and retains price history.
  2. Two concurrent orders for the last available pack in a round yield exactly one success and one "sold out" — stock is never oversold (guarded atomic decrement, manual sellable qty in this phase).
  3. A mixed salad box is orderable only up to its scarcest component's quantity, and ordering it decrements every component in one all-or-nothing transaction.
  4. Each order captures a frozen price/pack snapshot at creation, supports pre-order-by-round and ready-to-ship modes, and moves through the status pipeline (created → awaiting payment → paid → packing → shipping → done/cancelled) with an invoice-ready record.
  5. A sold-out item shows "หมดรอบนี้" and a customer can request a back-in-stock alert; per-order substitution policy and per-role access (hashed passwords, private buckets) are enforced.

**Plans**: 5 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Commerce schema + guarded reservation service, oversell-proven at service level (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — POST /orders + status pipeline, oversell-proven end-to-end at the endpoint (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Staff catalog CRUD: varieties/packs, rounds/quota, tiered daily pricing + auth boundary (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Public catalog reads: availability, sold-out "หมดรอบนี้", multi-mode + back-in-stock request (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Mixed salad box: all-or-nothing multi-component reservation, proven (wave 5)

### Phase 2: LINE Storefront, Payments & Delivery

**Goal**: A customer can order salad end-to-end inside LINE — browse the round in LIFF, choose a delivery round/method, pay by PromptPay, upload a verified slip, and receive automatic status updates — while unpaid holds release stock on expiry.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PLAT-04, ORD-01, ORD-04, PAY-01, PAY-02, PAY-03, DEL-01, DEL-02, DEL-03, DEL-04, CUST-04, LINE-01, LINE-02, LINE-03
**Success Criteria** (what must be TRUE):

  1. A customer opens the Rich Menu, orders through the LIFF page (LINE login or guest), picks a delivery round/method and address, and completes mobile checkout; the order lands in the single backend.
  2. The system generates an amount-specified PromptPay QR that a real bank app scans and accepts, and the customer uploads a slip that is verified (duplicate/forged/wrong-amount rejected) before admin confirmation.
  3. An unpaid order's reserved stock is automatically released when its QR hold expires, returning it to the available pool.
  4. The customer receives automatic LINE notifications on status changes and can view order history and reorder.
  5. Delivery fee computes by method/zone with free shipping over 500 baht, disallowed methods are blocked per product type, and PDPA consent (with separate marketing consent) is captured while slips stay in a private, signed-URL-only bucket.

**Plans**: TBD
**UI hint**: yes

Plans:

- [ ] 02-01: TBD (derived during plan-phase)

### Phase 3: Back-office, Crop Planning & B2B/Subscription

**Goal**: The farm runs operations from the back-office — crop plans forecast harvests that auto-feed sellable quantities, B2B quota and standing orders are guaranteed, subscriptions auto-generate, and staff manage packing, dashboards, and reports by role.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: INV-10, SALE-03, ORD-03, CUST-02, CUST-05, MKT-02, MKT-04, ADM-01, ADM-02, ADM-03, CROP-01, CROP-02, CROP-03, CROP-04, CROP-05, CROP-06
**Success Criteria** (what must be TRUE):

  1. An admin defines variety parameters (days-to-harvest, g/plant, survival %) and a per-round planting mix; the system auto-creates planting batches and projects a weekly harvest calendar with expected yield.
  2. The harvest calendar auto-populates sellable quantity per round (replacing manual entry, with manual override retained), and each actual harvest is logged with lot/best-before for traceability and forecast tuning.
  3. A B2B customer sees wholesale pricing and sets a standing order whose quota is reserved from forecast before B2C stock opens; subscription boxes auto-generate orders per round with pause/skip/cancel.
  4. Packing staff see a pack queue grouped by delivery route and print pack/label slips; role-based access limits owner/admin/grower/packer views.
  5. The dashboard summarizes today's/this-round sales, unpaid orders, near-sold-out items, and next-round yield; sales reports break down by period/channel/product/round; system settings are configurable; and a canned LINE chatbot answers menu/stock and takes orders.

**Plans**: TBD
**UI hint**: yes

Plans:

- [ ] 03-01: TBD (derived during plan-phase)

### Phase 4: Web Store, Marketing & Scale

**Goal**: The store expands beyond LINE — a public web storefront, promotions and loyalty, segmented broadcasts, full multi-carrier delivery, and demand-driven planting close the omnichannel loop on the proven order core.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ORD-05, DEL-05, CUST-03, MKT-01, MKT-03, LINE-04, CROP-07
**Success Criteria** (what must be TRUE):

  1. A customer browses and checks out through a public web storefront (cart → checkout) that reuses the same order/reservation core.
  2. An admin creates promotions/coupons (percent/baht, minimum, expiry, usage limit, segment codes) and customers earn and redeem loyalty points.
  3. An admin sends a segmented LINE broadcast and a conversational chatbot can take orders.
  4. Delivery records carrier tracking number/status (Grab/Lalamove/general carrier), and the system recommends per-Monday planting quantities from demand history.

**Plans**: TBD
**UI hint**: yes

Plans:

- [ ] 04-01: TBD (derived during plan-phase)

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation & Platform | 8/8 | Complete   | 2026-07-02 |
| 1. Commerce Core | 5/5 | Complete   | 2026-07-02 |
| 2. LINE Storefront, Payments & Delivery | 0/TBD | Not started | - |
| 3. Back-office, Crop Planning & B2B/Subscription | 0/TBD | Not started | - |
| 4. Web Store, Marketing & Scale | 0/TBD | Not started | - |
