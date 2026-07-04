# Phase 2: LINE Storefront, Payments & Delivery - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap the **proven Phase-1 order engine** in a **real LINE storefront that can go
live and take money**. A customer opens the Rich Menu, browses the round in a
LIFF mini-app (LINE Login or guest), picks a delivery method/round + address,
completes mobile checkout, pays by **self-hosted PromptPay QR**, uploads a slip
that is **verified** (payee + exact amount + not-duplicate), and receives
**automatic LINE status notifications** — while **unpaid QR holds auto-release
reserved stock on expiry** (pg-boss). Delivery fee computes by zone/method with
free shipping over 500฿, method restricted by product freshness, and **PDPA
consent** (with separate marketing consent) is captured while slips stay in a
private, signed-URL-only bucket.

**Requirements:** PLAT-04 (PDPA consent + marketing consent + data rights + log),
ORD-01 (LINE→single backend), ORD-04 (auto LINE status notify), PAY-01
(amount-specified PromptPay QR, backend-generated), PAY-02 (slip upload +
slip-verify API, dup/forged/wrong-amount rejected, admin confirm), PAY-03 (QR
hold-expiry → release reserved stock), DEL-01..04 (4 methods, fee by zone/method,
method restriction by product type, delivery round/date at checkout), CUST-04
(order history + reorder), LINE-01 (Rich Menu), LINE-02 (LIFF ordering page),
LINE-03 (Messaging API webhook + status notify).

**Success criteria (from ROADMAP.md):**
1. Customer opens Rich Menu → orders in LIFF (LINE login or guest) → picks
   delivery round/method + address → completes mobile checkout → order lands in
   the single backend.
2. System generates an amount-specified PromptPay QR a real bank app accepts;
   customer uploads a slip verified (duplicate/forged/wrong-amount rejected)
   before admin confirmation.
3. An unpaid order's reserved stock auto-releases when its QR hold expires,
   returning it to the available pool.
4. Customer receives automatic LINE notifications on status changes and can view
   order history and reorder.
5. Delivery fee computes by method/zone with free shipping over 500฿, disallowed
   methods blocked per product type, and PDPA consent (separate marketing
   consent) captured while slips stay in a private, signed-URL-only bucket.

**Not this phase:** crop-plan auto-feed of sellable qty, B2B quota/credit,
subscriptions, packing queue, dashboards, reports, role-gated staff back-office
(all Phase 3); public web storefront, promotions/coupons, loyalty/points,
segmented broadcast, conversational NLU chatbot, multi-carrier tracking API
(Phase 4). Invoice **PDF** generation is Phase 2-capable off Phase-1 data but not
a listed criterion here — keep out unless trivial. No self-OCR slip reading
(REQUIREMENTS out-of-scope — use a Thai slip-verify API).

</domain>

<decisions>
## Implementation Decisions

### Payments — PromptPay + slip verification (PAY-01/02)
- **D-01:** **Slip-verify provider chosen at research time** behind an **adapter
  interface** so the concrete vendor (EasySlip / SlipOK / Slip2Go) can be swapped
  without touching call sites. Researcher picks the cheapest that meets
  free-tier + reliability (NFR-08). Self-OCR stays out of scope.
- **D-02:** **Verify matches BOTH payee and amount.** The shop's PromptPay payee
  ID lives in env/config (single static payee); a slip must show a transfer **to
  that payee** for the **exact order amount** to pass — guards against someone
  else's slip / wrong-account transfer.
- **D-03:** **Amount must match exactly (to the satang).** PromptPay is
  amount-specified and Phase-1 unit prices round to whole baht (Phase-1 D-13), so
  over/under = reject → routed to admin review.
- **D-04:** **Admin manual-confirm is always available as a fallback.** If the
  verify API is down / quota-exhausted / returns a non-clean result, the order
  sits in an `awaiting-review` state and an admin can confirm payment by hand —
  the store never hard-depends on the vendor being 100% up.
- **D-05:** **Clean verify → auto-mark `paid`.** When the API verifies cleanly
  (payee + exact amount + not-duplicate), the order transitions to `paid`
  automatically and the customer is notified; the admin queue only holds
  failed/ambiguous cases. Saves the solo owner manual work. (Reconciles the
  criterion-2 phrase "verified before admin confirmation" as: verification is the
  gate that runs before/instead of manual confirmation, not a mandatory second
  human step on clean slips.)
- **D-06:** **Duplicate slips are blocked system-wide** by persisting the bank
  **transaction ref** returned by the verify API under a unique constraint across
  all orders — one slip cannot pay two orders anywhere in the system.
- **D-07:** **PromptPay QR is generated backend-side** (per CLAUDE.md stack:
  `promptpay-qr`/`promptparse` + `qrcode`), amount-specified, correct CRC — zero
  gateway fee (NFR-08). Concrete lib choice is research/planner's call.

