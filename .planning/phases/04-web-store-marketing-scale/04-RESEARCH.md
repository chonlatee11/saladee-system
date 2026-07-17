# Phase 4: Web Store, Marketing & Scale - Research

**Researched:** 2026-07-17
**Domain:** Omnichannel commerce extension — public SSR storefront, promotions/loyalty, LINE broadcast + guided bot, multi-carrier tracking, demand-driven planting
**Confidence:** HIGH (codebase analogs verified by direct read; external stack versions verified via npm; a few economics/limits marked ASSUMED)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Web storefront = **Nuxt (Vue) SSR**, a NEW app alongside `web/` (LIFF SPA) and `web-admin/`. Reuses `web/` Vue components + Eden Treaty typed client. (Not Next.js.)
- **D-02:** Full checkout parity on web — its own cart → checkout → PromptPay QR → slip-upload, reusing Phase-2 payment services. NOT browse-then-handoff-to-LINE.
- **D-03:** Guest checkout allowed (no login required), mirroring the Phase-2 guest path. Members/loyalty optional at web checkout.
- **D-04:** Web store uses the SAME round-based pre-order model as LINE (same round availability + cut-off + delivery-round pick). No separate "ready-to-ship only" web catalog.
- **D-05:** Responsive = a DISTINCT desktop layout (hero, multi-column catalog, `store-max` 1200px), not a stretched mobile view; still degrades mobile-first (NFR-07).
- **D-06:** Full SEO — SSR product pages + sitemap + meta/OG + product JSON-LD. Real domain (replacing `sslip.io`) is a prerequisite (deferred provisioning).
- **D-07:** One coupon per order — NO coupon stacking.
- **D-08:** Coupon usage limits enforced BOTH globally AND per-customer (both counters tracked).
- **D-09:** Loyalty points redeem as a baht discount (points → baht off). No freebie/reward catalog.
- **D-10:** Flat loyalty — NO member tiers.
- **D-11:** Earn rate + points→baht conversion are configurable in system settings (reuse Phase-3 `settings` hot-config). No hardcoded economics.
- **D-12:** Points earn when an order reaches `paid`, computed on the order value; points do NOT expire in MVP. A coupon and a points-redemption may BOTH apply to one order (independent mechanisms).
- **D-13:** Promotion applicability is configurable per-promotion (which channels/segments a promo applies to). Default: new promo targets B2C retail.
- **D-14:** Coupon entry is a field at checkout on BOTH web and LIFF; segment codes AUTO-APPLY when the customer arrives via a broadcast/link carrying the code.
- **D-15:** Customer segments = predefined (B2C / B2B / subscription member / inactive, reuse Phase-3 customer types) + admin-applied free tags.
- **D-16:** Broadcast delivery = LINE **multicast** to the segment's userIds (NOT broadcast-to-all-followers) — controls LINE OA quota cost (NFR-08).
- **D-17:** PDPA — broadcasts go ONLY to customers who granted marketing consent, with an opt-out mechanism. Filter by `consent_logs.consent_type = "marketing"`. Non-negotiable (NFR-04).
- **D-18:** Broadcasts support send-now AND scheduled send (reuse pg-boss), with rich content (Flex / image / promo link).
- **D-19:** Conversational bot = guided flow, NO LLM. Extend the Phase-3 canned `webhook.ts` router with a quick-reply/postback state machine. Deterministic, zero cost (NFR-08).
- **D-20:** The bot gathers order intent in chat, then deep-links to LIFF to complete checkout/payment. The bot NEVER handles money directly.
- **D-21:** Hybrid tracking — ship MANUAL entry now behind a carrier-adapter seam (mirror the Phase-2 slip-provider adapter). No live carrier API this phase.
- **D-22:** Delivery status is a defined enum, staff-updated; each transition notifies the customer via LINE (reuse Phase-2 status-notification seam).
- **D-23:** Recommendation = trailing average of demand over the last N rounds, converted to plant counts via Phase-3 per-variety params (g/plant, survival %). N tunable.
- **D-24:** Demand signal = realized sales PLUS unmet demand (back-in-stock requests), so stockouts don't hide demand.
- **D-25:** Surface as a recommendation CARD in the crop-planning page that PREFILLS the Phase-3 planting-mix template, with full admin override. Not a separate read-only report.
- **D-26:** Admin uploads product photos through a real pipeline (upload → sharp → R2 → stored URL), reusing the Phase-2 slip upload seam. Not paste-a-URL.
- **D-27:** Images render everywhere — web store, LIFF catalog, broadcast Flex cards (catalog API already returns `imageUrl`).
- **D-28:** Multiple images per product (gallery) — new `variety_images` (+ box equivalent) child table; existing `varieties.imageUrl`/`boxes.imageUrl` becomes the cover image (backward compatible).

### Claude's Discretion
- Default loyalty earn rate / conversion seed values (D-11) — pick sensible Thai-market defaults; owner tunes in settings.
- Exact N-round window for CROP-07 trailing average (D-23) — choose from data available; make configurable if cheap.
- Precise delivery-status enum labels/order (D-22) — palette mapping in UI-SPEC is binding; labels refinable.
- Storage visibility (public vs signed) for product images (D-26) — default to a public R2 path (marketing assets, unlike private slips) unless a reason to sign emerges.

### Deferred Ideas (OUT OF SCOPE)
- Real carrier API integration (Grab/Lalamove live tracking/booking) — adapter seam only now.
- LLM/NLU free-text chatbot — guided flow ships now.
- Loyalty member tiers (bronze/silver/gold) and points expiry.
- Coupon stacking and reward/freebie redemption catalog.
- Real production domain to replace `sslip.io` (prerequisite for SEO web store — provisioning task, not a design decision).
- B2B credit-limit/blocking, prepaid/recurring subscription billing.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORD-05 (FR-12) | Customer orders via web (cart → checkout) | **Zero new order/payment endpoints needed** — `POST /orders` already supports the guest path (D-03) with server-resolved pricing + atomic reservation; `GET /orders/:id/qr` + `POST /orders/:id/slip` are already public (order-UUID only). Web store = frontend reuse (§Area 1). |
| MKT-01 (FR-29) | Admin creates promotions/coupons | New `coupons`/`coupon_redemptions` schema + atomic guarded-UPDATE redemption (§Area 2); composes into `POST /orders` tx before QR. |
| CUST-03 (FR-27) | Membership/loyalty points | New `loyalty_ledger` append-only earn/redeem; earn on `paid` via the `applyTransition` seam; redeem in the order tx; economics in `settings` (§Area 2). |
| MKT-03 (FR-31) | Segmented LINE broadcast | `@line/bot-sdk` v11 `multicast()` (verified installed) to consented segment userIds; new `broadcasts`/`customer_tags` schema; pg-boss scheduled send (§Area 3). |
| LINE-04 (FR-49) | Conversational order bot + broadcast | Extend `webhook.ts` canned router into a postback state machine that deep-links to LIFF (§Area 4). |
| DEL-05 (FR-24) | Carrier tracking number/status | Carrier-adapter seam (mirror slip-verify), new `delivery_status` enum + tracking fields, status push reuses `notify.ts` (§Area 5). |
| CROP-07 (FR-45) | Demand-driven reverse planting recommendation | Trailing-demand aggregate (reports-style) + inverse of `forecast.ts` kernel; prefill planting-mix card (§Area 6). |
</phase_requirements>

