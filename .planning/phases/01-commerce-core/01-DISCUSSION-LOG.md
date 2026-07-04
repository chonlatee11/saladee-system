# Phase 1: Commerce Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 1-Commerce Core
**Areas discussed:** Admin surface, Round & stock model, Pricing & pack computation, Mixed box, Substitution/notify, Order status pipeline, Selling round lifecycle, Invoice-ready record, Pack/weight model

---

## Admin surface

| Option | Description | Selected |
|--------|-------------|----------|
| API-only first | REST + TypeBox, Bruno-tested; defer admin UI to Phase 2/3 | ✓ |
| API + minimal admin | Bare-bones Vue admin | |
| API + full admin UI | Full admin UI in Phase 1 | |

**User's choice:** API-only first
**Notes:** Matches roadmap "prove the engine"; web/ Eden Treaty scaffold stays unused for now.

### Order intake in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Real order API endpoint | `POST /orders` that Phase 2 LIFF reuses | ✓ |
| Admin-created order only | Orders created only via admin | |
| You decide | — | |

**User's choice:** Real order API endpoint
**Notes:** Concurrency proof (criterion 2) run via script/Bruno against the real endpoint.

### Customer identity (CUST-01)

| Option | Description | Selected |
|--------|-------------|----------|
| customers table + guest/member | Reserve line_user_id for Phase 2 | ✓ |
| Guest-only (info in order) | No customers table | |
| You decide | — | |

**User's choice:** customers table + guest/member

### Endpoint auth

| Option | Description | Selected |
|--------|-------------|----------|
| Writes need staff, order open | Catalog writes staff-gated; POST /orders open to guest/member | ✓ |
| All endpoints staff-gated | — | |
| You decide | — | |

**User's choice:** Writes need staff, order open

---

## Round & stock model

### Stock grain / base unit

| Option | Description | Selected |
|--------|-------------|----------|
| Per variety per round, in kg | Weight-based counter | |
| Per pack | Pack-count counter | |
| Base = plants (ต้น) | via freeform follow-up | ✓ |

**User's choice (freeform):** "จำนวนเปิดขายอยากให้เป็นได้หลายแบบ เช่น กิโล/ถุง/ต้น … 1 ถุง ได้ 2 ต้น หรือ 1 กิโลได้ 8 ต้น" → chose **base = plants** after a plain-text A(grams)/B(plants) follow-up.
**Notes:** Wants multiple sale units drawing from one pool with conversions; picked plants as canonical base to match farm reality and CROP Phase 3.

### Sale modes (pre-order vs ready-to-ship)

| Option | Description | Selected |
|--------|-------------|----------|
| One counter, mode = round timing | | ✓ (via You decide) |
| Separate ready-to-ship pool | | |
| You decide | — | ✓ |

**User's choice:** You decide → single counter, mode is a round-timing property.

### Reservation lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| quota/reserved split from day one | order → reserved++, cancel → reserved--, no auto-expiry | ✓ |
| Decrement outright, no reserved | | |
| You decide | — | |

**User's choice:** quota/reserved split from day one

---

## Pricing & pack computation

### Rounding

| Option | Description | Selected |
|--------|-------------|----------|
| Round UP to whole baht | No satang; PromptPay-friendly | ✓ |
| Round to 0.25/0.50 baht | | |
| Admin override pack price | | |

**User's choice:** Round UP to whole baht

### Snapshot

| Option | Description | Selected |
|--------|-------------|----------|
| Full snapshot in order line | variety, unit+conversion, kg price, tier, unit price | ✓ |
| Store price_id reference only | | |
| You decide | — | |

**User's choice:** Full snapshot in order line

### Price cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Per round | | |
| Per day (effective date) | | |
| Both (round primary) | round default + dated override | ✓ |

**User's choice:** Both, round primary

### Price tiers

| Option | Description | Selected |
|--------|-------------|----------|
| Both tiers + snapshot records tier | gating deferred to Phase 3 | ✓ |
| B2C only | | |
| You decide | — | |

**User's choice:** Both tiers + order records tier used

---

## Mixed box

### Box definition

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed recipe/BOM | | ✓ (via You decide) |
| Build-your-box | | |
| You decide | — | ✓ |

**User's choice:** You decide → fixed recipe/BOM; availability = min; all-or-nothing decrement.

### Box price

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed box price | | |
| Sum of components | | |
| Both | default sum + optional override | ✓ |

**User's choice:** Both (default sum, override allowed)

---

## Substitution / notify (INV-08/09)

| Option | Description | Selected |
|--------|-------------|----------|
| Data-only, no real sends | policy field + sold-out status + back-in-stock request record | ✓ |
| Auto-substitute in engine | | |
| You decide | — | |

**User's choice:** Data-only, no real sends (LINE sends in Phase 2; no engine auto-substitute)

---

## Order status pipeline

### Pipeline scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full pipeline, staff API transitions | | ✓ |
| Subset relevant to Phase 1 | | |
| You decide | — | |

**User's choice:** Full pipeline now, transitions via staff API

### Stock release transition

| Option | Description | Selected |
|--------|-------------|----------|
| Only cancelled releases | atomic, prevents double-release | ✓ |
| Cancel window until packing | | |
| You decide | — | |

**User's choice:** Only cancelled releases reserved

---

## Selling round lifecycle

### Cut-off behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-block by time at request | open→closed states; no cron needed | ✓ |
| Manual open/close only | | |
| You decide | — | |

**User's choice:** Auto-block by time (checked at request)

### Round scope

| Option | Description | Selected |
|--------|-------------|----------|
| Shop-wide round | one cut-off/harvest/delivery covering many varieties | ✓ |
| Per-variety round | | |
| You decide | — | |

**User's choice:** Shop-wide round; per-variety sellable qty + price within it

---

## Invoice-ready record

| Option | Description | Selected |
|--------|-------------|----------|
| Structure/fields present, optional | recipient/tax fields optional; PDF in Phase 2 | ✓ |
| Price snapshot only | | |
| You decide | — | |

**User's choice:** Structure/fields present but optional

---

## Pack / weight model

| Option | Description | Selected |
|--------|-------------|----------|
| Per variety | g/plant + pack list per variety; feeds CROP-01 | ✓ |
| Global pack definitions | | |
| You decide | — | |

**User's choice:** Per variety

---

## Claude's Discretion

- Sale-mode modeling (single counter, mode = round timing) — "you decide".
- Mixed box definition (fixed BOM, min-availability, all-or-nothing) — "you decide".
- Row-locking mechanism for the atomic decrement (FOR UPDATE vs conditional UPDATE / SKIP LOCKED) — deferred to research/planner per CLAUDE.md.
- Table/column layout, migration structure, api/src directory layout, TypeBox schema shapes.
- Whether the daily price override is a separate table or a nullable dated row.

## Deferred Ideas

- Admin UI (Phase 2/3 UI phases).
- Build-your-box configurable mixed box.
- B2B price-tier visibility gating / credit terms (CUST-02, Phase 3).
- Real LINE notifications & auto-substitution execution (Phase 2).
- Hold-expiry auto-release of reserved stock (PAY-03, Phase 2, pg-boss).
- Invoice PDF generation (Phase 2, pdfmake + Thai font).
- Formal round-close job (Phase 3).
- CROP auto-feed of sellable quantity (Phase 3, replaces manual plant entry).
