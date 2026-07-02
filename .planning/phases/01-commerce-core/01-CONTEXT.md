# Phase 1: Commerce Core - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the **oversell-safe, harvest-bound order engine**. An admin (via API) sets
up varieties, fixed-weight packs, daily/round per-variety pricing (B2C + B2B
tiers), and shop-wide selling rounds. Orders — including mixed salad boxes —
reserve stock **atomically** without ever overselling, each carrying a **frozen
price/pack snapshot** at creation and moving through the full order status
pipeline.

**Requirements:** PLAT-01 (atomic guarded decrement), PLAT-03 (hashed
passwords, RBAC, private buckets), INV-01…INV-09 (products, pricing tiers,
fixed-weight packs, per-round pricing, rounds, oversell decrement, mixed box,
sold-out/alert, substitution policy), SALE-01/02/04 (pre-order-by-round,
ready-to-ship, multi-mode product), CUST-01 (customer identity + guest ordering),
ORD-02 (unified order pipeline), PAY-04 (price-at-order-time / invoice-ready).

**Success criteria (from ROADMAP.md):**
1. Admin creates products with fixed-weight packs; sets daily/round per-variety
   price with B2C + B2B tiers; system auto-computes pack price and retains price
   history.
2. Two concurrent orders for the last available pack yield exactly one success
   and one "sold out" — never oversold (manual sellable qty this phase).
3. A mixed box is orderable only up to its scarcest component; ordering it
   decrements every component in one all-or-nothing transaction.
4. Each order captures a frozen price/pack snapshot, supports pre-order-by-round
   and ready-to-ship modes, and moves through the status pipeline
   (created → awaiting payment → paid → packing → shipping → done/cancelled)
   with an invoice-ready record.
5. Sold-out items show "หมดรอบนี้" and a customer can request a back-in-stock
   alert; per-order substitution policy and per-role access (hashed passwords,
   private buckets) are enforced.

**Not this phase:** LIFF/Rich Menu customer UI, PromptPay + verified slips,
hold-expiry auto-release, delivery fees, PDPA consent (all Phase 2); crop
planning auto-feeding stock, B2B quota/credit, subscriptions, packing queue,
dashboards, reports (Phase 3); web storefront, promotions, broadcast (Phase 4).
Phase 1 is API-only (no admin UI); orders enter via a real order endpoint.

</domain>

<decisions>
## Implementation Decisions