## Summary

Phase 4 is overwhelmingly an **extension-and-reuse** phase, not a greenfield one. The Phase 0–3 order/reservation/payment/delivery/crop core is already the exact substrate every Success Criterion needs. The single most important finding: **the public web storefront requires no new order or payment API** — `POST /orders` already has a fully server-authoritative guest path (no auth), and `GET /orders/:id/qr` + `POST /orders/:id/slip` are already public and identified only by the order UUID. So the web store (D-01/02) is a new Nuxt frontend calling the *existing* endpoints via Eden Treaty; the oversell guard (NFR-02) is never touched.

The genuinely new backend work is four additive schema areas (coupons, loyalty ledger, broadcasts+tags, product images, carrier tracking) plus the logic that composes coupon/points into the existing order-total → PromptPay-QR path. Every one of these has a proven codebase pattern to copy: the **guarded conditional UPDATE** (`reservation.ts`) for atomic coupon-limit decrement, the **UNIQUE-constraint-as-idempotency-arbiter** (payments dedup, subscription_orders) for per-customer coupon limits and points-earn idempotency, the **env-selected adapter seam** (`slip-verify/index.ts`) for the carrier adapter, the **`registerOrderNotifier` / `applyTransition` milestone seam** for loyalty-earn-on-paid and carrier-status pushes, the **pg-boss queue+worker** (`boss.ts`) for scheduled broadcasts, and the **additive-migration + register-in-every-self-resetting-test** idiom (0004) for schema growth.

**Primary recommendation:** Plan as thin vertical slices that each reuse a named existing file. Add exactly one additive migration (`0005_phase4`) and register it in every self-resetting test's down/up sequence (the Phase-3 0004 lesson). Keep all money in integer satang and preserve the whole-baht PromptPay invariant when applying discounts. Never introduce a second reservation path, a client-trusted price/points value, or a broadcast that bypasses the marketing-consent filter.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Public storefront browse/catalog | Frontend Server (Nuxt SSR) | API (existing `GET /catalog`) | SSR needed for SEO (D-06); catalog data already served by the API |
| Web cart state | Browser (Nuxt client) | — | Cart is ephemeral client state (mirror `web/src/stores/cart.ts`) |
| Web checkout / reservation | API (`POST /orders`) | Frontend (form) | Reservation correctness is a DB property; already server-authoritative |
| PromptPay QR / slip verify | API (`payments.ts`) | Browser (display/upload) | Money + dedup are server-only; endpoints already public |
| Coupon validation + redemption | API (order tx) | DB (guarded UPDATE / UNIQUE) | Atomic limit enforcement is a DB property, like reservation |
| Loyalty earn/redeem + balance | API + DB (`loyalty_ledger`) | — | Balance is server-authoritative; never client-trusted |
| Segmented broadcast send | API + pg-boss worker | LINE Messaging API | Consent filter + multicast are server-side; quota-cost sensitive |
| Marketing-consent gate | DB (`consent_logs`) | API | PDPA is a data-authority concern (NFR-04) |
| Conversational bot flow | API (`webhook.ts`) | LINE + LIFF (payment handoff) | Signature + routing are server-side; bot never handles money (D-20) |
| Carrier tracking record + status push | API + DB | LINE (`notify.ts`) | Adapter seam + status enum are server-side; push reuses Phase-2 seam |
| Demand recommendation compute | API (aggregate + pure kernel) | Frontend (admin card) | Pure compute over existing tables; prefill is a UI concern |
| Product image upload/store | API (`sharp` + R2) | web-admin (uploader) | Binary pipeline + storage are server-side (reuse slip pipeline) |

## Standard Stack

The API stack is **fixed and unchanged** (CLAUDE.md): Bun 1.3.14, Elysia 1.4.29, Drizzle 0.45.2, postgres.js 3.4.9, PostgreSQL 17, `@line/bot-sdk` 11.0.2, `promptpay-qr` 0.5.0, `qrcode` 1.5.4, `pg-boss` 12.23.0, `sharp` 0.35.2, `jose` 6.2.3. **No new API runtime dependency is required by this phase** — every backend capability is built from libraries already installed. `[VERIFIED: api/package.json]`

The only genuinely new dependency surface is the **Nuxt web-store frontend** (D-01).

### Core (new — web-store app only)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `nuxt` | 4.4.8 | Vue SSR framework for the public store | Official Vue SSR meta-framework; reuses `web/` Vue 3 components + Tailwind v4; delivers D-06 SSR/SEO. `[VERIFIED: npm registry]` (weekly downloads ~1.58M, repo github.com/nuxt/nuxt) |
| `@nuxtjs/seo` | 5.3.2 | SEO module suite (sitemap, OG image, schema.org JSON-LD, robots, meta) | One umbrella module covers ALL of D-06 (sitemap + OG tags + product structured data). Maintained by harlan-zw (canonical Nuxt SEO author). `[VERIFIED: npm registry]` — see Legitimacy Audit |
| `@elysiajs/eden` | 1.4.9 | Typed API client in Nuxt | Same Eden Treaty client `web/` uses (`treaty<App>()`); compile-time-safe calls to the existing API. Already a dependency. `[VERIFIED: web/package.json]` |
| `tailwindcss` | 4.3.1 | Styling (CSS-first) | Reuse the shared `@theme` token block verbatim (04-UI-SPEC binding). `[CITED: 04-UI-SPEC]` |

