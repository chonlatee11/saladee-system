# Architecture Research

**Domain:** LINE-OA-first perishable fresh-produce e-commerce (Thai salad), harvest-bound inventory, single low-cost backend + PostgreSQL
**Researched:** 2026-06-28
**Confidence:** HIGH (PostgreSQL locking patterns, LINE LIFF/webhook flow, and PromptPay EMVCo generation are all confirmed against official docs and stable, well-established patterns)

## Standard Architecture

### System Overview

The pragmatic answer for this project is a **modular monolith**: one deployable API backend with internally-bounded modules, two thin static frontends (LIFF + Admin), one PostgreSQL database, cheap object storage, and a single scheduled worker. This is the lowest-cost shape that still gives clean module boundaries you can later peel into services if traffic demands it. Do NOT start with microservices — the cost and operational overhead violate NFR-08 and buy nothing at this scale.

```
┌───────────────────────────────────────────────────────────────────────┐
│                          CLIENT / CHANNEL LAYER                         │
├───────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                 │
│  │ LINE Rich    │   │ LIFF Mini-App│   │ Admin Back-  │   (Web store —  │
│  │ Menu (OA)    │   │ (static SPA) │   │ office (SPA) │    Phase 3)      │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                 │
│         │ deep-link        │ HTTPS+token      │ HTTPS+session            │
│         ▼                  ▼                  ▼                          │
│   LINE Platform ──webhook──┐                                            │
├────────────────────────────┼───────────────────────────────────────────┤
│                    SINGLE API BACKEND (modular monolith)                 │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Webhook Hdlr │  │ Auth (LIFF /  │  │ Catalog &    │  │ Crop-Plan  │  │
│  │ (sig verify) │  │ Admin / guest)│  │ Pricing      │  │ & Harvest  │  │
│  └──────┬───────┘  └───────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                  │                 │                │         │
│  ┌──────▼──────────────────▼─────────────────▼────────┐  ┌────▼──────┐  │
│  │   Order & Inventory-Reservation core (the heart)    │◄─┤ Sellable  │  │
│  │   - guarded atomic decrement (oversell prevention)  │  │ qty feed  │  │
│  └──────┬───────────────────────────────┬──────────────┘  └───────────┘  │
│         │                               │                               │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──▼───────────┐  ┌─────────────┐  │
│  │ Payment/QR   │  │ Notification │  │ Subscription │  │ B2B Quota / │  │
│  │ (PromptPay)  │  │ (LINE push)  │  │ & Standing   │  │ Membership  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  └─────────────┘  │
├─────────┼─────────────────┼─────────────────────────────────────────────┤
│         │                 │            WORKER / SCHEDULER (cron)         │
│         │                 │   reservation-reaper · round-open/close ·    │
│         │                 │   subscription-generate · harvest→sellable   │
├─────────┼─────────────────┼─────────────────────────────────────────────┤
│         ▼                 ▼                  DATA LAYER                   │
│  ┌────────────┐   ┌─────────────────────────────────┐   ┌────────────┐  │
│  │ Object     │   │          PostgreSQL             │   │ LINE       │  │
│  │ Storage    │   │  (single DB, all modules,       │   │ Messaging  │  │
│  │ (slips/img)│   │   row-locked reservations)      │   │ API (push) │  │
│  └────────────┘   └─────────────────────────────────┘   └────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **LIFF mini-app** | Customer storefront inside LINE: browse round, pick pack/qty/mixed box, choose delivery round, address, trigger payment. Stateless; talks only to API. | Static SPA (Vue/Nuxt static or Next static-export). Loads LIFF SDK, calls `liff.getIDToken()`, sends token (never raw profile) to API. |
| **Admin back-office** | Owner/admin/grower/packer console: catalog, daily pricing, rounds, manual sellable qty, order queue, pack list, slip verification, crop planning, dashboards. | Separate static SPA, session/JWT auth, role-based UI. Same API, admin-scoped routes. |
| **API backend** | The single deployable. Hosts all modules below behind one HTTP server. Owns all business logic and DB access. | One service (Elysia/Bun or Go + `pgx`). Modular monolith — folders = bounded contexts, not separate processes. |
| **LINE webhook handler** | Receives Messaging API events, **verifies `x-line-signature` (HMAC-SHA256 over raw body with channel secret)**, dispatches to chat/auto-reply, returns 200 fast. | Module in API. Must read the raw request body for signature; reply via reply-token or enqueue push. |
| **Auth module** | Verify LIFF ID token / access token with LINE Platform, mint app session, resolve/create Customer, handle guest checkout, admin login, RBAC. | Server-side token verification via `POST /oauth2/v2.1/verify` (ID token) or `GET /oauth2/v2.1/verify` (access token); checks `aud`=channel ID, expiry. |
| **Catalog & pricing** | Products, packs (250g/500g), varieties, per-variety daily/round price, price history, mixed-box recipes. | CRUD module; price snapshot copied onto OrderItem at order time. |
| **Crop-planning & harvest** | Variety master, planting plan→batches, expected-harvest calc, harvest calendar, actual-harvest log. Phase 2 feeds sellable qty. | Module; mostly write-light, compute-on-read. Calendar projection job. |
| **Order & inventory-reservation core** | THE HEART. Creates orders, runs atomic reservation against sellable qty, manages reservation lifecycle, order status machine. | Transactional module; owns the guarded-decrement SQL (see Patterns). |
| **Payment / QR** | Generate PromptPay EMVCo QR (amount-specified) server-side, track payment status, hold/expiry, slip upload + admin confirm. | `promptpay-qr` / `promptparse` for payload + CRC; render QR client- or server-side. No gateway → no fees (NFR-08). |
| **Notification** | LINE push on status changes, slip-received, payment confirmed, near-cutoff reminders. | LINE push-message API; called by order/payment modules + worker. |
| **Subscription / standing order** | Recurring B2C subscription boxes and B2B weekly standing orders; auto-generate orders per round; pause/resume/cancel. | Module + scheduled generator (Phase 2/3). |
| **B2B quota / membership** | Reserve harvest quota for B2B before opening remainder to B2C; wholesale pricing; points (Phase 3). | Quota columns on round item (see data model). |
| **Worker / scheduler** | Reservation reaper (release expired holds), round open/close at cut-off, subscription generation, harvest→sellable sync, daily backup trigger. | Single cron process or DB-driven job table; can run in-process at small scale. |
| **PostgreSQL** | Single source of truth for everything incl. reservation counters with row-level locking. | One managed small instance. Daily backup (NFR-05). |
| **Object storage** | Payment slips, product/variety images, generated PDF invoices. | Cheap S3-compatible bucket; signed URLs; access-controlled (PDPA, NFR-03). |

## Recommended Project Structure

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/             # LIFF token verify, sessions, RBAC, guest
│   │   ├── catalog/          # products, packs, varieties, mixed-box recipes
│   │   ├── pricing/          # daily/round per-variety price + history snapshots
│   │   ├── rounds/           # SellingRound, SellingRoundItem (sellable qty)
│   │   ├── cropplan/         # variety master, planting plan/batch, harvest calendar
│   │   ├── orders/           # order lifecycle + RESERVATION CORE (guarded decrement)
│   │   ├── payments/         # PromptPay QR, slip upload, hold/expiry
│   │   ├── delivery/         # methods, zones, fees, free-ship rule
│   │   ├── subscription/     # subscription box + B2B standing order
│   │   ├── b2b/              # quota reservation, wholesale, credit (later)
│   │   ├── notify/           # LINE push wrappers
│   │   └── webhook/          # LINE Messaging API events + signature verify
│   ├── platform/
│   │   ├── db/               # pg pool, migrations, tx helper
│   │   ├── line/             # LINE API client (verify, push, reply)
│   │   ├── storage/          # object-storage client + signed URLs
│   │   └── config/
│   ├── jobs/                 # reaper, round-scheduler, subscription-gen, harvest-sync
│   └── server.ts             # HTTP wiring, route mounting
├── migrations/               # SQL migrations (one DB)
liff-app/                     # static SPA (customer)
admin-app/                    # static SPA (back-office)
```