### Hold-expiry & stock release (PAY-03)
- **D-08:** **Hold window is configurable (default 30 min).** Kept in
  config/settings; 30 min balances PromptPay's instant transfer against oversell
  risk. Implemented as a pg-boss delayed job.
- **D-09:** **On expiry → cancel the order + release stock.** The job transitions
  the order to `cancelled`, which performs the guarded `reserved → available`
  release in the **same transaction** (reuses Phase-1 D-08 release path — the only
  transition that releases stock). Customer re-orders if they still want it.
- **D-10:** **Hold timer starts at order creation.** `POST /orders` already
  reserves stock atomically (Phase-1 D-02/D-07); QR is built and the pg-boss
  expiry job is scheduled **in the same flow** — no separate "generate QR" step
  that could reserve stock with no timer attached.
- **D-11:** **Re-showing the QR is idempotent and does NOT extend the hold.** A
  `GET` returns the same QR any number of times before expiry; there is no
  regenerate-to-reset-timer path.

### Delivery — zones, fees, restrictions (DEL-01..04)
- **D-12:** **Zones are named entries in config, priced per (zone × method) as a
  flat rate.** e.g. Samut Prakan self-delivery, upcountry general carrier. Admin
  edits config — no shipping-carrier rate API this phase. (Province/postal-code
  granularity deferred as needless for MVP.)
- **D-13:** **Freshness gating via a `delivery-class` field on each variety.**
  Each variety carries a delivery class that constrains allowed methods
  (very-fresh → self / cold only; normal → any). A **mixed box uses the strictest
  class among its components**. Drives DEL-03 method blocking at checkout.
- **D-14:** **Delivery date is derived from the round's `deliveryDate`** (already
  on the Phase-1 `rounds` table). The customer chooses **method + address**; the
  date follows the selected round — no free-form date picker.
- **D-15:** **Free shipping over 500฿ applies only to self-delivery + general
  carrier.** On-demand couriers (Grab/Lalamove) are charged per trip regardless of
  order value (their cost is variable; the customer bears it).

### LIFF storefront, Rich Menu & login (LINE-01/02, CUST-01)
- **D-16:** **Checkout is a multi-step wizard** (pick varieties/packs → delivery
  round+method+address → summary+slip), mobile-first per LINE-02, with per-step
  error surfacing.
- **D-17:** **LINE Login is the default; guest checkout is allowed.** Inside LIFF
  the app obtains the `idToken`, verifies it **server-side** (jose, Phase-0
  scaffold), and populates `customers.line_user_id` (Phase-1 D-04). Guest may
  order without login but forgoes history/reorder/push (those need `line_user_id`).
- **D-18:** **Rich Menu ships 5 buttons this phase:** สั่งผักรอบนี้ (open LIFF),
  ราคาวันนี้ (catalog/prices), ติดตามออเดอร์ (order history+status), ติดต่อร้าน,
  and ความรู้เรื่องผัก/วิธีเก็บรักษา (content page). The **สมาชิก/แต้ม** button is
  deferred to Phase 4 (loyalty = CUST-03).

### Order history & reorder (CUST-04)
- **D-19:** **History + reorder are member-only** (require LINE Login /
  `line_user_id`). Guests get neither.
- **D-20:** **Reorder pre-fills the cart** with the same varieties/units, then
  **re-prices at the currently selected open round**; items now sold-out or absent
  in that round are flagged so the customer confirms before paying — not a blind
  duplicate of the old order.

### Notifications (ORD-04 / LINE-03)
- **D-21:** **Push only on key milestones** — paid, packing/shipping, done, and
  cancelled/hold-expired — to conserve LINE push quota (NFR-08). Not every
  transition.
- **D-22:** **Notifications are Flex-message cards** (order summary + deep-link
  into the LIFF order page), not plain text. *(User preference — accepts the extra
  template work.)*
- **D-23:** **Push targets members with `line_user_id` only.** Guests without
  login receive no push (consistent with D-17/D-19).

### Product content (storefront enrichment)
- **D-24:** **Short care-content fields added per variety** (e.g. `storage_tips`,
  `washing_tips` — nullable), editable via the existing catalog CRUD and shown on
  the LIFF variety **detail** page. Variety listing/description/photo are already
  supported by the Phase-1 `varieties` table (name/category/description/imageUrl)
  and the Phase-1 public catalog reads. A **Rich Menu content button** (D-18)
  links to a LIFF content list surfacing this care info. Full content/blog hub is
  deferred to Phase 4.

### PDPA & data protection (PLAT-04 / PLAT-03)
- **D-25:** **Consent captured at checkout, before personal data is collected**
  (name/address/phone). Consent + policy version is logged with a timestamp. Not
  gated at first LIFF open.
