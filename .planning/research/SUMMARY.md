# Project Research Summary

**Project:** Saladee — Thai fresh-salad e-commerce + crop planning (LINE-OA-first)
**Domain:** Perishable fresh-produce e-commerce with harvest-cycle inventory, LINE LIFF commerce, self-hosted PromptPay, B2C/B2B/subscription
**Researched:** 2026-06-28
**Confidence:** HIGH

## Executive Summary

Saladee is a **harvest-bound perishable-produce commerce system sold through LINE**, and the research is unanimous on how experts build this: a **modular monolith** (one Bun/Elysia + PostgreSQL backend) with thin static LIFF and admin SPAs, self-generated PromptPay QR (no gateway), and object storage for slips/images — all on one small always-on ARM VPS for roughly $4–5/month. This shape is not a compromise; it is the correct answer to the two governing constraints: lowest-cost (NFR-08) and no-oversell stock integrity (NFR-02). Serverless free tiers are explicitly rejected because a LINE webhook and the reservation/hold-expiry timers cannot tolerate cold starts.

The **defining technical risk is oversell of a scarce, perishable harvest**, and every research file converges on the same mechanism: a **single guarded atomic decrement in PostgreSQL** (`UPDATE ... WHERE qty_total - qty_reserved >= :n`), never read-modify-write in application code, with reservation-at-order-creation tied to a QR-hold expiry that a reaper job releases. This one pattern is the backbone that mixed-salad boxes (min-of-components, all-or-nothing transaction), B2B quota carve-outs (Phase 2 columns on the same row), and subscriptions (Phase 3) all extend. Getting the stock model right in Phase 1 — with a `quota`/`reserved` split rather than a single mutable integer — is what makes the later phases additive instead of a rewrite.

The recommended approach is to **respect the SRS 3-phase split** (LINE commerce MVP → back-office + crop planning → web/marketing/scale) with two research-backed adjustments: (1) **pull slip-verification API forward into Phase 1** — fake/duplicate-slip fraud exists from order #1 and a slip-QR verification API is cheaper and safer than manual review and is NOT a payment gateway; and (2) **capture price-at-order-time from day one** even though tax invoices land in Phase 2, to avoid a backfill problem. Phase 1 deliberately ships **manual sellable-qty entry** (crop forecast deferred to Phase 2) as a de-risking move, since forecast trust needs accumulated actual-harvest data anyway. Beyond stock races, the other launch-blocking risks are PromptPay payload correctness (use a maintained EMVCo/CRC library, never hand-roll), LINE push-cost blowout (prefer free reply messages + pull-based status), and PDPA on stored slips (private buckets + signed URLs + consent log from Phase 1).

## Key Findings

### Recommended Stack

The stack is a Bun-first TypeScript monolith optimized for a solo developer and near-zero fixed cost. See `.planning/research/STACK.md`. One Hetzner CAX11 ARM VPS (~$4.59/mo) runs the Elysia API + self-hosted PostgreSQL 17 + Caddy (auto-HTTPS); the LIFF SPA is static on Cloudflare Pages (free) and slips/images live on Cloudflare R2 (free 10 GB, zero egress). End-to-end type safety flows from Elysia to the Vue frontend via Eden Treaty. There is no payment gateway (self-generated PromptPay), no serverless per-request billing, and no egress surprises — the stack directly encodes NFR-08.

**Core technologies:**
- **Bun 1.3 + Elysia 1.4**: TS runtime + Bun-first API framework — fastest, fewest deps, native S3/image/SQL, auto OpenAPI + Eden Treaty types to the frontend
- **PostgreSQL 17 + Drizzle ORM**: relational ACID with explicit `FOR UPDATE`/`SKIP LOCKED` control — mandatory for atomic stock reservation (NFR-02); self-hostable for ~$0
- **Vue 3 + Vite + Tailwind 4**: lightweight mobile-first LIFF SPA (NFR-07), reusable for the Phase-3 web store via Nuxt
- **@line/bot-sdk + @line/liff + jose**: webhook signature validation, LIFF login, server-side ID-token verification
- **promptpay-qr / promptparse + qrcode**: server-side EMVCo QR with correct CRC-16, zero gateway fee (FR-17); `promptparse` also parses slips later
- **pg-boss**: Postgres-backed job queue/scheduler — QR-hold expiry, round cut-off, subscription generation, all without extra infrastructure

**Avoid:** Prisma (weak lock control on Bun/ARM), any payment gateway for PromptPay, Fly/Railway/Render free tiers (cold starts break webhooks), Firebase/Mongo (no SQL transactions for oversell prevention).