### Structure Rationale

- **`modules/`:** Bounded contexts as folders. Cross-module calls go through each module's service interface, never reaching into another module's tables directly — this keeps the option open to split later. The one allowed coupling: every order-creating path funnels through `orders/` reservation core.
- **`rounds/` separate from `cropplan/`:** In Phase 1, `SellingRoundItem.sellable_qty` is set manually (FR-04 partial). In Phase 2, `cropplan/` becomes its upstream source (FR-43). Keeping them separate means Phase 1 ships without the crop module existing.
- **`jobs/`:** Time-driven correctness (reservation expiry, cut-off) lives in one worker so there is a single place reasoning about clocks. At small scale it can run inside the API process; the folder boundary lets you extract it cheaply later.

## Architectural Patterns

### Pattern 1: Guarded Atomic Decrement for Oversell Prevention (the core mechanism)

**What:** Treat each `SellingRoundItem` as a counter row with `qty_total` and `qty_reserved`. Reserve stock with a **single conditional UPDATE** whose `WHERE` clause is the availability check. The database evaluates check-and-write as one indivisible step, so no two concurrent orders can both pass the check. Zero rows affected = insufficient stock = reject.

**When to use:** Every path that consumes sellable quantity (B2C checkout, B2B order, subscription generation). This is the answer to NFR-02.

