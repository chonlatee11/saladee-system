# Phase 3: Back-office, Crop Planning & B2B/Subscription - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Move the farm into a **role-gated back-office** and make the Phase-1 reservation
engine **self-feeding and recurring**. Crop plans forecast harvests that
**auto-populate sellable quantity per round** (replacing Phase-1 manual entry,
with manual override kept); each actual harvest is logged with **lot/best-before**
for traceability and forecast tuning. **B2B** customers see wholesale pricing and
place **standing orders whose quota is reserved from forecast before B2C stock
opens**; **subscription** boxes auto-generate an order per round with
pause/skip/cancel. **Packing staff** work a pack queue grouped by delivery route
and print pack/label slips; **role-based access** limits owner/admin/grower/packer
views. A **dashboard** summarizes today's/this-round sales, unpaid orders,
near-sold-out items and next-round yield; **sales reports** break down by
period/channel/product/round; **system settings** are configurable; and a
**canned LINE chatbot** answers menu/stock and routes ordering into LIFF.

**Requirements:** INV-10 (lot/best-before traceability), SALE-03 (subscription
box: package + frequency, auto-generate, pause/skip/cancel), ORD-03 (pack queue
by route + printable pack/label slips), CUST-02 (B2B wholesale visibility +
credit terms), CUST-05 (B2B standing order + forecast quota reserved before B2C),
MKT-02 (canned LINE chatbot: menu/stock + take orders), MKT-04 (sales reports by
period/channel/product/round, best-sellers, repeat customers, AOV), ADM-01
(dashboard), ADM-02 (role-based access), ADM-03 (system settings), CROP-01
(variety parameters), CROP-02 (planting batches), CROP-03 (auto-computed harvest
date + expected yield), CROP-04 (harvest calendar → auto sellable qty), CROP-05
(actual harvest logging vs forecast), CROP-06 (planting mix → auto-create
batches).

**Success criteria (from ROADMAP.md):**
1. Admin defines variety parameters + a per-round planting mix; the system
   auto-creates batches and projects a weekly harvest calendar with expected yield.
2. Harvest calendar auto-populates sellable qty per round (replacing manual entry,
   manual override retained); each actual harvest is logged with lot/best-before.
3. B2B sees wholesale pricing and sets a standing order whose quota is reserved
   from forecast before B2C opens; subscriptions auto-generate per round with
   pause/skip/cancel.
4. Packing staff see a pack queue grouped by delivery route and print pack/label
   slips; role-based access limits owner/admin/grower/packer views.
5. Dashboard summarizes today's/this-round sales, unpaid orders, near-sold-out
   items, next-round yield; reports break down by period/channel/product/round;
   settings are configurable; a canned LINE chatbot answers menu/stock and takes
   orders.

**Not this phase:** public web storefront (ORD-05), promotions/coupons (MKT-01),
loyalty/points (CUST-03), segmented broadcast (MKT-03), conversational/NLU
chatbot ordering + multi-carrier tracking API (LINE-04/DEL-05), demand-driven
reverse planting recommendation (CROP-07) — all Phase 4. Full B2B credit
limit/blocking is deferred (MVP records terms + pay status only). No self-OCR slip
reading, no NLU free-text bot (REQUIREMENTS out-of-scope).

</domain>

<decisions>
## Implementation Decisions

### Crop planning & forecast → auto sellable qty (CROP-01..06, INV-10)
- **D-01:** **Variety parameter registry (CROP-01)** extends the existing
  `varieties` table. `avgGramsPerPlant` already exists (Phase-1 D-22); add
  days-to-harvest, survival/haircut %, harvest window, and shelf-life days. These
  drive the forecast.
- **D-02:** **Confidence haircut is per-variety.** Sellable qty per round =
  projected plants × (survival/buffer % set on each variety). Different varieties
  carry different buffers (hardy vs fragile). The result feeds `round_stock.quota_plants`.
- **D-03:** **Forecast → sellable qty is GATED behind admin confirmation.** After
  the harvest calendar computes a draft quota, an admin must review and **publish**
  before the round opens; **manual override is retained permanently** after publish
  (ROADMAP: "replacing manual entry, with manual override retained"). No silent
  auto-open.