- **D-26:** **Marketing consent is a separate, default-unchecked checkbox** at
  checkout (explicit opt-in per PDPA), logged separately — feeds Phase-4 broadcast
  (MKT-03).
- **D-27:** **Data access/deletion requests handled manually by admin** for MVP
  (customer requests via contact/notify → admin deletes/exports), documented in
  the privacy policy. Self-serve deletion is deferred (complex vs order/slip
  retention).
- **D-28:** **Slips are compressed then stored in a private R2 bucket, reachable
  only via short-lived signed URLs** (PLAT-03/04). Compress with Bun.Image (native,
  or sharp) reusing the Phase-0 `storage.plugin`.

### Claude's Discretion
- Concrete slip-verify vendor (behind D-01 adapter), PromptPay QR library choice,
  and exact TypeBox request/response schemas.
- Flex-message card layout/copy (D-22), the exact milestone→message mapping (D-21).
- Table/column layout and migration structure (up + hand-written down per Phase-0
  D-12/13) for the new payment/slip/consent/delivery/content columns; directory
  layout within `api/src` and `web/src`.
- Config surface/shape for hold window (D-08), zones×methods (D-12), and payee ID.
- Reorder edge-case UX details beyond the D-20 shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs & requirements
- `CLAUDE.md` — **locked stack** (Bun 1.3.14 / Elysia 1.4.29 / PostgreSQL 17 /
  Drizzle 0.45.2 / postgres.js 3.4.9 / TypeBox / jose 6.2.3 / Vue 3.5 + Vite 8 +
  Tailwind 4 for LIFF). Phase-2 supporting libs: **@line/bot-sdk 11.0.2**
  (webhook signature, reply/push, Rich Menu API), **@line/liff 2.29.0** (LIFF
  init, LINE Login, idToken), **promptpay-qr 0.5.0 / promptparse 1.6.0 +
  qrcode 1.5.4** (PromptPay QR), **pg-boss 12.23.0** (hold-expiry job),
  **jose 6.2.3** (verify idToken + sessions), **sharp 0.35.2 / Bun.Image** (slip
  compression), **@elysiajs/eden 1.4.9** (typed LIFF client). Also the "What NOT
  to Use" list (no payment gateway for PromptPay; no self-OCR).
- `.planning/REQUIREMENTS.md` — this phase's REQs: §PLAT-04, §ORD-01, §ORD-04,
  §PAY-01, §PAY-02, §PAY-03, §DEL-01..04, §CUST-04, §LINE-01, §LINE-02, §LINE-03.
  Also read the **Out of Scope** table (no self-OCR, no NLU chatbot, no payment
  gateway, VPS always-on for webhook+timer) and §PAY-04 (invoice data already on
  Phase-1 orders).