**Trade-offs:** Simplest correct approach, no explicit locks held across app round-trips, works at Read Committed (PostgreSQL's default), highest concurrency. Downside: the reserving statement only protects one row — multi-line orders and mixed boxes need all guarded decrements wrapped in one transaction so any failure rolls back the whole set (all-or-nothing). Prefer this over `SELECT ... FOR UPDATE` + read-modify-write, which holds a lock for the whole transaction and silently serializes throughput under live-sale spikes (NFR-01).

**Example:**
```sql
-- Reserve N packs of one round-item. Single statement = race-free.
UPDATE selling_round_item
   SET qty_reserved = qty_reserved + :n
 WHERE id = :round_item_id
   AND qty_total - qty_reserved >= :n          -- availability guard
RETURNING id;
-- 0 rows -> sold out / not enough -> reject this line.

-- Mixed Salad Box or multi-line order: one transaction, all-or-nothing.
BEGIN;
  -- decrement each component round_item; if ANY returns 0 rows -> ROLLBACK
  -- (a bundle's sellable qty is bounded by its scarcest component, FR-51)
COMMIT;
```

### Pattern 2: Reservation-with-Expiry Tied to the Payment Hold

**What:** A successful guarded decrement creates a `stock_reservation` row with `expires_at` (e.g. QR validity window). The PromptPay QR / payment hold has the same deadline. If payment is not confirmed by then, the reaper releases the hold: it decrements `qty_reserved` back and marks the reservation `expired`. Confirming payment converts the reservation to `committed` (consumed). This satisfies FR-19 ("hold/expire QR → release stock").

**When to use:** All unpaid-pending orders (PromptPay QR and slip-pending). Gives perishable stock back to other buyers fast instead of locking it behind abandoned carts.

**Trade-offs:** Needs a reaper job and idempotent release (never double-release; never release an already-paid reservation). Use a status enum + `WHERE status='pending' AND expires_at < now()` and decrement guarded by the reservation's own row so the reaper and a late payment confirmation cannot race. Lazy alternative: also expire-on-read when an order is fetched, so correctness does not depend solely on cron punctuality.

**Example:**
```sql
-- Reaper (idempotent): release each expired pending hold exactly once.
WITH expired AS (
  UPDATE stock_reservation
     SET status = 'expired'
   WHERE status = 'pending' AND expires_at < now()
  RETURNING round_item_id, qty
)
UPDATE selling_round_item s
   SET qty_reserved = qty_reserved - e.qty
  FROM expired e
 WHERE s.id = e.round_item_id;
```

### Pattern 3: B2B Quota Carve-Out on the Sellable Pool

**What:** Split each round item's pool into a B2B-reserved slice and a public slice so B2B standing orders are guaranteed stock before B2C opens (FR-39). Columns: `qty_total`, `qty_b2b_reserved`, `qty_reserved` (public consumption), `qty_b2b_used`. B2C availability = `qty_total - qty_b2b_reserved - qty_reserved`. B2B availability = `qty_b2b_reserved - qty_b2b_used` (optionally overflowing into the public pool when exhausted). Same guarded-decrement form, different guard expression per channel.

**When to use:** Phase 2 when B2B standing orders + quota arrive. Phase 1 can run with `qty_b2b_reserved = 0`.

**Trade-offs:** A few extra columns instead of a separate reservation table — cheap and keeps the single-statement atomicity. Overflow policy (does B2B eat into public when its slice runs out?) must be an explicit business decision encoded in the guard.

### Pattern 4: Price/Recipe Snapshot at Order Time

**What:** Per-variety price is set daily/per-round and changes; mixed-box recipes can be "whatever's in this round." Copy the resolved unit price, pack weight, and box composition onto `OrderItem` at creation. Never recompute historical order totals from current price tables.

**When to use:** Always — required for correct invoices/tax docs and historical reporting (FR-38, FR-37, FR-32).

**Trade-offs:** Slight denormalization; the payoff is auditable, reprint-safe documents and reports that don't drift when today's price changes.

## Data Flow

### Core ER Relationships (harvest → sellable → order → reservation)

```
                 PlantingPlan (mix recipe per Monday)
                       │ 1
                       │ generates N
                       ▼
Variety 1──N─► PlantingBatch ──(days-to-harvest, survival%, g/plant)──► expected yield
   │                   │
   │                   ▼ projects into
   │            HarvestCalendar (per variety, per week: qty/weight)
   │                   │  (Phase 2) feeds sellable qty
   │                   ▼
   │            SellingRound 1──N─► SellingRoundItem ◄── sellable qty source
   │  (1 per variety available)         │   qty_total / qty_reserved /
   └──────────────► (variety ref)       │   qty_b2b_reserved / qty_b2b_used
                                        │
              ProductPack (250g/500g)───┤  Daily/RoundPrice ──► price history
              MixedSaladBox ─N─► BundleComponent ─► (variety + qty per box)
                                        │ sellable(box) = MIN over components
                                        ▼
                         Order 1──N─► OrderItem ──refs──► SellingRoundItem / Box
                            │              │
                            │              └─► price/recipe SNAPSHOT (frozen)
                            │ 1
                            ├──N─► StockReservation (round_item, qty, expires_at, status)
                            ├──1─► Payment (PromptPay payload, amount, status, hold_expiry, slip_url)
                            ├──1─► Delivery (method, zone, fee, round/date)
                            └──0..1─► InvoiceRequest (tax id, PDF ref)  [FR-37]

Customer (B2C/B2B) 1──N─► Order
Customer 1──0..1─► Subscription / StandingOrder ──generates──► Order per round
```

Key relationship rules:
- **`SellingRoundItem` is the reservation unit.** Sellable qty lives here, never on `Product`. Phase 1: set manually. Phase 2: synced from `HarvestCalendar`.
- **Mixed box does not hold its own stock counter.** Its availability is computed `MIN(component availability)`; reserving a box decrements every component round-item in one transaction (Pattern 1).
- **Price is per-variety-per-day/round, snapshotted onto `OrderItem`** so invoices/reports stay correct historically (FR-38/37).
- **B2B quota is columns on `SellingRoundItem`**, not a parallel inventory.

### Request Flow — LIFF checkout (the critical path)

```
LIFF app (in LINE)
  └─ liff.getIDToken()  ── sends TOKEN (not raw profile) ──►
       Auth module: POST /oauth2/v2.1/verify → resolve/create Customer
         └─► Order module: BEGIN tx
               ├─ guarded atomic decrement per line / per box component
               │     (0 rows anywhere → ROLLBACK → "sold out")
               ├─ create Order + OrderItems (price snapshot)
               ├─ create StockReservation rows (expires_at = QR window)
               └─ COMMIT
         └─► Payment module: generate PromptPay EMVCo payload (amount) → QR
  ◄── QR + order summary ──┘
... customer pays / uploads slip ...
  Payment confirmed → reservation 'committed', order → 'paid'
  Notification module → LINE push "payment received"
  (else) hold_expiry passes → reaper releases qty_reserved, order → 'expired'
```

### LINE Webhook & LIFF Auth Flow (verified against official docs)

- **Webhook:** LINE Platform POSTs events to your endpoint. **Verify `x-line-signature` = Base64(HMAC-SHA256(channelSecret, rawBody))** before trusting anything; reject mismatches. Respond 200 quickly; do slow work (push replies) async. Reply via reply-token (short-lived) or push API.
- **LIFF auth (do this right — common security hole):** The LIFF client must send the **ID token (`liff.getIDToken()`) or access token (`liff.getAccessToken()`) to the backend — never the decoded profile / raw userId**. The backend verifies the token with the LINE Platform (`POST /oauth2/v2.1/verify` for ID token; `GET /oauth2/v2.1/verify` for access token), checks the `aud`/channel ID and expiry, and only then trusts the userId/profile. Sending `userId` from the frontend is spoofable and is the #1 LIFF mistake.
- **Guest checkout** coexists: no token → collect name/phone/address per order; logged-in LINE users get profile reuse.

### State Management (order status machine)

```
created → awaiting_payment ──(paid/confirmed)──► paid → packing → shipping → done
   │            │
   │            └──(hold expiry / no slip)──► expired ──► stock released
   └──(admin/customer)──► cancelled ──► stock released
```
Stock is released exactly on transitions into `expired`/`cancelled`, and only if the reservation is still `pending` (idempotency guard).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1k users (now) | Single API instance + small managed Postgres + cheap object storage + in-process cron. Modular monolith. This is the whole system. |
| 1k–100k users / live-sale spikes (NFR-01) | Add a connection pooler (PgBouncer) — webhook + LIFF bursts open many short connections. Run 2+ stateless API instances behind the host's load balancer; move cron to its own process (avoid duplicate reaper runs — use a DB advisory lock or single-instance job runner). Add a read replica only if dashboards/reports strain the primary. |
| 100k+ users / multi-region | Consider extracting the webhook handler (spiky, latency-sensitive, must 200 fast) and the notification/push worker into separate deployables. The reservation core stays on the primary Postgres — keep it single-writer; that single-statement guarded decrement is the consistency anchor and should not be sharded casually. |

### Scaling Priorities

1. **First bottleneck:** Database connections during live sales / broadcast spikes. Fix with a pooler + keeping transactions tiny (the guarded decrement is a single statement — keep it that way; never hold a tx open across a LINE API call).
2. **Second bottleneck:** The webhook endpoint under broadcast reply storms. Fix by ack-200-immediately and pushing replies from a queue/worker, not inline.

## Anti-Patterns

### Anti-Pattern 1: Read-modify-write stock (or `SELECT FOR UPDATE` + app-side check)

**What people do:** `SELECT qty`, check in app code, then `UPDATE qty = qty - n`. Or wrap it in `SELECT ... FOR UPDATE` and hold the lock while calling LINE/payment APIs.
**Why it's wrong:** The plain version oversells under concurrency (the classic lost-update). The `FOR UPDATE` version is correct but serializes buyers and, if the transaction also makes network calls, holds the row lock for hundreds of ms — throughput collapses exactly during the live-sale spike you most care about (NFR-01/02).
**Do this instead:** Single guarded atomic decrement (Pattern 1). Keep the transaction to pure SQL; do payment/LINE calls after commit.

### Anti-Pattern 2: Trusting frontend-supplied LINE userId / profile

**What people do:** LIFF sends `userId` or the decoded profile to the backend, backend trusts it.
**Why it's wrong:** Trivially spoofable — anyone can call your API with someone else's userId and impersonate them or place orders on their account.
**Do this instead:** Send the ID/access token, verify server-side with the LINE Platform, derive userId from the verified payload only.

### Anti-Pattern 3: Putting sellable quantity on the Product

**What people do:** A single `stock` integer on the product/SKU.
**Why it's wrong:** This domain's stock is per harvest round, multi-variety, and time-boxed (Section 2.1 of SRS). A product-level number can't express "30 packs of green oak available in the Thursday round" or mixed-box scarcity, and it breaks the harvest-calendar feed.
**Do this instead:** Sellable qty on `SellingRoundItem`; product is just catalog metadata.

### Anti-Pattern 4: Computing historical totals from current price tables

**What people do:** Recompute an old order's total from today's per-variety price.
**Why it's wrong:** Daily prices change; invoices/tax docs (FR-37) and reports (FR-32) would silently drift and become non-reprintable.
**Do this instead:** Snapshot price/pack/recipe onto `OrderItem` at order time (Pattern 4).

### Anti-Pattern 5: Relying only on the cron reaper for hold release

**What people do:** Only release expired reservations via the scheduled job.
**Why it's wrong:** If cron is late/misfires, perishable stock stays locked behind abandoned carts and shows "sold out" wrongly.
**Do this instead:** Reaper + lazy expire-on-read, both idempotent and guarded by reservation status.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| LINE Messaging API (webhook in) | HTTPS POST; verify `x-line-signature` HMAC-SHA256 over raw body | Need raw (unparsed) body for signature; return 200 fast; reply-token is short-lived. |
| LINE Messaging API (push out) | Server→LINE push for status/slip/payment notices | Rate limits apply; batch broadcasts (FR-31) carefully. |
| LINE Login / LIFF | Server-side token verify (`/oauth2/v2.1/verify`) | Check `aud`=channel ID + expiry; never trust frontend userId. |
| PromptPay (no gateway) | Generate EMVCo payload server-side (`promptpay-qr`/`promptparse`), compute CRC | No fees (NFR-08). Payment confirmation is manual/slip in Phase 1; OCR deferred (Phase 3). |
| Object storage (S3-compatible) | Signed-URL upload/download for slips, images, invoice PDFs | Access-controlled per PDPA (NFR-03/04); short-lived URLs. |
| Logistics APIs (Flash/Kerry/Grab) | Deferred — manual tracking numbers in Phase 1–2 | Wire real APIs in Phase 3 (FR-24). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| cropplan ↔ rounds | cropplan writes/syncs sellable qty into SellingRoundItem (Phase 2) | Phase 1: rounds standalone, manual qty. Keep one-directional. |
| orders ↔ rounds | orders performs guarded decrement on SellingRoundItem within its tx | The single critical coupling; all order paths funnel here. |
| orders ↔ payments | orders creates reservation+hold; payments confirm/expire flips reservation state | Idempotent state transitions; release-on-expire guarded by status. |
| payments/orders ↔ notify | fire-and-forget after commit | Never inside the reservation transaction. |
| webhook ↔ auth/orders | webhook dispatches events; chat-order (Phase 2) reuses order core | Webhook stays thin; no business logic duplicated. |
| jobs ↔ all | scheduled reaper/round/subscription call module services | Single-instance or advisory-locked to avoid double execution. |

## Build Order (dependency-ordered, mapped to the SRS 3-phase roadmap)

**Foundation (before Phase 1 features):** DB + migration tooling, single API skeleton, config/secrets, object-storage client, LINE API client. RBAC scaffold.

**Phase 1 — LINE Commerce MVP** (FR-46–48, 01–03, 36, 38, 51, 04-manual, 13–14-basic, 17–19, 25, 28, 20-partial, 21; NFR-04/08)
1. **Auth** — LIFF token verification + guest. *(Everything authenticated depends on this.)*
2. **Catalog & pricing** — products, packs, varieties, daily per-variety price + history, mixed-box recipe.
3. **Rounds** — SellingRound + SellingRoundItem with **manual** sellable qty. *(Depends on catalog/varieties.)*
4. **Order & reservation core** — guarded atomic decrement, multi-line + mixed-box all-or-nothing, status machine. *(Depends on rounds.)* — highest-risk, most valuable; build and load-test early.
5. **Payment/QR** — PromptPay payload + slip upload + hold/expiry + reservation release. *(Depends on order core.)*
6. **Notification** + **Webhook handler** — signature verify, status push.
7. **Rich Menu + LIFF storefront + Admin order/catalog UI** — thin clients over the above.
8. **Reservation reaper job** — release expired holds.

**Phase 2 — Order ops + Crop planning** (FR-14/15 full, 40–44, 50, 04-auto, 37, 39, 16/49, 32)
9. **Crop-planning module** — variety master params, planting plan→batches, expected yield, harvest calendar, actual-harvest log.
10. **Harvest→sellable sync** — replace manual qty with calendar feed (FR-43). *(Depends on #3 + #9.)*
11. **B2B quota carve-out** — quota columns + per-channel guards (FR-39). *(Depends on order core.)*
12. **Standing orders + status chatbot + pack queue + invoices (PDF) + reports.**

**Phase 3 — Web store + marketing + scale** (FR-12, 29, 27, 10, full delivery, 31, 45, logistics/OCR APIs, FB/TikTok, 05)
13. **Subscription box generator**, **web storefront** (reuses order core), **promotions/coupons + points**, **full 4-mode delivery + logistics APIs**, **broadcast**, **planting recommendation (reverse from demand)**, **lot traceability**, **slip OCR**.

**Why this order:** Auth → catalog → rounds → reservation core is a strict dependency chain, and the reservation core is the project's defining risk (NFR-02, Core Value). It must exist and be proven before payment, UI, or any sales model. Crop planning is deliberately Phase 2: the SRS lets Phase 1 ship with manual sellable qty, so the storefront can go live without the most complex module. B2B quota and subscription only make sense once the single-channel reservation path is solid, because both are variations on the same guarded-decrement mechanism.

## Sources

- LINE Developers — Using user data in LIFF apps and servers (token-not-profile rule): https://developers.line.biz/en/docs/liff/using-user-profile/ — HIGH
- LINE Developers — Get profile information from ID tokens / verify: https://developers.line.biz/en/docs/line-login/verify-id-token/ — HIGH
- LINE Developers — Managing access tokens (`/oauth2/v2.1/verify`): https://developers.line.biz/en/docs/line-login/managing-access-tokens/ — HIGH
- LINE Developers Thailand — "Stop sending userId from frontend to backend": https://medium.com/linedevth/ (anti-pattern confirmation) — MEDIUM
- dtinth/promptpay-qr (EMVCo Merchant-Presented payload, JS): https://github.com/dtinth/promptpay-qr — HIGH
- maythiwat/promptparse (PromptPay & EMVCo build/parse/CRC): https://github.com/maythiwat/promptparse — HIGH
- Harry's Engineering — Atomic increment/decrement operations in SQL and locks: https://medium.com/harrys-engineering/atomic-increment-decrement-operations-in-sql-and-fun-with-locks-f7b124d37873 — MEDIUM
- Stormatics — SELECT FOR UPDATE contention in PostgreSQL: https://stormatics.tech/blogs/select-for-update-in-postgresql — MEDIUM
- "Building an Inventory System: Overselling, Atomic Decrements, Stock Reservation Under Load": https://medium.com/womenintechnology/building-an-inventory-system-overselling-atomic-decrements-and-stock-reservation-under-load-77fa06507a54 — MEDIUM
- SRS v0.6 (`salad-shop-requirements.md`) + `.planning/PROJECT.md` — project source of truth

---
*Architecture research for: LINE-OA-first perishable fresh-produce e-commerce (harvest-bound inventory, low-cost single-backend + PostgreSQL)*
*Researched: 2026-06-28*
