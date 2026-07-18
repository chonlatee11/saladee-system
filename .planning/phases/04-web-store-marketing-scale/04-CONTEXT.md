# Phase 4: Web Store, Marketing & Scale - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Expand Saladee beyond LINE into a **true omnichannel store** on the proven
Phase-1 order/reservation core, without touching the oversell guard. Five
capability areas, all reusing existing seams:

1. **Public web storefront (ORD-05)** — a Nuxt SSR site with cart → checkout →
   PromptPay/slip payment that reuses the same reservation core, round-based
   pre-order model, and Phase-2 payment flow. Guest checkout allowed.
2. **Promotions/coupons + loyalty points (MKT-01, CUST-03)** — admin-created
   coupons (percent/baht, minimum, expiry, usage limits, segment codes) and a
   flat points-earn/redeem-as-baht-discount loyalty program.
3. **Segmented broadcast + conversational chatbot (MKT-03, LINE-04)** — LINE
   multicast to customer segments (marketing-consented only), scheduled, with
   Flex/image content; a guided-flow order-taking bot that extends the Phase-3
   canned bot and hands off to LIFF to pay.
4. **Multi-carrier delivery tracking (DEL-05)** — record carrier + tracking
   number + a defined delivery-status enum per order (Grab/Lalamove/general),
   manual entry now with a carrier-adapter seam for a later real API.
5. **Demand-driven planting recommendation (CROP-07)** — recommend per-Monday
   planting quantities from trailing demand history (sales + unmet/sold-out
   demand), surfaced as a card in the crop-planning page that prefills the mix.

**Requirements:** ORD-05 (web cart→checkout), MKT-01 (promotions/coupons),
CUST-03 (loyalty points), MKT-03 (segmented broadcast), LINE-04 (conversational
order bot + broadcast), DEL-05 (carrier tracking number/status), CROP-07
(demand-driven reverse planting recommendation).

**Success criteria (from ROADMAP.md):**
1. A customer browses and checks out through a public web storefront
   (cart → checkout) that reuses the same order/reservation core.
2. An admin creates promotions/coupons (percent/baht, minimum, expiry, usage
   limit, segment codes) and customers earn and redeem loyalty points.
3. An admin sends a segmented LINE broadcast and a conversational chatbot can
   take orders.
4. Delivery records carrier tracking number/status (Grab/Lalamove/general
   carrier), and the system recommends per-Monday planting quantities from
   demand history.

**Not this phase:** Full real-time carrier API integration (Grab/Lalamove live
tracking) — MVP is manual entry behind an adapter seam. Real NLU/LLM chatbot
free-text parsing — MVP is a guided quick-reply/postback flow. Member tiers
(bronze/silver/gold) — MVP loyalty is flat. Points expiry, prepaid/recurring
billing, B2B credit-limit blocking — deferred. Product-image gallery UX beyond
upload+display basics stays minimal.

</domain>

<decisions>
## Implementation Decisions

### Web storefront (ORD-05)
- **D-01:** **Stack = Nuxt (Vue) SSR, a new app** alongside `web/` (LIFF SPA) and
  `web-admin/`. Chosen over Next.js because the entire frontend is Vue — Nuxt
  reuses `web/` Vue components, keeps one framework for a solo dev, and preserves
  the Eden Treaty typed client. Matches CLAUDE.md's web-store recommendation.
- **D-02:** **Full checkout parity on the web** — the web store runs its own
  cart → checkout → PromptPay QR → slip-upload flow by reusing the Phase-2
  payment services. Not a browse-then-handoff-to-LINE model.
- **D-03:** **Guest checkout allowed** (no login required), mirroring the
  Phase-2 guest path. Members/loyalty are optional at web checkout.
- **D-04:** **Web store uses the same round-based pre-order model as LINE** —
  it reads the same round availability and cut-off and lets the customer pick a
  delivery round. Consistent with the LINE storefront; no separate
  "ready-to-ship only" web catalog.
- **D-05:** **Responsive = a distinct desktop layout, not a stretched mobile
  view.** The web store is reached on desktop + mobile (unlike the mobile-only
  LIFF), so build a genuine desktop layout (hero, multi-column catalog) with
  Tailwind breakpoints that also degrades to mobile-first (NFR-07).