### Expected Features

The FR-01..FR-51 list from SRS v0.6 is authoritative; research categorized it and validated the phasing. See `.planning/research/FEATURES.md`.

**Must have (table stakes — lose customers if absent):**
- Product catalog + fixed-weight packs + daily per-variety pricing with **price history** (FR-01/02/36/38)
- Selling round with cut-off + **oversell-safe sellable qty** (FR-03/04, NFR-02) — the #1 Core Value
- LINE Rich Menu + LIFF ordering + Messaging API webhook (FR-46/47/48/13)
- PromptPay QR + slip upload + QR hold/expiry releases stock (FR-17/18/19)
- Order status pipeline + LINE notifications, guest + LINE login + reorder (FR-14/16/25/28)
- Delivery zones/fees/free-ship/round-aware date (FR-20 partial/21/23) + PDPA consent & private slips (NFR-03/04)

**Should have (differentiators — the moat off-the-shelf shops can't do):**
- **Crop plan → harvest calendar → auto sellable qty** (FR-40–44/50) — the reason to build custom
- **Mixed Salad Box limited by scarcest ingredient** (FR-51) — AOV + variety, Phase 1
- **B2B standing order + production-quota reservation** (FR-39) — locks wholesale revenue against forecast
- **Subscription box with pause/skip/cancel** (FR-10) — recurring revenue; candidate to pull into Phase 2

**Defer (v2+):** web storefront (FR-12), promotions/loyalty (FR-27/29), reverse planting (FR-45), lot traceability (FR-05), carrier APIs (FR-24), B2B credit (FR-26), slip OCR (use API instead — do NOT build).

**Explicit anti-features:** in-house OCR/ML slip verification, free-text NLU order chatbot, variable weigh-at-pack pricing on prepaid channels, real-time multi-channel inventory sync, and LINE MyShop (cannot model the harvest/pricing/bundle moat).

### Architecture Approach

A **modular monolith**: one deployable API with bounded-context folders (`auth`, `catalog`, `pricing`, `rounds`, `cropplan`, `orders`, `payments`, `delivery`, `subscription`, `b2b`, `notify`, `webhook`), two static SPAs, one PostgreSQL, cheap object storage, and one scheduled worker. Cross-module calls go through service interfaces; every order-creating path funnels through the `orders/` reservation core. See `.planning/research/ARCHITECTURE.md`.

**Major components:**
1. **Order & inventory-reservation core** — THE HEART: guarded atomic decrement, multi-line/mixed-box all-or-nothing, order status machine (NFR-02)
2. **Payment/QR + reservation-expiry** — PromptPay payload, slip upload, hold-expiry reaper that releases reserved stock (FR-17/18/19)
3. **Rounds (Phase 1 manual qty) <-> Crop-planning (Phase 2 feed)** — kept separate so Phase 1 ships without the crop module existing
4. **Auth** — server-side LIFF token verification (never trust client userId) + guest checkout
5. **Worker/scheduler** — reaper, round open/close, subscription generation, harvest->sellable sync (single-instance/advisory-locked to avoid double runs)

**Key patterns:** guarded atomic decrement (single conditional UPDATE, Read Committed, highest concurrency); reservation-with-expiry tied to the payment hold + lazy expire-on-read; B2B quota as extra columns on `SellingRoundItem`; price/recipe snapshot onto `OrderItem` at order time.

### Critical Pitfalls

Top launch-blocking risks (full 11 in `.planning/research/PITFALLS.md`):

1. **Oversell race under live-selling spikes** — never read-modify-write; use a single guarded atomic DB decrement, reserve at order/QR creation, keep the transaction to pure SQL, make reservation idempotent by order ID. Load-test 2+ concurrent buyers of the last unit.
2. **PromptPay payload incorrectness (CRC/amount/tag)** — never hand-roll TLV; use a maintained EMVCo library, always amount-specified (tag 54), CRC16/CCITT-FALSE over the full string incl. `6304`; scan-test in two real bank apps.
3. **Slip fraud (duplicate/forged/wrong-amount)** — skip OCR, read the slip QR via a Thai slip-verify API (EasySlip/SlipOK/KBank/RDCW), enforce a DB unique constraint on the transaction ref, cross-check amount. **Pull into Phase 1.**
4. **Mixed-box inventory math** — never store stock on the bundle; compute `floor(min(component availability)/qty_per_box)`, decrement all components in one atomic transaction.
5. **PDPA on slips/PII** — private buckets + short-lived signed URLs, consent log at collection, documented retention, separate marketing consent — from Phase 1.

Additional design-ahead risks: LINE push-cost blowout (prefer reply+pull over push-per-status), B2B-vs-B2C quota starvation (explicit allocation layer), subscription cut-off collisions (pause/skip = next-round no-ops), forecast inaccuracy (sell against a discounted forecast + harvest-confirmation gate), cold-chain delivery timing (constrain method/date by round + perishability), and MVP over-engineering (respect the phase split — no queues/microservices/K8s pre-revenue).

## Implications for Roadmap

Research strongly endorses the SRS 3-phase split with a strict internal dependency chain. Suggested structure:

### Phase 0 (Foundation): Backend skeleton + platform clients
**Rationale:** A thin but real foundation must exist before any feature — dependency chain starts here.
**Delivers:** DB + Drizzle migration tooling, single Elysia API skeleton, config/secrets, R2 storage client, LINE API client, RBAC scaffold, Caddy/HTTPS on the VPS.
**Avoids:** MVP over-engineering (Pitfall 11) — one deployable, one DB, no premature infra.

### Phase 1: LINE Commerce MVP
**Rationale:** This is the whole storefront; the reservation core is the project's defining risk and must be proven before any UI, payment, or sales model. Ships with **manual** sellable-qty (crop module deferred) so the store can go live without the most complex module.
**Delivers:** catalog + fixed packs + daily pricing with price history; selling rounds + oversell-safe sellable qty; mixed-salad box; PromptPay QR + slip + hold-expiry reaper; order status + LINE notify; guest/LINE login + reorder; delivery zones/fees; PDPA foundations; Rich Menu + LIFF storefront + admin order/catalog UI.
**Addresses:** FR-01/02/03/04-manual/36/38/51/06/07/13/14/16/17/18/19/25/28/20p/21/23/46/47/48; NFR-02/03/04/07/08.
**Avoids:** oversell race (P1), PromptPay payload (P2), slip fraud (P3 — **pull slip-verify API forward**), bundle math (P5), LINE push cost (P4 — reply+pull), PDPA (P10), cold-chain timing (P9 basic), over-engineering (P11).
**Build order within phase:** Auth -> Catalog/Pricing -> Rounds (manual qty) -> **Order & reservation core** -> Payment/QR -> Notification/Webhook -> Rich Menu/LIFF/Admin UI -> reservation reaper.

### Phase 2: Back-office ops + Crop planning
**Rationale:** Crop forecast needs accumulated actual-harvest data before it can be trusted, so auto-feed comes after the storefront proves out. B2B quota only makes sense once the single-channel reservation path is solid — it is the same guarded decrement with a per-channel guard.
**Delivers:** full order management + packing queue by route; crop module (variety params -> planting batch -> yield calc -> harvest calendar -> actual-harvest log -> planting mix); **auto** sellable-qty feed replacing manual entry; B2B standing order + quota carve-out columns; tax invoice PDF (Thai font); reports; canned auto-replies (NOT free-text NLU).
**Uses:** pg-boss schedulers, Drizzle migrations extending `SellingRoundItem`, pdfmake with embedded Sarabun font.
**Implements:** crop-planning module + harvest->sellable sync + B2B quota carve-out pattern.
**Avoids:** B2B/B2C quota starvation (P6), forecast inaccuracy (P8 — confidence haircut + harvest-confirmation gate, keep manual override).
**Reconsider:** pull **Subscription box (FR-10)** into this phase — its prereqs (rounds, mixed box, accounts/history) all land in Phase 1 and recurring revenue is a stated business driver.

### Phase 3: Web store + marketing + scale
**Rationale:** Defer the web channel until LINE is validated; these are additive on a proven order core.
**Delivers:** web storefront (Nuxt, reuses order core), subscription box (if not pulled to Phase 2), promotions/coupons + loyalty points, full 4-mode delivery + cold-chain + Grab/Lalamove + carrier APIs, LINE broadcast by segment, reverse planting recommendation, lot traceability, slip OCR via API (not built).
**Avoids:** subscription cut-off collisions (P7 — cut-off semantics designed in Phase 1).

### Phase Ordering Rationale

- **Strict dependency chain:** Auth -> Catalog -> Rounds -> Reservation core is non-negotiable; the reservation core is the consistency anchor everything else extends.
- **Manual-before-auto stock (Key Decision):** Phase 1 manual qty de-risks launch; forecast auto-feed (Phase 2) needs real harvest data first — keep manual override permanently as the safety valve.
- **Design-ahead in Phase 1:** the `quota`/`reserved` split, round cut-off + reservation-release semantics, and price snapshot must be built Phase-1-correct so B2B quota, subscriptions, and forecast plug in without a rewrite.
- **Fraud/compliance can't wait:** slip verification and PDPA are Phase 1, not Phase 3, because both risks exist from order #1.

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase`):
- **Phase 2 — Crop planning/forecast:** yield-model parameters (survival %, g/plant, days-to-harvest per variety) are placeholders in the SRS; forecast-to-sellable coupling and the confidence-haircut policy need domain modeling. MEDIUM source coverage.
- **Phase 2/3 — B2B quota allocation + subscription scheduling:** allocation/overflow policy and pause/skip cut-off semantics are business-rule decisions, not documented patterns.
- **Phase 1 — Slip-verification API selection:** concrete provider (EasySlip/SlipOK/KBank/RDCW), pricing tier, and async-verify integration need a focused spike before committing.

Phases with standard patterns (skip research-phase):
- **Phase 0/Phase 1 core stack:** Bun/Elysia/Drizzle/PostgreSQL, LIFF token verification, PromptPay generation, and guarded atomic decrement are all HIGH-confidence, well-documented patterns.
- **Phase 3 web store:** Nuxt over an existing order core is a standard, well-trodden path.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry on research date; hosting/free-tier pricing MEDIUM-HIGH (volatile, reverify at purchase) |
| Features | MEDIUM-HIGH | FR list authoritative from SRS v0.6; industry-norm categorization (slip-verify, CSA pause/skip, MyShop limits) verified across multiple sources |
| Architecture | HIGH | PostgreSQL locking, LIFF/webhook flow, PromptPay EMVCo all confirmed against official docs and stable, established patterns |
| Pitfalls | HIGH | LINE limits, PromptPay payload, slip ecosystem, PDPA verified against official/legal sources; harvest-forecast & cold-chain specifics MEDIUM (domain-reasoned) |

**Overall confidence:** HIGH

### Gaps to Address

- **Harvest-forecast parameters (Phase 2):** SRS section 7 yield table is unfilled. Handle by shipping Phase 1 manual entry, then requiring real per-variety params + a confidence haircut before any auto-feed drives prepaid sales.
- **Slip-verification provider + budget (Phase 1):** exact API, free-tier limits, and async integration need a spike; fallback is duplicate-image-hash + unique-ref + amount floor if an API is out of budget at launch.
- **LINE message-cost break-even (Phase 1/2):** model the free->Basic plan threshold early and dashboard a monthly counter; treat any paid plan as a budget-owner decision.
- **Subscription-into-Phase-2 decision:** depends on recurring-billing effort — flag for validation during roadmap; prereqs are ready but scheduler/dunning cost is the variable.
- **B2B quota overflow policy:** whether B2B eats into the public pool when its slice is exhausted, and who gets cut on a harvest shortfall, are explicit business decisions to encode before Phase 2.

## Sources

### Primary (HIGH confidence)
- npm registry (versions on 2026-06-28); Bun/Elysia/Drizzle official docs — stack versions and capabilities
- LINE Developers docs — LIFF token verification (not profile), webhook signature (HMAC-SHA256), redelivery/dedupe, Rich Menu limits, Messaging API pricing
- dtinth/promptpay-qr + maythiwat/promptparse — EMVCo merchant-presented payload, amount tag 54, CRC16/CCITT-FALSE
- Thai slip-verification APIs (EasySlip/SlipOK/KBank/RDCW + slipverify SDK) — duplicate detection, transaction-ref uniqueness
- Thailand PDPA (in force 2022-06-01) — consent, retention, data-subject rights, penalties
- PostgreSQL locking / atomic decrement references — guarded conditional UPDATE vs FOR UPDATE contention
- SRS v0.6 (`salad-shop-requirements.md`) + `.planning/PROJECT.md` — authoritative project scope, FR/NFR, phase split, harvest model

### Secondary (MEDIUM confidence)
- Neon/Supabase/Hetzner/Cloudflare R2 2026 pricing roundups — free-tier facts (volatile; reverify at purchase)
- CSA/farm-box software norms (CSAware, Harvie, Local Line) — pause/skip/vacation, pack-list sync
- Subscription pause-vs-cancel retention literature — churn-reduction rationale
- LINE Thailand OA plan pricing — message quota/overage economics

### Tertiary (LOW confidence)
- Harvest-yield forecasting specifics (survival %, g/plant) — domain-reasoned, sparse authoritative sources; validate with real farm data
- Cold-chain delivery operational thresholds — domain-reasoned from SRS

---
*Research completed: 2026-06-28*
*Ready for roadmap: yes*