### Supporting (existing API libs — the phase's real toolkit)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@line/bot-sdk` `MessagingApiClient` | 11.0.2 | `multicast()` for segmented broadcast (D-16); `pushMessage()` for carrier-status notify (D-22) | `multicast`/`narrowcast`/`broadcast`/`pushMessage` all confirmed present in installed v11. `[VERIFIED: node_modules/@line/bot-sdk]` |
| `pg-boss` | 12.23.0 | Scheduled broadcast queue (D-18); optional CROP-07 recompute | Reuse `boss.ts` queue+worker idiom on `DATABASE_URL_DIRECT` |
| `sharp` | 0.35.2 | Product-image compress (D-26) | Reuse `sharpCompress` from `payments.ts` |
| `drizzle-orm` + `drizzle-kit` | 0.45.2 / 0.31.10 | Additive migration `0005_phase4` | Same additive idiom as `0003`/`0004` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nuxt SSR | Vue SPA reuse of `web/` | Rejected by D-01 (SEO needs SSR). SPA would fail D-06 (no server-rendered product HTML / JSON-LD for crawlers). |
| `@nuxtjs/seo` umbrella | Individual `@nuxtjs/sitemap` + `nuxt-og-image` + `nuxt-schema-org` | Umbrella is one dependency covering all four; individual modules add install surface. Umbrella recommended. |
| pg-boss cron for CROP-07 | On-demand compute in a `GET` endpoint | On-demand is cheaper (NFR-08) and matches D-25 (card computed when admin opens the page). Recommend on-demand; scheduled job only if caching becomes necessary. |
| Nuxt SSR on Cloudflare Pages (nitro `cloudflare-pages` preset) | Nuxt SSR on the existing VPS (behind Caddy) | Pages free-tier edge SSR keeps NFR-08 low but adds a runtime; VPS reuses existing infra. Planner/human decision — see Environment Availability. |

**Installation (web-store app only):**
```bash
# new package: web-store/  (separate from web/ and web-admin/)
bun add nuxt@4.4.8 @nuxtjs/seo@5.3.2 @elysiajs/eden@1.4.9
bun add -d tailwindcss@4.3.1 @tailwindcss/vite
# NO new dependency is added to api/
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `nuxt` | npm | mature | ~1.58M/wk | github.com/nuxt/nuxt | OK | Approved |
| `@nuxtjs/seo` | npm | recent publish | ~72k/wk | github.com/harlan-zw/nuxt-seo | SUS (`too-new` publish date only) | Approved with checkpoint — high downloads + canonical Nuxt-SEO author repo; the SUS flag is purely the recent version timestamp of an actively-released package |
| `@nuxtjs/sitemap` | npm | recent publish | ~224k/wk | github.com/nuxt-modules/sitemap | SUS (`too-new`) | Only if NOT using the `@nuxtjs/seo` umbrella; else omit |
| `nuxt-og-image` | npm | recent publish | ~121k/wk | github.com/nuxt-modules/og-image | SUS (`too-new`) | Only if NOT using the umbrella; else omit |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `@nuxtjs/seo` (and the individual SEO modules if used). The SUS reason is exclusively `too-new` (the latest release is recent) — all have healthy weekly downloads (72k–224k) and legitimate, well-known Nuxt-ecosystem repos. The planner should add a single `checkpoint:human-verify` before installing `@nuxtjs/seo` so the owner confirms the module version at install time, then treat as OK.

*Verified via `gsd-tools query package-legitimacy check --ecosystem npm` on 2026-07-17. All four resolve on the npm registry with no postinstall scripts.*

## Architecture Patterns

### System Architecture Diagram

```
                         ┌───────────────────────────────────────────┐
   Public web (desktop   │              EXISTING API (Elysia/Bun)     │
   + mobile browser)     │                                            │
        │                │   POST /orders ─────► reserve() guarded    │
        ▼                │      │  (atomic, unchanged NFR-02)          │
  ┌─────────────┐  Eden  │      │  + coupon guarded-UPDATE (NEW)       │
  │  Nuxt SSR   │───────►│      │  + points ledger redeem (NEW)        │
  │ web-store/  │  HTTPS │      ▼  discount → total → PromptPay QR     │
  │ (SEO, cart) │◄───────│   GET /orders/:id/qr   POST /orders/:id/slip│
  └─────────────┘        │      (public, order-UUID only — reused)    │
                         │                                            │
  LINE app               │   applyTransition(paid) ──► loyalty EARN   │
    │  webhook           │      seam (registerOrderNotifier) ──► notify│
    ▼  (signature)       │                                     (LINE)  │
  ┌─────────────┐        │   webhook.ts bot state machine (NEW) ──────┼──► LIFF deep-link (pay)
  │ guided bot  │───────►│   multicast() ◄── consent filter (marketing)│
  │ + broadcast │        │      ▲                                      │
  └─────────────┘        │   pg-boss: broadcast-send (scheduled, NEW)  │
                         │   carrier adapter seam ──► delivery_status  │
  web-admin/             │      ▲ manual entry now, Grab/Lalamove later│
  (promo, loyalty,       │   crop recommendation = trailing demand     │
   broadcast, tracking,  │      (order_lines + back_in_stock) × inverse │
   planting card)  ─────►│      forecast kernel ──► prefill mix card   │
                         └───────────────────────────────────────────┘
                                        │
                                   PostgreSQL 17
                    (round_stock guard UNCHANGED; +coupons, loyalty_ledger,
                     broadcasts, customer_tags, variety_images, delivery
                     tracking — additive 0005; R2 for slips + product photos)
```

### Recommended Project Structure
```
web-store/                 # NEW Nuxt SSR app (D-01)
├── nuxt.config.ts         # @nuxtjs/seo, tailwind, VITE_API_URL, nitro preset
├── app.vue
├── assets/style.css       # @import "tailwindcss"; + @theme copied from web/src/style.css (UI-SPEC)
├── components/            # reuse web/ SFCs (VarietyCard, QtyStepper, SlipUploader, DeliveryMethodTiles...)
├── composables/useApi.ts  # treaty<App>(API_URL) — Eden client
├── stores/cart.ts         # mirror web/src/stores/cart.ts
└── pages/
    ├── index.vue          # SSR hero + catalog (GET /catalog)
    ├── p/[id].vue         # SSR product page + JSON-LD (SEO)
    └── checkout.vue       # cart → POST /orders → QR → slip (reuse endpoints)