- **D-06:** **Full SEO** — SSR-rendered product pages + sitemap + meta/OG tags +
  product structured data (JSON-LD). Leverages the SSR chosen in D-01. A real
  domain (replacing `sslip.io`) is a prerequisite — see Deferred/prereqs.
- **D-29 (RESOLVED 2026-07-17, owner):** **Nuxt SSR host = Cloudflare Pages**
  (nitro `cloudflare-pages` preset). $0 per NFR-08; keeps the Hetzner VPS lean for
  the stateful API + pg-boss; unifies with the existing web/ → Pages deploy job.
  Edge→VPS-API SSR latency is neutralized by ISR/SWR `routeRules` on the public
  catalog/product pages (checkout is CSR). Applied in Plans 08 (preset+route rules)
  and 09 (host checkpoint resolved). VPS-behind-Caddy was rejected (SSR would compete
  for VPS CPU + HTML travels EU→TH ~250ms/request).
- **D-30 (RESOLVED 2026-07-17, owner):** **Domain = Cloudflare Registrar, a `.com`**
  (at-cost ~$10/yr), DNS on Cloudflare. Subdomain map: apex/`www` → web store;
  `api.` → API (replaces `api.saladee.example` in Caddyfile on the VPS); LIFF stays
  on its Pages subdomain (or `line.`). Real-domain provisioning remains the deferred
  SEO go-live prereq (D-06).

### Promotions/coupons + loyalty (MKT-01, CUST-03)
- **D-07:** **One coupon per order — no coupon stacking.** Simplest to reason
  about and protects margin.
- **D-08:** **Coupon usage limits are enforced both globally and per-customer**
  (e.g. 100 total redemptions AND 1 per customer). Both counters tracked.
- **D-09:** **Loyalty points redeem as a baht discount** (points → baht off the
  order). No freebie/reward catalog in MVP.
- **D-10:** **Flat loyalty — no member tiers.** Single earn rate for everyone;
  tiers (bronze/silver/gold) deferred.
- **D-11:** **Earn rate and points→baht conversion are configurable in system
  settings** (reuse the Phase-3 `settings` hot-config table); no hardcoded
  economics. Default rate is a sensible seed the owner can change.