- `.planning/ROADMAP.md` §"Phase 2: LINE Storefront, Payments & Delivery" — goal +
  5 success criteria (the acceptance bar) and the Overview paragraph ("the point
  where the store can go live and take money").
- `.planning/PROJECT.md` — core value ("จ่ายเงินจบในที่เดียว … ไม่ oversell") and
  v1 out-of-scope list (anti-scope-creep).
- `salad-shop-requirements.md` — SRS v0.6, source FRs behind the REQ IDs:
  FR-13 (LINE→backend), FR-16 (status notify), FR-17 (PromptPay QR), FR-18 (slip
  verify), FR-19 (hold-expiry), FR-20..23 (delivery), FR-28 (reorder), FR-46
  (Rich Menu), FR-47 (LIFF ordering), FR-48 (webhook), NFR-04 (PDPA).

### Prior phase context (the engine this phase wraps)
- `.planning/phases/01-commerce-core/01-CONTEXT.md` — **read in full.** Key seams:
  D-02 `POST /orders` (the LIFF endpoint), D-07 quota/reserved counter (hold-expiry
  attaches here), D-08 cancel-only stock release (expiry reuses it), D-19 order
  status state machine (payment/notify triggers hook in), D-04 `customers` +
  `line_user_id`, D-13 whole-baht unit prices (PromptPay-friendly), D-16 order-line
  price snapshot (reorder re-prices off current, not snapshot).
- `.planning/phases/00-foundation-platform/00-CONTEXT.md` — Phase-0 foundations
  reused: LINE webhook + raw-body signature validation, `jose` session + LINE
  idToken verify, R2 storage client (private bucket + signed URL), pg-boss-ready
  Postgres, RBAC roles for admin endpoints.

### Existing code (see `<code_context>`)
- `api/src/db/schema.ts`, `api/src/routes/*`, `api/src/plugins/*`,
  `api/src/services/*`, `web/src/*`.

### No external ADRs
- No standalone ADR/design docs — the payment/PDPA/delivery design authority is
  this CONTEXT + CLAUDE.md + REQUIREMENTS.md. Research will pin the slip-verify
  vendor + PromptPay lib.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/routes/webhook.ts` — LINE webhook with **raw-body signature
  validation** (Pitfall 1 handled). Extend its event handling for status-notify
  triggers / (later) canned replies. Do NOT attach a body schema (breaks raw
  bytes).
- `api/src/plugins/line.plugin.ts` — real `@line/bot-sdk` v11 `MessagingApiClient`
  (`line.client`) + `channelSecret`. Reuse for **push** (status notify) and Rich
  Menu API.
- `api/src/plugins/storage.plugin.ts` + `api/src/routes/files.ts` — R2 presigned
  PUT/GET round-trip. Reuse for **slip upload → private bucket → signed-URL view**
  (D-28).
- `api/src/plugins/auth.plugin.ts` + `api/src/routes/auth.ts` — `jose` session
  issuance/verification. Extend to **verify LINE idToken** server-side (D-17) and
  gate any admin payment-confirm endpoints.
- `api/src/routes/orders.ts` + `api/src/services/order-status.ts` +
  `api/src/services/reservation.ts` — `POST /orders` (LIFF target), the
  `TRANSITIONS` state machine (add payment/notify triggers), and `release()` (the
  expiry job calls the same guarded release). `reserve()`/`release()` signatures
  stay unchanged.
- `api/src/routes/catalog.ts` — public catalog reads the LIFF consumes; extend
  variety detail with care-content fields (D-24).
- `web/` (Vue 3 + Vite + Eden Treaty scaffold) — the LIFF mini-app builds here;
  `web/tests/eden-types.test.ts` proves end-to-end types.
- `bruno/Saladee/` — extend for payment/slip/delivery/webhook + the hold-expiry
  and duplicate-slip proofs.

### Established Patterns
- Elysia + TypeBox per-route schemas → OpenAPI + Eden types (all new endpoints
  follow this).
- Env validated at boot with TypeBox (Phase-0 D-10) — add PromptPay payee, slip
  API key, hold-window, zone config here.
- Reversible migrations in `api/drizzle/` (up + hand-written down, Phase-0 D-12/13).
- Structured JSON logs to stdout (Phase-0 D-15) — never log the LINE channel
  secret or slip API key.

### Integration Points
- **New tables/columns:** payment/slip record (txn ref unique — D-06), QR-hold
  fields + pg-boss job, consent log (usage + marketing — D-25/26), delivery
  zones/methods + fee, `varieties.delivery_class` (D-13) + care-content fields
  (D-24), order delivery method/zone/fee snapshot.
- **pg-boss** is introduced this phase (hold-expiry, D-08/09) — first background
  worker; also the seam Phase-3 standing-order/subscription generation reuses.
- **Rich Menu API** (LINE-01) and **LIFF app** (LINE-02) are new surfaces on the
  existing LINE client + `web/` scaffold.

</code_context>

<specifics>
## Specific Ideas

- Owner wants the LINE experience to **teach as it sells**: each vegetable's
  **storage/preservation** and **washing** tips visible on the product detail, a
  variety list ("มีสายพันธุ์อะไรบ้าง"), and a dedicated Rich Menu button linking to
  that care content (D-18/D-24). Kept lightweight (per-variety fields) to stay in
  Phase-2 scope; a full content hub is Phase 4.
- Notifications should feel polished — **Flex cards, not plain text** (D-22).
- Reduce the owner's manual workload: **clean slips auto-confirm to `paid`**
  (D-05), admin only touches exceptions.

</specifics>

<deferred>
## Deferred Ideas

- **สมาชิก/แต้ม (loyalty/points)** Rich Menu button + program — Phase 4 (CUST-03).
- **Full vegetable content/education hub** (articles, multi-image, categories) —
  Phase 4 marketing; Phase 2 keeps short per-variety care fields only.
- **Conversational/NLU chatbot ordering + segmented broadcast** — Phase 4
  (MKT/LINE-04); explicitly out of scope (REQUIREMENTS out-of-scope: no free-text
  NLU).
- **Self-serve PDPA data export/deletion** in LIFF — deferred; admin-manual for MVP
  (D-27).
- **Province/postal-code delivery zones + carrier rate/tracking API** — Phase 4
  (DEL-05); Phase 2 uses named config zones + flat rates.
- **Invoice PDF generation** (pdfmake + Thai font) — off Phase-1 data when needed;
  not a Phase-2 criterion.
- **B2B wholesale visibility/credit, subscriptions, packing queue, dashboards,
  reports, crop auto-feed** — Phase 3.
- **Other LINE gimmicks** — none required for Phase 2 (user: "เท่านี้พอ").

</deferred>

---

*Phase: 2-LINE Storefront, Payments & Delivery*
*Context gathered: 2026-07-04*