api/src/
├── db/schema.ts           # + coupons, couponRedemptions, loyaltyLedger, broadcasts,
│                          #   customerTags, varietyImages, boxImages, deliveryStatus enum + tracking cols
├── drizzle/0005_phase4.sql (+ .down.sql)   # additive migration
├── services/
│   ├── coupon.ts          # NEW: validate + guarded redeem (mirror reservation.ts)
│   ├── loyalty.ts         # NEW: earn/redeem ledger, balance (settings-configured rate)
│   ├── broadcast.ts       # NEW: audience resolve (consent filter) + multicast chunking
│   ├── carrier/           # NEW adapter seam (mirror services/slip-verify/)
│   │   ├── index.ts       # makeCarrierAdapter(env) switch
│   │   ├── manual.adapter.ts
│   │   └── types.ts
│   └── crop-recommend.ts  # NEW: trailing-demand aggregate + inverse forecast
├── routes/
│   ├── coupons.ts         # NEW admin CRUD (requireRole owner|admin)
│   ├── loyalty.ts         # NEW: GET balance (member), redeem composes in orders.ts
│   ├── broadcasts.ts      # NEW admin compose/schedule/send
│   ├── tracking.ts        # NEW admin carrier entry + status PATCH
│   ├── product-images.ts  # NEW admin upload (reuse sharp+R2)
│   ├── crop.ts            # + GET /crop/planting-recommendation
│   ├── orders.ts          # EDIT: accept couponCode + redeemPoints, apply pre-QR
│   ├── webhook.ts         # EDIT: bot postback state machine (signature block UNCHANGED)
│   └── catalog.ts         # EDIT (small): include image gallery in payload (D-27/28)
├── services/order-transition.ts  # EDIT: earn loyalty on entering `paid` (idempotent)
├── services/settings.ts   # EDIT: add loyalty + pdpa policy keys to HOT_KEYS allow-list
└── jobs/boss.ts           # EDIT: + broadcast-send queue/worker
```

### Pattern 1: Atomic coupon redemption = guarded conditional UPDATE (copy `reserve()`)
**What:** Global usage-limit enforcement is a DB property, exactly like stock reservation.
**When to use:** MKT-01 global limit (D-08). The per-customer limit uses a UNIQUE arbiter instead (Pattern 2).
```sql
-- Source: mirrors api/src/services/reservation.ts reserve() — VERIFIED codebase pattern.
-- Runs INSIDE the POST /orders transaction. Zero rows ⇒ exhausted ⇒ reject/rollback.
UPDATE coupons
   SET global_used = global_used + 1
 WHERE code = $1
   AND active = true
   AND (expires_at IS NULL OR expires_at > now())
   AND (global_limit IS NULL OR global_used < global_limit)