### Admin surface & API shape
- **D-01:** **API-only in Phase 1** — build REST endpoints (Elysia + TypeBox
  validation) tested via Bruno; **no admin UI**. Admin UI is deferred to
  Phase 2/3 where dedicated UI phases exist. Keeps the phase focused on proving
  the reservation engine, matching the roadmap ("prove the engine behind an
  admin catalog").
- **D-02:** **A real `POST /orders` endpoint** (atomic reservation + frozen
  snapshot) — NOT a test-only harness. This is the same endpoint Phase 2 (LIFF)
  will call; build the contract correctly now. Concurrency is verified with a
  parallel Bruno/script run against this endpoint.
- **D-03:** **Endpoint auth boundary:** catalog/price/round **write** endpoints
  require staff auth (`jose` session from Phase 0, roles `owner`/`admin`);
  catalog **reads** may be public (Phase 2 LIFF will consume them);
  `POST /orders` is **open to guest/member** (no staff auth) so Phase 2 LIFF
  guest checkout plugs in unchanged. Least-privilege per PLAT-03.

### Customer identity (CUST-01)
- **D-04:** **`customers` table from Phase 1 with guest/member distinction.**
  Guest = name/address/phone captured per order, no account; member = saved
  addresses reused. Reserve a `line_user_id` column for Phase 2 to populate on
  LINE Login. Every order references a `customer_id` — no rewrite needed when
  LINE identity arrives.

### Stock model (PLAT-01 / INV-06 / NFR-02) — the core
- **D-05:** **Stock base unit = plants (ต้น)**, held per variety per round. All
  stock is counted and **decremented in plants** — the single canonical counter
  that guarantees oversell safety regardless of which sale unit an order uses.
  Chosen over grams because the farm plants/harvests by plant count and it maps
  directly to CROP forecasting (plants) in Phase 3.
- **D-06:** **Multiple sale units per variety** (kg / bag(ถุง) / pack / plant),
  each storing a **conversion factor back to plants** (e.g. 1 ถุง = 2 ต้น,
  1 kg = 8 ต้น). Ordering any unit converts to plants and decrements the base
  counter. Conversion is defined **per variety** (avg weight/plant differs).
- **D-07:** **quota / reserved split from day one** (roadmap: "correct-from-day-
  one"). `available = quota − reserved`. Creating an order increments `reserved`
  atomically (guarded `UPDATE … WHERE available ≥ n` or `FOR UPDATE` — exact
  mechanism is research/planner's call per CLAUDE.md). **No auto-expiry in
  Phase 1** — Phase 2 adds the pg-boss hold-expiry job that auto-cancels unpaid
  holds; the model already supports it.
- **D-08:** **Only a `cancelled` transition releases stock** (`reserved → available`),
  done atomically to prevent double-release. Active states (created…shipping)
  keep the reservation; `done`/`shipping` keep `reserved` consumed (a real sale).
  Cancel is disallowed once `done`.

### Selling rounds (INV-05)
- **D-09:** **Rounds are shop-wide.** One round = one harvest/delivery cycle with
  a single cut-off / harvest date / delivery date, covering many varieties. Each
  variety has its own sellable qty (plants) and price *within* that round. A
  mixed box can span varieties in the same round.
- **D-10:** **Cut-off auto-blocks ordering by time.** Round has `open → closed`
  states; past cut-off, `POST /orders` for that round is rejected (checked at
  request time — no cron needed in Phase 1). Phase 3 may add a formal round-close
  job.
- **D-11:** **Sale modes are a property of the round/timing, not a separate stock
  structure.** pre-order = round whose harvest date hasn't arrived;
  ready-to-ship = round already harvested/shippable. Same single counter and same
  oversell guard for both. *(Claude's discretion — user said "you decide".)*

### Pricing (INV-02 / INV-04 / PAY-04)
- **D-12:** **Price set per kg, per variety, per round, per tier;** pack/unit
  prices are **auto-derived** from the kg price × unit weight.
- **D-13:** **Auto-computed unit prices round UP to whole baht** (no satang) —
  clean amounts, compatible with Phase 2 PromptPay.
- **D-14:** **Price cadence = round-primary with an optional daily effective-date
  override.** Default price lives on the (variety, round, tier); an admin may set
  a dated override that wins for that day. Price history = the set of round rows +
  any dated overrides.
- **D-15:** **Both B2C and B2B tiers are stored** per variety/round; the order
  records **which tier it used** (snapshot). Tier *visibility gating* (who sees
  wholesale) is deferred to Phase 3 (CUST-02) — Phase 1 may accept the tier as a
  request field.
- **D-16:** **Full price/pack snapshot on each order line** (variety name, sale
  unit + plant conversion, kg price, tier, computed unit price, qty). Orders are
  reconstructable for invoicing without joining live price tables (PAY-04
  price-at-order-time).

### Mixed salad box (INV-07)
- **D-17:** **Fixed recipe / BOM** — a box is a fixed list of component varieties
  with quantities (in plants). Availability = `min` across components; ordering
  decrements every component **all-or-nothing in one transaction**. Build-your-box
  is deferred. *(Claude's discretion — user said "you decide".)*
- **D-18:** **Box price = sum of component prices by default, with an optional
  fixed box-price override.** Snapshot captures the BOM + resolved price at order
  time.

### Order status pipeline (ORD-02 / criterion 4)
- **D-19:** **Build the full pipeline now** (created → awaiting payment → paid →
  packing → shipping → done/cancelled) as a validated state machine. In Phase 1
  transitions are driven by **staff API calls** (no payment/LINE auto-triggers);
  Phase 2 wires payment/notify as triggers into the same states. No rework of the
  state model later.

### Substitution & sold-out/notify (INV-08 / INV-09)
- **D-20:** **Data-only in Phase 1, no real sends.** Order carries a substitution
  policy field (allow/disallow); sold-out items expose status "หมดรอบนี้";
  back-in-stock requests are stored as records. Actual LINE notifications
  (ORD-04/LINE-03) and any auto-substitution are Phase 2+. The engine does **not**
  auto-substitute (would undermine oversell proofs).

### Invoice-ready record (PAY-04)
- **D-21:** **Line-item snapshot is captured (D-16); buyer tax/recipient fields
  (name / address / tax ID) exist on the order but are optional in Phase 1.**
  No PDF generation this phase — Phase 2 can generate invoices from the stored
  data with no migration.

### Pack / weight model (INV-03)
- **D-22:** **Packs and the kg/plant conversion are defined per variety.** Each
  variety stores its avg weight/plant (g/plant) and its own pack list (each pack
  resolves to a plant count). This is the seam CROP-01 (parameterized avg
  weight/plant) plugs into in Phase 3.

### Claude's Discretion
- Exact row-locking mechanism for the atomic decrement (`SELECT … FOR UPDATE`
  vs conditional `UPDATE … WHERE available ≥ n`, `SKIP LOCKED`) — per CLAUDE.md's
  "Atomic Stock Reservation" note and RESEARCH.
- Table/column layout, migration structure (up + hand-written down per D-13 of
  Phase 0), directory layout within `api/src`, and the precise TypeBox schemas.
- Sale-mode modeling (D-11) and box definition (D-17) left to Claude within the
  stated shape.
- Whether the daily price override (D-14) is a separate table or a nullable dated
  row.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs & requirements
- `CLAUDE.md` — **locked stack** (Bun 1.3.14 / Elysia 1.4.29 / PostgreSQL 17 /
  Drizzle 0.45.2 / postgres.js 3.4.9 / TypeBox / jose 6.2.3), the **"Atomic Stock
  Reservation — Implementation Note (NFR-02 / FR-04)"** section (binding for the
  reservation core), the "What NOT to Use" list (no Prisma; use Drizzle with
  explicit `.for('update')` / `SKIP LOCKED`), and pg-boss for later hold-expiry.
- `.planning/REQUIREMENTS.md` — this phase's requirements: §PLAT-01, §PLAT-03,
  §INV-01…INV-09, §SALE-01/02/04, §CUST-01, §ORD-02, §PAY-04. Also read §INV-10,
  §CROP-01…CROP-04, §CUST-02, §PAY-01/02/03 for awareness of what Phases 2–3 bolt
  onto this engine (why quota/reserved, price snapshot, per-variety g/plant, and
  tiers are built now).
- `.planning/ROADMAP.md` §"Phase 1: Commerce Core" — goal + 5 success criteria
  (the acceptance bar), and the Overview paragraph (quota/reserved split +
  price-snapshot "correct-from-day-one").
- `.planning/PROJECT.md` — core value ("จำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ — ไม่
  oversell") and v1 out-of-scope list (anti-scope-creep).
- `salad-shop-requirements.md` — SRS v0.6, source FR-01…FR-04, FR-36, FR-38,
  FR-03, FR-51, FR-06, FR-07, FR-08/09/11, FR-25, FR-14, FR-37 behind the REQ IDs.

### Prior phase context
- `.planning/phases/00-foundation-platform/00-CONTEXT.md` — Phase 0 decisions
  this phase builds on: D-07 RBAC roles (`owner/admin/grower/packer`), D-08 in-app
  auth (`jose` sessions + `Bun.password`), D-09 monorepo + Eden Treaty, D-12/13
  migration workflow (up + hand-written down).

### Existing code
- `api/src/db/schema.ts` — the only existing table (`users`, `roleEnum`). All
  commerce tables are new. Follow its Drizzle pg-core style.

### No external ADRs
- No standalone ADR/design docs yet — the reservation design authority is
  `CLAUDE.md`'s "Atomic Stock Reservation" section.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/src/db/schema.ts` / `api/src/db/client.ts` — Drizzle + postgres.js client
  and the `users`/`roleEnum` schema; new commerce tables extend this.
- `api/src/plugins/auth.plugin.ts` + `api/src/routes/auth.ts` — `jose` session
  issuance/verification and RBAC scaffold; reuse to gate staff write endpoints
  (D-03).
- `api/src/routes/*` + Elysia + TypeBox pattern — every new endpoint follows the
  existing route/plugin structure with TypeBox schemas (→ OpenAPI + Eden types).
- `bruno/Saladee/` — Bruno collection already used to test the API; extend it for
  catalog/round/pricing/order + the concurrency proof (criterion 2).

### Established Patterns
- Env validated at boot with TypeBox (Phase 0 D-10); reversible migrations
  committed to `api/drizzle/` (Phase 0 D-12/13, write matching down SQL).
- Structured JSON logs to stdout (Phase 0 D-15).

### Integration Points
- `POST /orders` (D-02) is the seam Phase 2 LIFF calls.
- quota/reserved counter (D-07) is the seam Phase 2 hold-expiry (pg-boss) and
  Phase 3 CROP auto-feed attach to.
- Per-variety g/plant + pack conversion (D-22) is the seam CROP-01 fills in
  Phase 3.
- Order status state machine (D-19) is the seam Phase 2 payment/notify triggers
  hook into.

</code_context>

<specifics>
## Specific Ideas

- The shop sells the **same variety in multiple units** — by kilo, by bag, by
  plant — from one stock pool. User's concrete example: "1 ถุง ได้ 2 ต้น หรือ
  1 กิโลได้ 8 ต้น." This drove the base-unit = plants + per-unit conversion model
  (D-05/D-06) so oversell protection holds no matter which unit is ordered.
- Build the engine **correct-from-day-one** so Phase 2 (payment/hold-expiry) and
  Phase 3 (crop auto-feed, B2B, subscriptions) plug in without a rewrite —
  reflected in quota/reserved (D-07), full pipeline (D-19), both price tiers
  (D-15), and per-variety g/plant (D-22).

</specifics>

<deferred>
## Deferred Ideas

- **Admin UI** — Phase 1 is API-only; catalog/round/pricing UI belongs to the
  Phase 2/3 UI phases.
- **Build-your-box (customer-chosen mixed box)** — Phase 1 uses fixed BOM;
  configurable boxes are a later capability.
- **B2B price-tier visibility gating / credit terms** — CUST-02, Phase 3. Phase 1
  only stores both tiers.
- **Real LINE notifications & auto-substitution execution** — ORD-04/LINE-03,
  Phase 2.
- **Hold-expiry auto-release of reserved stock** — PAY-03, Phase 2 (pg-boss job);
  Phase 1 model already supports it.
- **Invoice PDF generation** — Phase 2 (pdfmake + Thai font); Phase 1 stores the
  data only.
- **Formal round-close job** — Phase 1 enforces cut-off at request time; a
  scheduled close job can come in Phase 3.
- **CROP auto-feed of sellable quantity** — Phase 3 replaces Phase 1's manual
  per-round plant entry.

</deferred>

---

*Phase: 1-Commerce Core*
*Context gathered: 2026-07-02*