- **D-04:** **Actual harvest logging records actual vs forecast and displays the
  delta; the admin adjusts variety params manually (no auto-tuning).** Avoids
  parameter drift from noisy/partial harvest data. (CROP-05.)
- **D-05:** **Traceability: 1 planting batch = 1 lot.** best-before is
  **computed automatically** = harvest date + per-variety shelf-life days
  (D-01). Traceable without extra grower work. (INV-10.)
- **D-06:** **Planting Mix (CROP-06) is a saved recipe template** (varieties +
  plant counts per batch; ~200 plants / 6 varieties per PROJECT v0.6). One click on
  the Monday plant date **auto-creates the batches** from the template, editable
  per round.
- **D-07:** **Batch → round mapping is automatic by projected harvest date.** Each
  batch's harvest date (plant date + days-to-harvest) is matched to the round whose
  `harvestDate` it falls on; batches of the same variety sum into that round's
  variety `quota_plants`.

### B2B — wholesale, quota & credit (CUST-02, CUST-05)
- **D-08:** **A customer becomes B2B by self-signup → pending → admin approval.**
  Approved B2B accounts see the wholesale (`b2b`) price tier (the Phase-1 `prices`
  table already stores both tiers — Phase-1 D-15 — this phase gates *visibility*).
- **D-09:** **B2B standing orders reserve quota from forecast at round-creation
  time, before B2C stock opens** — the "reserved before B2C" guarantee (CUST-05).
  Reuses the Phase-1 quota/reserved counter (D-07).
- **D-10:** **Overflow policy = reserve first-come-first-served + flag the admin.**
  When combined B2B standing demand exceeds a round's forecast, the overflow is
  **surfaced to the admin as a flag** (does NOT auto-decide) so the owner adds
  planting / trims a standing order. (STATE Phase-3 blocker resolved.)
- **D-11:** **B2B credit (MVP) = record terms + per-order unpaid/paid status
  (invoice-later); no hard credit-limit blocking.** Full credit line/limit is
  deferred (PROJECT: credit terms → later phase).

### Subscription (SALE-03)
- **D-12:** **Subscription = a pre-defined package** (e.g. S/M/L by value, like a
  500฿ box). The system **fills the box from varieties available in that round**
  (ties to the mixed-box model). Customer picks **package + frequency**, not
  per-variety.
- **D-13:** **pg-boss auto-generates the subscription order AND reserves stock at
  round-open, before walk-in B2C** — subscriptions get priority quota (parallel to
  B2B D-09) so a member's box never sells out. First background generator; reuses
  the Phase-2 pg-boss seam.
- **D-14:** **pause / skip / cancel allowed until the round's cut-off.** After
  cut-off the generated order locks and follows the normal payment/hold-expiry
  path.
- **D-15:** **Billing is per-round, reusing the Phase-2 payment flow** — each
  round's subscription order gets a PromptPay QR + slip upload + hold-expiry. No
  recurring/prepaid billing engine to build.
- **D-16:** **Substitution in an auto-filled box → fill from what's actually
  available to reach package value, AND notify the customer via LINE that a
  substitution was made.** Reuses the Phase-2 notify (Flex) path; consistent with
  INV-09 substitution policy.

### Back-office app, RBAC, packing, settings (ADM-01/02/03, ORD-03)
- **D-17:** **The back-office is a separate app `web-admin/`** (new Vue + Vite
  package) — desktop staff audience, `jose` session auth — distinct from the LIFF
  `web/` (mobile customers, LINE Login). Reuses the Eden Treaty typed client and
  Phase-0 auth; keeps the LIFF bundle small.
- **D-18:** **`web-admin/` uses TanStack Query (`@tanstack/vue-query`)** for
  server-state fetching + caching and **TanStack Table (`@tanstack/vue-table`,
  headless)** for all data grids (orders, packing queue, catalog, reports,
  dashboard). Pairs with the Eden Treaty client (as the query fn) + Tailwind.
  *(User preference — fits analytics-heavy reports + many CRUD/data tables.)*