RETURNING id, discount_kind, discount_value, min_subtotal_satang;
```

### Pattern 2: Per-customer limit + points-earn idempotency = UNIQUE constraint as arbiter
**What:** A UNIQUE index makes a duplicate a `23505`, not a race — the codebase already uses this three times (`payments_trans_ref_idx`, `subscription_orders_sub_round_idx`, harvest `_batch_idx`).
**When to use:** per-customer coupon cap (D-08), and points-earn-once-per-order (D-12).
```ts
// Source: pattern from payments.ts isUniqueViolation() + subscription_orders (VERIFIED).
// coupon_redemptions UNIQUE(coupon_id, customer_id) → 2nd redemption throws 23505 → 409 "coupon_already_used".
// loyalty_ledger UNIQUE(order_id) WHERE kind='earn' → pg-boss/late transition re-run is a safe no-op.
try {
  await tx.insert(couponRedemptions).values({ couponId, customerId, orderId });
} catch (e) {
  if (isUniqueViolation(e)) throw new OrderError("coupon_already_used", 409);
  throw e;
}
```

### Pattern 3: Loyalty earn on `paid` via the existing milestone seam
**What:** `applyTransition()` already fires a single guarded action when an order enters `paid`. Earn points there, inside the same tx, idempotently.
**When to use:** D-12 earn-on-paid. Prefer an in-tx ledger insert (not the fire-and-forget notifier) because earning is a durable DB write that must roll back with the transition.
```ts
// Source: api/src/services/order-transition.ts (VERIFIED). Add an in-tx branch:
if (next === "paid" && current !== "paid") {
  // rate + conversion from settings hot-config (D-11); computed on order value (D-12).
  // UNIQUE(order_id) WHERE kind='earn' guarantees exactly-once even on re-entry.
  await earnPoints(tx, orderId);   // insert positive loyalty_ledger row, ON CONFLICT DO NOTHING
}
```

### Pattern 4: Carrier adapter seam (copy `services/slip-verify/index.ts`)
```ts
// Source: api/src/services/slip-verify/index.ts (VERIFIED). One-line vendor switch, no route edit later.
export function makeCarrierAdapter(provider = env.CARRIER_PROVIDER): CarrierAdapter {
  switch (provider) {
    case "manual": return new ManualCarrierAdapter();   // D-21 now
    // case "grab": return new GrabAdapter();            // later phase, no rework
    default: throw new Error(`unknown CARRIER_PROVIDER: ${provider}`);
  }
}
```

### Pattern 5: Scheduled broadcast (copy `boss.ts` queue+worker)
```ts
// Source: api/src/jobs/boss.ts (VERIFIED). Define queue+worker in boss.ts; trigger from the route.
await boss.createQueue("broadcast-send");
await boss.work("broadcast-send", async (jobs) => {
  for (const job of jobs) await runBroadcast(db, (job.data as { broadcastId: string }).broadcastId);
});
// Route: send-now → boss.send("broadcast-send", { broadcastId });
//        scheduled → boss.send("broadcast-send", { broadcastId }, { startAfter: secondsUntil });
```

### Pattern 6: Discount composes into the total BEFORE the PromptPay payload
**What:** In `orders.ts`, the QR is built from `totalSatang = subtotal + fee`. Coupon + points discounts must reduce that number *before* `buildPromptPayPayload(..., totalSatang / 100)`.
**Critical invariant:** the QR amount must stay whole-baht (the code relies on "whole-baht prices + whole-baht fees guarantee X.00"). Compute discounts in whole baht (or floor to whole baht) so `totalSatang % 100 === 0` still holds. Never let a percent coupon produce fractional satang in the QR amount.

### Anti-Patterns to Avoid
- **A second reservation/quota path for the web store.** The web store MUST call the same `POST /orders`; do not re-implement reservation (NFR-02 / D-02).
- **Trusting a client-sent price, discount, or points value.** Server resolves coupon discount and points value; the client sends only `couponCode` + `redeemPoints` (an integer count), exactly as it sends no price today (T-01-06).
- **Broadcasting outside the marketing-consent filter.** Every audience query MUST filter to the latest `consent_logs` marketing grant = true (D-17, NFR-04).
- **Editing the `webhook.ts` raw-bytes/signature block.** The signature check reads `request.text()` before any parse; the bot state machine goes strictly after `validateSignature` (Pitfall in webhook.ts header).
- **Non-idempotent points earn.** Without a UNIQUE(order_id) earn arbiter, a re-entered `paid` transition double-credits points.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Web order/checkout/payment API | A new web-only order endpoint | Existing `POST /orders` (guest path) + `GET /orders/:id/qr` + `POST /orders/:id/slip` | Already public, server-authoritative, oversell-safe (NFR-02) |
| Coupon race safety | SELECT-then-check usage count | Guarded `UPDATE ... WHERE used < limit RETURNING` (Pattern 1) | Same DB-atomicity proof as `reserve()`; check-then-act reopens the race |
| Per-customer coupon cap | App-side "already redeemed?" query | UNIQUE(coupon_id, customer_id) + 23505 (Pattern 2) | Codebase-proven idempotency arbiter |
| Points balance | A mutable `balance` column | Append-only `loyalty_ledger`, balance = SUM | Auditable, no lost-update; mirrors `consent_logs` append-only trail |
| LINE broadcast fan-out | Loop `pushMessage` per user | `MessagingApiClient.multicast({ to, messages })` chunked ≤500 | One call per ≤500 users; controls quota cost (D-16, NFR-08) |
| SEO tags / sitemap / JSON-LD | Hand-written `<head>` + sitemap.xml | `@nuxtjs/seo` module | Covers sitemap + OG + schema.org product data (D-06) |
| Carrier vendor coupling | Direct Grab/Lalamove calls in the route | Adapter seam (Pattern 4) | D-21 requires a manual-now, API-later seam |
| Status-change LINE push | New push client | `notify.ts` `pushOrderUpdate` / `registerOrderNotifier` seam | Phase-2 seam already sends milestone Flex to members |
| Image compression/storage | New upload pipeline | `sharp` + R2 presign from `payments.ts` | D-26 explicitly reuses the slip pipeline |
| Forecast maths for CROP-07 | New yield formula | Inverse of `forecast.ts` `forecastPlants()` | Pure kernel already the survival-haircut authority |

**Key insight:** Almost every "new" capability in this phase is a composition of an existing, load-tested seam. The risky work is *composition order* (discount before QR; earn inside the paid tx; consent filter before multicast), not new algorithms.

## Runtime State Inventory

Phase 4 is additive (new tables/columns), not a rename/migration — most categories are empty. The one non-code concern is external LINE OA state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New tables only (coupons, loyalty_ledger, broadcasts, customer_tags, variety_images, delivery tracking). No existing row's meaning changes; `varieties.imageUrl`/`boxes.imageUrl` are re-designated "cover" but keep their values (D-28 backward compatible). | Additive migration `0005`; no data backfill required (cover image already populated where set) |
| Live service config | LINE OA: Rich Menu already live (Phase 2). A new bot flow may add quick-reply/postback items and possibly a new Rich Menu cell; broadcast uses the existing channel access token. LIFF endpoint URL unchanged. **Real domain** for the web store lives in DNS/Cloudflare, not git (deferred prereq). | Bot postbacks are code-defined (webhook.ts); any Rich Menu change is a LINE-console/API op — note for the go-live checklist |
| OS-registered state | pg-boss adds a `broadcast-send` queue (self-managed in the `pgboss` schema). No OS scheduler. | None — pg-boss creates its own queue table |
| Secrets/env vars | New non-secret env: `CARRIER_PROVIDER` (default `manual`), Nuxt `VITE_API_URL`/`NUXT_PUBLIC_API_URL`. LINE token/secret already in env. R2 keys already in env (reused for product images). Loyalty economics are NON-secret settings rows, NOT env. | Add `CARRIER_PROVIDER` to `env.ts` schema with a safe default; wire the Nuxt public API URL |
| Build artifacts / installed packages | New `web-store/` package (own `node_modules`, own CI build → hosting). `api/` gets NO new dependency. | New CI job to build+deploy `web-store` (mirror the `web/` → Cloudflare Pages job) |

**Nothing found requiring a data migration of existing records** — verified by reading `schema.ts`; all Phase-4 growth is new tables + new nullable columns with safe defaults (the 0003/0004 additive idiom).

## Common Pitfalls

### Pitfall 1: Coupon/points break the whole-baht PromptPay invariant
**What goes wrong:** A percent coupon yields fractional satang; `buildPromptPayPayload(payee, totalSatang/100)` then encodes a non-`.00` amount, or the QR amount no longer matches what slip-verify expects.
**Why it happens:** `orders.ts` assumes whole-baht totals; discounts computed in raw satang can be fractional.
**How to avoid:** Compute every discount in whole baht (or floor to 100-satang multiples) so `totalSatang % 100 === 0` holds before the QR is built. Add a test asserting the invariant after coupon + points.
**Warning signs:** slip amount mismatch; QR amount with non-zero satang digits.

### Pitfall 2: Discount applied after reservation but the total/QR/expected-amount get out of sync
**What goes wrong:** Slip verification compares against `subtotal + fee` (see `payments.ts` `expectedAmountSatang`) — if the discount is stored but not reflected in the expected amount, a correct payment is rejected.
**Why it happens:** `payments.ts` computes `expectedAmountSatang = ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0)` — it does NOT currently know about a discount.
**How to avoid:** Persist the net payable on the order (e.g. a `discountSatang` column) and update `payments.ts` `expectedAmountSatang` to subtract it, OR store the final `totalSatang` explicitly. This is a REQUIRED edit to `payments.ts`, not optional. Add a slice test.
**Warning signs:** discounted orders park in `awaiting_review` (amount mismatch) instead of auto-`paid`.

### Pitfall 3: Marketing-consent filter double-counts append-only rows
**What goes wrong:** `consent_logs` is append-only with TWO rows per checkout (usage + marketing). A naive `WHERE consent_type='marketing' AND granted=true` includes customers who later withdrew.
**Why it happens:** withdrawal is a NEW append row; you must take the LATEST marketing row per customer.
**How to avoid:** `DISTINCT ON (customer_id) ... ORDER BY customer_id, created_at DESC` (or a window) filtered to `granted=true`. Also require a non-null `line_user_id` (multicast needs the LINE id).
**Warning signs:** opted-out customers receive a broadcast (PDPA breach, NFR-04).

### Pitfall 4: New migration not registered in every self-resetting test → the 204+ test gate goes red
**What goes wrong:** Phase-3's lesson (STATE.md): 26 test files + `migrate.test.ts` had to register `0004` in their down/up sequences because new tables FK into existing ones; teardown must drop the newest migration first.
**Why it happens:** Phase-4 tables FK into `varieties`/`customers`/`orders`/`rounds`; a test that resets the schema fails on down if `0005` isn't dropped first.
**How to avoid:** Register `0005_phase4` in every self-resetting test's down/up sequence as a dedicated Wave-0 task before the feature slices land.
**Warning signs:** `bun test` migration/teardown failures across many files at once.

### Pitfall 5: Guest checkout has no identity → loyalty earn/redeem silently no-ops or crashes
**What goes wrong:** D-03 allows guest web checkout, but D-09/D-12 loyalty needs a persistent customer. A guest order has a throwaway `customers` row with no `line_user_id`.
**Why it happens:** Loyalty presumes a member; the web store has no LINE Login (that lives in LIFF).
**How to avoid:** Gate earn/redeem on membership (`is_member` / has `line_user_id`); guests simply don't earn/redeem (UI copy already exists: `สั่งซื้อแบบไม่ต้องเข้าสู่ระบบได้ — เข้าสู่ระบบเพื่อสะสมแต้ม`). Decide how a web customer *becomes* a member — see Open Questions.
**Warning signs:** null customer identity in earn insert; points credited to ephemeral guest rows.

### Pitfall 6: pg-boss broadcast worker on the pooled endpoint
**What goes wrong:** pg-boss must run on `DATABASE_URL_DIRECT` (unpooled) — its advisory-lock maintenance breaks on a PgBouncer transaction-pooled connection (boss.ts Pitfall 6 / T-02-02).
**How to avoid:** Add the `broadcast-send` queue inside the existing `boss.ts`/`workerDb()` which already uses the direct endpoint. Don't spin a new pool.
**Warning signs:** intermittent broadcast job stalls / lock errors.

### Pitfall 7: LINE multicast recipient cap
**What goes wrong:** `multicast()` accepts a bounded number of recipients per call (LINE caps multicast at 500 userIds per request `[ASSUMED — confirm in LINE docs]`). A segment over the cap fails or drops recipients.
**How to avoid:** Chunk the audience into ≤500-id batches and multicast per batch; surface the audience count in the composer (UI-SPEC `ส่งถึง {n} คน`).
**Warning signs:** partial delivery on large segments.

## Code Examples

### Discount composed into the order total before the QR (edit `orders.ts`)
```ts
// Source: composition of api/src/routes/orders.ts (VERIFIED) inside the existing tx.
// AFTER reserve() succeeds, BEFORE buildPromptPayPayload:
let discountSatang = 0;
if (body.couponCode) {
  const c = await redeemCouponGuarded(tx, body.couponCode, customerId, subtotalSatang, tier /*D-13 applicability*/);
  discountSatang += c.discountSatang;            // whole baht (Pitfall 1)
}
if (body.redeemPoints && isMember) {
  discountSatang += await redeemPointsGuarded(tx, customerId, orderId, body.redeemPoints); // whole baht, bounded ≤ payable
}
const netSatang = Math.max(0, subtotalSatang + (deliveryFeeSatang ?? 0) - discountSatang);
// invariant: netSatang % 100 === 0
const qrPayload = buildPromptPayPayload(env.PROMPTPAY_PAYEE_ID, netSatang / 100);
// persist discountSatang on the order so payments.ts expectedAmountSatang subtracts it (Pitfall 2)
```

### Segmented multicast with consent filter (new `broadcast.ts`)
```ts
// Source: @line/bot-sdk v11 MessagingApiClient.multicast (VERIFIED installed) + consent_logs (VERIFIED schema).
const audience = await db.execute(sql`
  select distinct on (c.id) c.line_user_id
  from customers c
  join consent_logs cl on cl.customer_id = c.id and cl.consent_type = 'marketing'
  where c.line_user_id is not null
    /* + segment predicate: tier / subscription / inactive / tag (D-15) */
  order by c.id, cl.created_at desc
`);
const consented = audience.filter(r => r.granted /* latest row granted=true */).map(r => r.line_user_id);
for (const batch of chunk(consented, 500)) {
  await line.client.multicast({ to: batch, messages });   // D-16
}
```

### CROP-07 inverse forecast (new `crop-recommend.ts`)
```ts
// Source: inverse of api/src/services/forecast.ts forecastPlants (VERIFIED pure kernel).
// forecastPlants(planted, survivalPct) = floor(planted * pct / 100)
// To meet `demandPlants` sellable, plant: ceil(demandPlants * 100 / survivalPct)
export function plantsToMeetDemand(demandPlants: number, survivalPct: number): number {
  return Math.ceil((demandPlants * 100) / survivalPct);
}
// demandPlants (D-24) = trailing-avg over last N rounds of
//   realized sales (Σ order_lines.plants_decremented on sold orders per variety)
//   + unmet demand (back_in_stock_requests per variety, converted to a plant estimate)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vue 3 SPA for all customer surfaces (LIFF) | Nuxt 4 SSR for the SEO-critical public store; keep LIFF as SPA | Nuxt 4 (2025–26) | Reuse Vue components across SPA + SSR; SSR only where SEO matters |
| `@nuxtjs/sitemap` + `nuxt-og-image` + `nuxt-schema-org` separately | `@nuxtjs/seo` umbrella module | 2025+ | One dependency for all of D-06 |
| `@line/bot-sdk` v10 default `Client` export | v11 `messagingApi.MessagingApiClient` (`multicast`/`narrowcast`/`broadcast`) | v11 (in use) | Codebase already on v11 (notify.ts / webhook.ts) |