- **D-12:** **Points earn when an order reaches `paid`**, computed on the order
  value; **points do not expire in MVP** (expiry is a later config). A coupon
  and a points-redemption may both apply to one order — they are independent
  mechanisms (coupon = promo, points = customer's earned value).
- **D-13:** **Promotion applicability is configurable per-promotion** (which
  channels/segments a given promo/coupon applies to), rather than a hardwired
  "B2C only". Lets the owner exclude already-discounted B2B wholesale and
  subscription orders when they want, without a code change. Sensible default:
  a new promo targets B2C retail.
- **D-14:** **Coupon entry is a field at checkout on both web and LIFF**, and
  **segment codes auto-apply** when the customer arrives via a broadcast/link
  carrying the code.

### Broadcast + conversational chatbot (MKT-03, LINE-04)
- **D-15:** **Customer segments = predefined + manual tags.** Predefined:
  B2C / B2B / subscription member / inactive (reuse Phase-3 customer types);
  plus admin-applied free tags for ad-hoc grouping.
- **D-16:** **Broadcast delivery = LINE multicast to the segment's userIds**
  (not broadcast-to-all-followers) — targets the right group and controls the
  LINE OA message-quota cost (NFR-08).
- **D-17:** **PDPA: broadcasts go only to customers who granted marketing
  consent, with an opt-out mechanism.** Marketing consent is already captured
  separately (Phase-2, `consent_logs.consent_type = "marketing"`); the broadcast
  audience is filtered by it. Non-negotiable (NFR-04).
- **D-18:** **Broadcasts support send-now AND scheduled send (reuse pg-boss),
  with rich content (Flex / image / promo link).** First marketing use of the
  existing pg-boss seam.
- **D-19:** **Conversational bot = guided flow, no LLM.** Extend the Phase-3
  canned `webhook.ts` router with a quick-reply/postback order-taking state
  machine. Keeps cost at zero and behavior deterministic (NFR-08); no free-text
  NLU/LLM parsing in MVP.
- **D-20:** **The bot gathers order intent in chat, then deep-links to LIFF to
  complete checkout/payment.** The bot never handles money directly — it reuses
  the existing LIFF checkout. Safest MVP path.

### Multi-carrier delivery tracking (DEL-05)
- **D-21:** **Hybrid tracking — ship manual entry now behind a carrier-adapter
  seam.** Staff enter carrier + tracking number and update status manually;
  the schema/service is built generically (mirroring the Phase-2 slip-provider
  adapter pattern) so a real Grab/Lalamove API can plug in later without rework.
  No live carrier API integration in this phase.
- **D-22:** **Delivery status is a defined enum** (e.g. pending → handed to
  carrier → in transit → delivered), staff-updated, and each transition
  **notifies the customer via LINE** (reuse the Phase-2 status-notification
  seam).

### Demand-driven planting recommendation (CROP-07)
- **D-23:** **Recommendation = trailing average of demand over the last N
  rounds**, converted back into plant counts using the per-variety params from
  Phase-3 (g/plant, survival %). N is a tunable window.
- **D-24:** **Demand signal counts realized sales PLUS unmet demand** — include
  back-in-stock requests (interest logged when an item was sold out) so the
  recommendation does not undercount demand that stockouts hid.
- **D-25:** **Surface as a recommendation card in the crop-planning page** that
  prefills the quantities in the Phase-3 planting-mix template (D-06 of Phase 3),
  with full admin override. Not a separate read-only report.

### Product images (supports ORD-05 storefront)
- **D-26:** **Admin uploads product photos** through a real pipeline
  (upload → sharp compress → private/public R2 → stored URL), reusing the
  Phase-2 slip upload+sharp+R2 seam. Not paste-a-URL-only.
- **D-27:** **Images render everywhere** — web store, LIFF catalog, and broadcast
  Flex cards (the catalog API already returns `imageUrl`).
- **D-28:** **Multiple images per product (gallery).** Requires a new
  `variety_images` (and box equivalent) child table; the existing
  `varieties.imageUrl` / `boxes.imageUrl` becomes the cover image for backward
  compatibility.

### Claude's Discretion
- Exact default loyalty earn rate / conversion seed values (D-11) — pick sensible
  Thai-market defaults; owner tunes in settings.
- Exact N-round window for the CROP-07 trailing average (D-23) — choose from the
  data available; make it configurable if cheap.
- Precise delivery-status enum labels/order (D-22) — planner/UI-spec may refine.
- Storage visibility (public vs signed) for product images (D-26) — product
  photos are public marketing assets (unlike private slips); default to a public
  R2 path unless a reason to sign emerges.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project / roadmap
- `.planning/ROADMAP.md` §"Phase 4: Web Store, Marketing & Scale" — phase goal +
  4 success criteria.
- `.planning/REQUIREMENTS.md` — ORD-05, DEL-05, CUST-03, MKT-01, MKT-03,
  LINE-04, CROP-07 wording (FR-12/24/27/29/31/49/45).
- `CLAUDE.md` — stack constraints (NFR-08 lowest cost), Nuxt-for-web-store
  recommendation, Alternatives (Nuxt vs Next), "What NOT to Use".

### Prior-phase context to build on
- `.planning/phases/03-.../03-CONTEXT.md` — Phase-3 decisions reused here:
  customer types/segments, planting-mix template (P3 D-06), settings hot-config,
  canned chatbot (P3 D-25), pg-boss generator patterns.
- `.planning/phases/02-.../02-CONTEXT.md` — payment flow, PromptPay/slip,
  delivery engine, PDPA consent (usage/marketing split), status notifications.
- `.planning/phases/01-.../01-CONTEXT.md` — reservation core + round/quota model
  the web store and promotions must not break.

### Existing code the phase extends (see code_context)
- `api/src/db/schema.ts` — `varieties`/`boxes` (`imageUrl`), `orders`,
  `consent_logs` (`policyVersion`, `consent_type`), `settings`, customer tables.
- `api/src/routes/webhook.ts` — canned chatbot router to extend (D-19).
- `api/src/routes/payments.ts` — sharp+R2 upload pipeline to reuse (D-26).
- `api/src/routes/catalog.ts` — already returns `imageUrl` (D-27).
- `api/src/services/delivery.ts`, `api/src/config/delivery.ts` — delivery
  methods/zones to extend with tracking (D-21/22).
- `api/src/jobs/boss.ts` — pg-boss init to reuse for scheduled broadcasts (D-18).

No new external ADRs authored during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Vue components in `web/`** — catalog card, cart store, checkout wizard,
  PromptPay pay screen, slip uploader — reusable by the Nuxt web store (D-01/02).
- **Phase-2 payment services** (`api/src/routes/payments.ts`, PromptPay QR, slip
  verify, hold-expiry) — the web checkout reuses these unchanged (D-02).
- **sharp + R2 pipeline** in `payments.ts` (compress → private R2 → signed URL) —
  the pattern the product-image upload copies (D-26).
- **Canned chatbot** `api/src/routes/webhook.ts` (keyword/postback → Flex →
  LIFF deep-link) — the guided order-bot extends this (D-19/20).
- **pg-boss** (`api/src/jobs/boss.ts`) — reuse for scheduled broadcasts (D-18).
- **`settings` hot-config table** (Phase 3) — loyalty economics + PDPA policy
  version live here (D-11, and PDPA versioning below).
- **`consent_logs`** already has `policy_version` + `consent_type`
  (usage/marketing) columns — broadcast consent filter and PDPA versioning build
  on these, no new consent table needed.

### Established Patterns
- **Adapter/provider seam** (Phase-2 slip provider: SlipOK → Slip2Go swap) — the
  model for the carrier-tracking adapter (D-21).
- **Additive migrations with safe defaults** (0003/0004 idiom) — new tables
  (coupons, loyalty ledger, product images, carrier tracking) and new columns
  follow the same non-breaking pattern; the `round_stock` reservation guard is
  never touched.
- **Reserve-before-B2C priority** (P3 B2B/subscription) — promotions must not let
  a coupon/points path bypass the atomic reservation.
- **RBAC by role** (owner/admin/grower/packer) — new admin surfaces (promotions,
  broadcast composer, loyalty settings, tracking entry, planting recommendation)
  slot into `web-admin/` behind existing role gates.

### Integration Points
- Web store (new Nuxt app) → same API via Eden Treaty typed client → reservation
  core + payment flow.
- Coupon/points apply at order creation/checkout → must compose with the atomic
  reservation and price snapshot (never re-open the oversell risk).
- Broadcast/bot → LINE Messaging API (multicast) + pg-boss scheduler + marketing
  consent filter on `consent_logs`.
- Carrier tracking → `orders` (new tracking fields/table) + Phase-2 status
  notification seam.
- CROP-07 → reads order/demand history + back-in-stock requests + Phase-3 variety
  params; writes recommendation into the planting-mix UI.

</code_context>

<specifics>
## Specific Ideas

- **PDPA policy versioning (owner request):** Manage the PDPA policy version in
  system settings (edit text + bump version). Consent is stored against the
  version (`consent_logs.policy_version` already exists). When the version is
  bumped, customers are prompted to re-consent on their next order. This upgrades
  the existing hardcoded-version behavior into managed, re-consent-aware
  versioning — supports the new web-store and broadcast consent surfaces (NFR-04).
- **"Show vegetable photos" (owner request):** the concrete driver behind D-26/27/28
  — the owner wants real product imagery visible across the store, uploaded (not
  URL-pasted), and more than one per item.
- Nuxt-vs-Next was explicitly compared at the owner's request; Nuxt chosen for
  Vue-component reuse and single-framework simplicity (D-01).

</specifics>

<deferred>
## Deferred Ideas

- **Real carrier API integration** (Grab/Lalamove live tracking/booking) — built
  as an adapter seam now (D-21), real integration is a later phase (cost + KYC).
- **LLM/NLU free-text chatbot** — guided flow ships now (D-19); LLM parsing (e.g.
  Claude Haiku) is a future upgrade.
- **Loyalty member tiers** (bronze/silver/gold) and **points expiry** — flat MVP
  now (D-10/D-12); tiers/expiry later.
- **Coupon stacking** and **reward/freebie redemption catalog** — deferred
  (D-07/D-09).
- **Real production domain** to replace `sslip.io` — a prerequisite for the SEO
  web store (D-06); provisioning task, not a design decision.
- **B2B credit-limit/blocking**, prepaid/recurring subscription billing — remain
  deferred from earlier phases.

None of the above are in Phase 4 scope; captured so they are not lost.

</deferred>

---

*Phase: 4-Web Store, Marketing & Scale*
*Context gathered: 2026-07-17*