- **D-19:** **RBAC is least-privilege, scoped by role.** `roleEnum`
  (owner/admin/grower/packer) already exists (Phase-0). owner/admin = full;
  **grower** = crop/planting/harvest only; **packer** = pack queue only. (ADM-02 /
  PLAT-03.)
- **D-20:** **Packing queue groups by delivery round → then by delivery
  method/zone (route).** Reuses the Phase-2 `orders.deliveryMethod` /
  `deliveryZone` snapshot. (ORD-03.)
- **D-21:** **Pack/label slips are PDF via pdfmake + embedded Thai font
  (Sarabun)** — the same lib/font path the invoice PDF (PAY-04) uses. *(User chose
  real PDF over browser print.)*
- **D-22:** **System settings (ADM-03): frequently-changed values move to the
  admin UI** — rounds, daily prices, delivery fee/zones, hold window, haircut %,
  B2B quota ceiling. **Risky/secret values stay in committed config/env** — payee
  ID, slip-verify API key, secrets — no redeploy for routine edits, secrets never
  in the UI.

### Dashboard & reports (ADM-01, MKT-04)
- **D-23:** **Dashboard = the 4 criterion cards** (today's/this-round sales, unpaid
  orders, near-sold-out items, next-round forecast yield) **PLUS a B2B/subscription
  card** (standing/subscription orders due this round + the D-10 B2B overflow flag).
- **D-24:** **Reports (MKT-04) = full analytics, not a basic table.** Interactive
  charts + filters by period/channel/product/round, best-sellers, repeat customers,
  AOV, with **CSV export.** *(User deliberately chose the richer option over a
  table-only MVP — planner should size the added UI/chart work accordingly, it is
  intentional not over-build.)*

### Chatbot (MKT-02)
- **D-25:** **Canned LINE chatbot — no NLU** (REQUIREMENTS out-of-scope).
  Keyword/postback replies for "เมนูรอบนี้ / ราคาวันนี้ / ของเหลือ" return Flex
  cards + a **deep-link that opens the LIFF to order**. "Takes orders" = routes
  into LIFF, not in-chat ordering. Reuses the Phase-2 webhook + Flex notify path.

### Claude's Discretion
- Exact new tables/columns and **reversible migrations** (up + hand-written down
  per Phase-0 D-12/13): variety-param extension, planting batches, planting-mix
  templates, harvest logs/lots, subscriptions, B2B standing orders, B2B
  credit-terms/status, report/aggregate queries.
- `web-admin/` directory layout, routing, component structure; exact
  `@tanstack/vue-query` / `@tanstack/vue-table` versions (research pins current);
  a **self-contained, low-cost chart library** choice for D-24 (NFR-08).
- Exact Flex-card copy for the chatbot (D-25) and the substitution notice (D-16);
  dashboard card layout.
- Whether planting-mix template / harvest-log are separate tables or extend
  existing ones; precise TypeBox request/response schemas for all new endpoints.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs & requirements
- `CLAUDE.md` — **locked stack** (Bun 1.3.14 / Elysia 1.4.29 / PostgreSQL 17 /
  Drizzle 0.45.2 / postgres.js 3.4.9 / TypeBox / jose 6.2.3 / Vue 3.5 + Vite 8 +
  Tailwind 4). Phase-3-relevant libs: **pg-boss 12.23.0** (subscription +
  standing-order generation — reuses the Phase-2 hold-expiry seam), **pdfmake
  0.3.11 + a Thai font (Sarabun)** (pack/label slips D-21 — *must* embed Thai font),
  **@elysiajs/eden 1.4.9** (typed `web-admin/` client). Also the "What NOT to Use"
  list. **Note:** TanStack Query/Table (D-18) are user-chosen additions for
  `web-admin/` and are NOT in the CLAUDE.md table — research pins versions.
- `.planning/REQUIREMENTS.md` — this phase's REQs: §INV-10, §SALE-03, §ORD-03,
  §CUST-02, §CUST-05, §MKT-02, §MKT-04, §ADM-01, §ADM-02, §ADM-03,
  §CROP-01…CROP-06. Also read the **Out of Scope** table (no self-OCR, no NLU
  free-text bot) and the **v2** note (full credit terms / OCR are later).