**Deprecated/outdated:** none newly introduced. Do not adopt an LLM/NLU chatbot framework (explicitly out of scope, D-19). Do not add a payment gateway (PromptPay stays self-generated, NFR-08).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LINE `multicast()` caps at 500 recipients per request | Pitfall 7 / Area 3 | If lower, large segments drop recipients; chunk size must match the real cap — confirm in LINE docs before shipping |
| A2 | CROP-07 is cheapest as an on-demand `GET` compute (no scheduled pg-boss job needed) | Area 6 / Alternatives | If the owner wants a persisted weekly snapshot, add a pg-boss cron; on-demand still satisfies D-25 |
| A3 | Default loyalty earn rate / points→baht seed values are Claude's discretion | Area 2 / D-11 | Wrong seed is harmless — owner tunes in settings; pick conservative Thai-market defaults (e.g. 1 pt / ฿100; 1 pt = ฿1) |
| A4 | Points earn computed on the order's net/subtotal value (not incl. delivery fee) | Area 2 / D-12 | Ambiguous ("order value"); confirm base (subtotal vs net paid) with owner — affects economics |
| A5 | Nuxt SSR hosting = Cloudflare Pages (nitro `cloudflare-pages` preset) to keep NFR-08 low | Environment / Alternatives | If Pages edge SSR is unsuitable, host on the VPS behind Caddy; a hosting decision, not a code one |
| A6 | Back-in-stock "unmet demand" (D-24) converts to a plant estimate per request (e.g. one pack's plants) | Area 6 | `back_in_stock_requests` has no quantity column; the conversion heuristic needs owner sign-off |
| A7 | A web guest becomes a loyalty member only via LINE (LIFF) login, not via a new web email/password auth | Area 1 / Pitfall 5 | CUST-01 web login is not in this phase; if the owner expects web sign-up, that's added scope |

**These `[ASSUMED]` items should be confirmed by the planner/owner before they become locked plan decisions.**

## Open Questions

1. **How does a web-store customer earn/redeem loyalty without LINE Login?**
   - What we know: D-03 guest checkout; loyalty needs a persistent member; LINE Login lives in LIFF, not the web.
   - What's unclear: whether the web store links to LINE login, matches by phone, or simply defers loyalty to LINE-channel customers in MVP.
   - Recommendation: MVP = loyalty available to LINE-authenticated members only; web guests see the "log in to earn" hint (copy already in UI-SPEC). Confirm with owner (A7).

2. **Points earn base — subtotal, net-paid (after discounts), or including delivery?**
   - What we know: D-12 says "computed on the order value."
   - Recommendation: earn on subtotal (pre-delivery, pre-discount) for predictability; confirm (A4).

3. **Back-in-stock demand quantity for CROP-07.**
   - What we know: D-24 counts unmet demand; `back_in_stock_requests` records interest but no quantity.
   - Recommendation: count each request as a fixed small plant estimate (configurable) or as 1 pack-equivalent; confirm heuristic (A6).

4. **Nuxt SSR hosting target (Cloudflare Pages edge vs VPS).** See A5 / Environment Availability.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | API + Nuxt build | ✓ (project runtime) | 1.3.14 | — |
| PostgreSQL 17 | all new tables + pg-boss | ✓ (Phase 0 live) | 17.x | — |
| Cloudflare R2 | product images (D-26) | ✓ (Phase 2 slips live) | — | Backblaze B2 (deferred) |
| LINE OA (Messaging API, channel token) | broadcast + bot + status push | ✓ (Phase 2 live) | v11 SDK | — |
| LINE OA message quota | multicast (D-16) — quota-metered | ⚠ verify plan quota | — | Chunk + target consented segments only (NFR-08) |
| Nuxt SSR host (Cloudflare Pages edge OR VPS) | web store SSR (D-01) | ⚠ decision needed | Nuxt 4.4.8 | VPS behind existing Caddy |
| Real production domain | SEO web store (D-06) | ✗ (still `sslip.io`) | — | **Blocks full SEO value**; store works on any HTTPS host, but sitemap/canonical/OG need the real domain — provision before go-live |

**Missing dependencies with no fallback:** Real domain for D-06 SEO (deferred prereq — the store is buildable/testable without it, but SEO success criteria need it live).
**Missing dependencies with fallback:** SSR hosting (Pages edge or VPS); LINE quota (mitigate by consented-segment multicast).

## Validation Architecture

`workflow.nyquist_validation` is not disabled — this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (built-in) — 187 passing / 0 fail on `develop` (STATE.md) |
| Config file | none (Bun native); `.env.test` at repo root + `api/` |
| Quick run command | `cd api && bun test <file>` |
| Full suite command | `cd api && bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORD-05 | Web checkout reuses `POST /orders` guest path, reserves atomically | integration | `cd api && bun test orders.test.ts` (reuse) + new web e2e (manual) | reuse existing |
| MKT-01 | Coupon guarded redemption; global + per-customer limit; expiry/min | unit+integration | `cd api && bun test coupon.test.ts` | ❌ Wave 0 |
| MKT-01 | Concurrent redemption race (N-way, mirror reservation.test.ts) | integration | `cd api && bun test coupon-race.test.ts` | ❌ Wave 0 |
| CUST-03 | Ledger earn-on-paid idempotent; redeem bounded; balance = SUM | unit+integration | `cd api && bun test loyalty.test.ts` | ❌ Wave 0 |
| MKT-01+CUST-03 | Discount keeps whole-baht QR invariant; expectedAmount subtracts discount | integration | `cd api && bun test checkout-discount.test.ts` | ❌ Wave 0 |
| MKT-03/LINE-04 | Audience = latest marketing consent = true + line_user_id; opted-out excluded | integration | `cd api && bun test broadcast-audience.test.ts` | ❌ Wave 0 |
| LINE-04 | Bot postback state machine transitions; signature block unchanged | integration | `cd api && bun test webhook-bot.test.ts` | ❌ Wave 0 |
| DEL-05 | Carrier adapter seam; status enum transitions; status push fires | unit+integration | `cd api && bun test tracking.test.ts` | ❌ Wave 0 |
| CROP-07 | `plantsToMeetDemand` inverse kernel; trailing-avg aggregate | unit | `cd api && bun test crop-recommend.test.ts` | ❌ Wave 0 |
| (schema) | Migration `0005` up/down clean in all self-resetting tests | integration | `cd api && bun test migrate.test.ts` | edit existing |

### Sampling Rate
- **Per task commit:** `cd api && bun test <the-slice-file>`
- **Per wave merge:** `cd api && bun test`
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Register `0005_phase4` in every self-resetting test's down/up sequence + `migrate.test.ts` (Pitfall 4) — do this FIRST.
- [ ] `coupon.test.ts`, `coupon-race.test.ts` — MKT-01 redemption + race.
- [ ] `loyalty.test.ts` — earn/redeem/balance.
- [ ] `checkout-discount.test.ts` — whole-baht invariant + expectedAmount (Pitfalls 1/2).
- [ ] `broadcast-audience.test.ts` — consent filter (Pitfall 3).
- [ ] `webhook-bot.test.ts`, `tracking.test.ts`, `crop-recommend.test.ts`.
- [ ] Frontend: Nuxt has no test harness yet — web-store checkout is UAT/manual for MVP (matches `web/` today).

## Security Domain

`security_enforcement` is not disabled — this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `jose` HS256 sessions; staff RBAC `requireRole`; LINE idToken ES256 verify (`auth.plugin.ts`) — unchanged |
| V3 Session Management | yes | 2h HS256 tokens; new admin surfaces reuse `requireRole("owner","admin")` |
| V4 Access Control | yes | Admin-only coupon/broadcast/tracking/image routes behind `requireRole`; PDPA marketing-consent gate on broadcast (D-17) |
| V5 Input Validation | yes | TypeBox on every new route; `couponCode` string, `redeemPoints` bounded `t.Integer({minimum:1,maximum:…})`; image size bound 5 MiB (reuse `MAX_SLIP_BYTES`) |
| V6 Cryptography | no (new) | No new crypto; PromptPay CRC via library, never hand-rolled |

### Known Threat Patterns for {Bun/Elysia + LINE + PostgreSQL}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Coupon over-redemption (race / replay past limit) | Tampering / EoP | Guarded `UPDATE ... WHERE used<limit` (global) + UNIQUE(coupon,customer) (per-customer); both in the order tx |
| Client-inflated points / discount | Tampering | Server resolves discount + points value; client sends only code + integer count (mirror T-01-06 price snapshot) |
| Discount vs expected-amount desync → payment griefing | Tampering / DoS | Persist net payable; `payments.ts` `expectedAmountSatang` subtracts discount (Pitfall 2) |
| Broadcast to non-consented user | Repudiation / privacy (PDPA) | Latest-marketing-consent filter + opt-out (D-17, NFR-04) |
| Product-image upload abuse (CPU/storage) | DoS | Admin-only (RBAC) + 5 MiB bound + sharp compress + server-assigned R2 key (reuse `payments.ts`) |
| Webhook forgery / signature bypass | Spoofing | Untouched raw-bytes `validateSignature` block in `webhook.ts` (bot logic strictly after it) |
| Public web `POST /orders` abuse (stock exhaustion) | DoS | Existing `holdExpiresAt` sweep + `MAX_SLIP_ATTEMPTS` already mitigate; coupon adds no new open write beyond the guarded limit |
| SQL injection in new aggregates (reports-style CROP-07) | Tampering | Drizzle parameterized `sql` only (mirror `reports.ts` whereFrag), never string concat |

## Sources

### Primary (HIGH confidence)
- Codebase direct read (VERIFIED): `api/src/db/schema.ts`, `services/reservation.ts`, `services/order-transition.ts`, `services/notify.ts`, `services/delivery.ts`, `services/slip-verify/index.ts`, `services/consent.ts`, `services/settings.ts`, `services/b2b.ts`, `services/forecast.ts`, `routes/orders.ts`, `routes/payments.ts`, `routes/catalog.ts`, `routes/webhook.ts`, `routes/auth.ts`, `routes/reports.ts`, `jobs/boss.ts`, `config/delivery.ts`, `index.ts`, `web/src/api.ts`, `api/package.json`, `web/package.json`.
- `@line/bot-sdk` installed v11 — `multicast`/`narrowcast`/`broadcast`/`pushMessage` confirmed present (`node_modules/@line/bot-sdk/dist/messaging-api/api/messagingApiClient.js`).
- npm registry (2026-07-17): nuxt 4.4.8, @nuxtjs/seo 5.3.2, @nuxtjs/sitemap 8.2.2, nuxt-og-image 6.7.2, nuxt-schema-org 6.2.3, @vueuse/core 14.3.0. Legitimacy via `gsd-tools query package-legitimacy check`.
- 04-CONTEXT.md, 04-UI-SPEC.md, REQUIREMENTS.md, STATE.md, CLAUDE.md.

### Secondary (MEDIUM confidence)
- Nuxt SSR + `@nuxtjs/seo` capability mapping to D-06 (module suite = sitemap/OG/schema.org/robots) — from module identity + repos; not fetched from docs this session.

### Tertiary (LOW confidence)
- LINE multicast 500-recipient cap (A1) — training knowledge; confirm against developers.line.biz before shipping large segments.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — API libs unchanged (verified in package.json); Nuxt versions verified on npm.
- Architecture / reuse map: HIGH — every seam read directly in the codebase.
- Pitfalls: HIGH — derived from the actual code (whole-baht QR, expectedAmount, append-only consent, migration-registration lesson from STATE.md).
- Loyalty economics / CROP-07 demand heuristic / SSR hosting: MEDIUM — flagged as assumptions/open questions for owner confirmation.

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (30 days; stable stack). Re-verify Nuxt/@nuxtjs/seo versions and the LINE multicast cap at implementation time.

## Project Constraints (from CLAUDE.md)
- Respond to the user in Thai, caveman style (communication only — this artifact stays structured for the planner).
- Lowest-cost stack (NFR-08): free/cheap first; self-generated PromptPay (no gateway); multicast to consented segments to control LINE quota; prefer on-demand compute over scheduled jobs where equivalent.
- Stock correctness (NFR-02): web checkout MUST reuse the existing atomic `reserve()`; no new oversell path; `round_stock` guard untouched.
- Money ALWAYS integer satang, never float; preserve the whole-baht PromptPay invariant.
- PDPA (NFR-04): marketing broadcasts only to consented customers with opt-out; consent stored against policy version.
- Mobile (NFR-07): web store degrades mobile-first even with a distinct desktop layout.
- Prisma / payment gateway / Firebase / Express / serverless-free-tier are forbidden (What NOT to Use).
- Additive migrations only (0003/0004 idiom); register new migration in every self-resetting test.
- RTK prefix for shell commands; GSD workflow for edits.
</content>
</invoke>