- `.planning/ROADMAP.md` §"Phase 3: Back-office, Crop Planning & B2B/Subscription"
  — goal + 5 success criteria (the acceptance bar) and the Overview paragraph
  ("crop planning auto-feeds sellable quantity … replacing Phase 1's manual entry").
- `.planning/PROJECT.md` — the **crop model v0.6** (plant every Monday, **mixed
  ~200 plants / 6 varieties per batch**, standard round cadence Mon plant → Tue
  20:00 cut-off → Thu harvest/pack → Thu–Sun delivery), delivery zones
  (Samut Prakan self-delivery), and the Key Decisions row "Phase-1 manual sellable
  qty → Phase-3 crop auto-feed with manual override kept".
- `.planning/STATE.md` — **Blockers/Concerns → Phase 3**: per-variety yield params
  are SRS placeholders (→ D-02 haircut + D-03 gate); quota-overflow policy +
  pause/skip cut-off semantics are business decisions (→ D-10, D-14). These are now
  resolved above.
- `salad-shop-requirements.md` — SRS v0.6 source FRs: FR-40..45 + FR-50 (crop
  planning/forecast/mix), FR-05 (traceability), FR-39 (standing order + quota),
  FR-10 (subscription), FR-26 (B2B tiers/credit), FR-15 (pack queue/slips), FR-30
  (chatbot), FR-32 (reports), FR-33/34/35 (dashboard/roles/settings).

### Prior phase context (the engine + storefront this phase extends)
- `.planning/phases/01-commerce-core/01-CONTEXT.md` — **read in full.** Key seams:
  D-07 quota/reserved counter (crop auto-feed writes `quota_plants`; B2B +
  subscription reserve here), D-05/06 plants base unit + per-variety conversion
  (forecast is in plants), D-22 per-variety g/plant + packs (CROP-01 extends this),
  D-09 shop-wide rounds (`harvestDate` is the batch→round key), D-15 both price
  tiers stored (CUST-02 gates b2c/b2b visibility), D-17/18 mixed-box BOM (the
  subscription package model borrows this), D-19 order status state machine.
- `.planning/phases/02-line-storefront-payments-delivery/02-CONTEXT.md` — reused
  seams: pg-boss hold-expiry (D-08/09 — subscription/standing generation reuses the
  worker), notify/Flex (D-21/22 — substitution + status pushes, D-16/D-25),
  delivery method/zone snapshot on orders (D-12..15 — packing queue grouping D-20),
  PromptPay QR + slip verify + hold (D-15 subscription billing reuses this whole
  flow), RBAC-gated admin endpoints.
- `.planning/phases/00-foundation-platform/00-CONTEXT.md` — RBAC roles
  (owner/admin/grower/packer), `jose` sessions (web-admin auth), reversible
  migration workflow (up + hand-written down), R2 storage.

### Existing code (see `<code_context>`)
- `api/src/db/schema.ts`, `api/src/routes/*`, `api/src/services/*`,
  `api/src/jobs/boss.ts`, `api/src/plugins/*`, `web/*`, `bruno/Saladee/`.

### No external ADRs
- No standalone ADR/design docs — the design authority for this phase is this
  CONTEXT + CLAUDE.md + REQUIREMENTS.md + PROJECT.md (crop model). Research pins
  the chart library and TanStack versions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/db/schema.ts` — `varieties.avgGramsPerPlant` (CROP-01 seam),
  `roundStock.quotaPlants`/`reservedPlants` (crop auto-feed writes quota; B2B +
  subscription reserve), `rounds.harvestDate`/`cutoffAt` (batch→round key D-07 +
  cut-off gate D-14), `prices` with `tier` b2c/b2b (CUST-02 visibility gate),
  `boxes`/`boxComponents` (subscription package model borrows the BOM), `customers`
  (add B2B flag/approval), `orderStatusEnum`, `roleEnum`.
- `api/src/jobs/boss.ts` + pg-boss — the worker seam for subscription + standing-
  order generation (first recurring generator; hold-expiry already runs here).
- `api/src/services/reservation.ts` — `reserve()`/`release()` guarded counter;
  crop auto-feed sets quota, B2B/subscription reserve through the same guard.
- `api/src/services/order-transition.ts` / `order-status.ts` — the shared
  `applyTransition()` state machine; subscription/standing orders flow through it.
- `api/src/services/notify.ts` + `routes/webhook.ts` + `plugins/line.plugin.ts` —
  Flex push (substitution notice D-16, status pushes) + the webhook to extend for
  the canned chatbot postbacks (D-25).
- `api/src/config/delivery.ts` + `orders.deliveryMethod/Zone` — packing-queue
  grouping by route (D-20); some settings move UI-side (D-22).
- `api/src/routes/catalog.ts`, `prices.ts`, `rounds.ts`, `varieties.ts`,
  `stock.ts` — staff CRUD the `web-admin/` UI will drive (currently Bruno-tested).
- `web/` (Vue 3 + Vite + Eden Treaty) — the pattern `web-admin/` mirrors
  (separate package); `web/src/api.ts` shows the typed-client setup to copy.
- `bruno/Saladee/` — extend for crop/harvest/subscription/standing/report/chatbot.

### Established Patterns
- Elysia + TypeBox per-route schemas → OpenAPI + Eden types (all new endpoints).
- Env/config validated at boot with TypeBox (Phase-0 D-10) — add haircut default,
  B2B quota ceiling, subscription config; keep payee/API keys in env (D-22).
- Reversible migrations in `api/drizzle/` (up + hand-written down, Phase-0 D-12/13).
- Structured JSON logs to stdout (Phase-0 D-15) — never log secrets/API keys.

### Integration Points
- **New tables/columns:** variety params extension (days-to-harvest, survival %,
  shelf-life), planting batches, planting-mix templates, harvest logs + lots
  (best-before), subscriptions + generated orders, B2B standing orders, B2B
  approval flag + credit terms/status, report aggregates.
- **pg-boss** gains subscription + standing-order round generators (reuses the
  Phase-2 worker).
- **`web-admin/`** is a NEW frontend package (Vue+Vite+TanStack) on the existing
  typed API + `jose` auth; distinct from the LIFF `web/`.
- **RBAC** is enforced end-to-end for the first time across a full staff UI
  (roles already in `roleEnum`).

</code_context>

<specifics>
## Specific Ideas

- **Safety-first crop automation:** the owner wants the forecast to *assist*, not
  auto-commit — hence per-variety haircut (D-02), an admin publish gate before a
  round opens (D-03), and manual param tuning from actual-vs-forecast rather than
  auto-adjust (D-04). Manual override of sellable qty is kept forever.
- **One-click planting:** a saved mix template that spawns the week's batches on
  the Monday plant date (D-06) — matches the real "plant every Monday, 6 varieties
  ~200 plants" workflow.
- **Members never sell out:** subscription + B2B standing orders reserve quota from
  forecast ahead of walk-in B2C (D-09/D-13); when the box must substitute, the
  customer is proactively told via LINE (D-16).
- **Rich reporting:** the owner explicitly wants full analytics dashboards with
  charts and filters (D-24), beyond a basic MVP table — chose TanStack Query +
  Table for the admin data layer (D-18) to support it.

</specifics>

<deferred>
## Deferred Ideas

- **Full B2B credit line / limit with blocking** — MVP records terms + pay status
  only (D-11); credit enforcement is a later phase (PROJECT).
- **Demand-driven reverse planting recommendation (CROP-07)** — Phase 4.
- **Conversational/NLU chatbot ordering + segmented broadcast (LINE-04/MKT-03)** —
  Phase 4; this phase's bot is canned + LIFF deep-link only (D-25).
- **Public web storefront (ORD-05), promotions/coupons (MKT-01), loyalty/points
  (CUST-03), multi-carrier tracking API (DEL-05)** — Phase 4.
- **Auto parameter tuning from harvest history** — deferred (D-04 is manual to
  avoid drift); a suggestion engine could come later.
- **Recurring/prepaid subscription billing engine** — not built; per-round QR +
  hold reuses Phase-2 (D-15).

</deferred>

---

*Phase: 3-Back-office, Crop Planning & B2B/Subscription*
*Context gathered: 2026-07-07*
