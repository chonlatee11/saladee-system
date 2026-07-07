# Phase 3: Back-office, Crop Planning & B2B/Subscription - Research

**Researched:** 2026-07-07
**Domain:** Crop-yield forecasting → stock auto-feed, B2B/subscription quota reservation, pg-boss recurring generation, RBAC staff back-office (Vue admin SPA), server-side Thai PDF, canned LINE chatbot
**Confidence:** HIGH (existing codebase seams verified by direct read; new libs verified on npm registry)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Crop planning & forecast → auto sellable qty (CROP-01..06, INV-10)**
- **D-01:** Variety parameter registry (CROP-01) **extends the existing `varieties` table**. `avgGramsPerPlant` already exists (Phase-1 D-22); add days-to-harvest, survival/haircut %, harvest window, shelf-life days.
- **D-02:** Confidence haircut is **per-variety**. Sellable qty per round = projected plants × (survival/buffer % per variety). Result feeds `round_stock.quota_plants`.
- **D-03:** Forecast → sellable qty is **GATED behind admin confirmation**. Draft quota computed, admin reviews and **publishes** before round opens; **manual override retained permanently** after publish. No silent auto-open.
- **D-04:** Actual harvest logging records **actual vs forecast + displays delta; admin adjusts variety params manually (no auto-tuning).** (CROP-05.)
- **D-05:** Traceability: **1 planting batch = 1 lot.** best-before **computed automatically** = harvest date + per-variety shelf-life days. (INV-10.)
- **D-06:** Planting Mix (CROP-06) is a **saved recipe template** (varieties + plant counts, ~200 plants / 6 varieties). One click on Monday plant date **auto-creates batches**, editable per round.
- **D-07:** Batch → round mapping is **automatic by projected harvest date** (plant date + days-to-harvest matched to round `harvestDate`); same-variety batches sum into that round's variety `quota_plants`.

**B2B — wholesale, quota & credit (CUST-02, CUST-05)**
- **D-08:** Customer becomes B2B by **self-signup → pending → admin approval**. Approved B2B accounts see the `b2b` price tier (Phase-1 `prices` already stores both tiers; this phase gates *visibility*).
- **D-09:** B2B standing orders **reserve quota from forecast at round-creation time, before B2C stock opens** (CUST-05). Reuses Phase-1 quota/reserved counter (D-07).
- **D-10:** Overflow policy = **reserve first-come-first-served + flag the admin.** Overflow surfaced as a flag (does NOT auto-decide).
- **D-11:** B2B credit (MVP) = **record terms + per-order unpaid/paid status** (invoice-later); no hard credit-limit blocking.

**Subscription (SALE-03)**
- **D-12:** Subscription = a **pre-defined package** (S/M/L by value, e.g. 500฿ box). System fills the box from varieties available that round. Customer picks **package + frequency**, not per-variety.
- **D-13:** pg-boss **auto-generates the subscription order AND reserves stock at round-open, before walk-in B2C** — subscriptions get priority quota (parallel to B2B D-09). First background generator; reuses Phase-2 pg-boss seam.
- **D-14:** pause / skip / cancel allowed **until the round's cut-off.** After cut-off the generated order locks and follows normal payment/hold-expiry path.
- **D-15:** Billing is **per-round, reusing the Phase-2 payment flow** — PromptPay QR + slip upload + hold-expiry per round. No recurring/prepaid billing engine.
- **D-16:** Substitution in auto-filled box → **fill from what's actually available to reach package value, AND notify the customer via LINE.** Reuses Phase-2 notify (Flex).

**Back-office app, RBAC, packing, settings (ADM-01/02/03, ORD-03)**
- **D-17:** Back-office is a **separate app `web-admin/`** (new Vue + Vite package), desktop staff, `jose` session auth — distinct from LIFF `web/`. Reuses Eden Treaty typed client + Phase-0 auth.
- **D-18:** `web-admin/` uses **TanStack Query (`@tanstack/vue-query`)** for server-state + **TanStack Table (`@tanstack/vue-table`, headless)** for all data grids. Pairs with Eden Treaty client + Tailwind.
- **D-19:** RBAC least-privilege. `roleEnum` (owner/admin/grower/packer) exists. owner/admin = full; **grower** = crop/planting/harvest only; **packer** = pack queue only.
- **D-20:** Packing queue **groups by delivery round → then by delivery method/zone (route)**. Reuses Phase-2 `orders.deliveryMethod`/`deliveryZone` snapshot.
- **D-21:** Pack/label slips are **PDF via pdfmake + embedded Thai font (Sarabun)** — same lib/font as invoice PDF (PAY-04).
- **D-22:** System settings: frequently-changed values move to admin UI (rounds, daily prices, delivery fee/zones, hold window, haircut %, B2B quota ceiling). **Risky/secret values stay in committed config/env** (payee ID, slip-verify API key, secrets).

**Dashboard & reports (ADM-01, MKT-04)**
- **D-23:** Dashboard = 4 criterion cards (today's/this-round sales, unpaid orders, near-sold-out, next-round forecast yield) **PLUS a B2B/subscription card** (standing/subscription due + D-10 overflow flag).
- **D-24:** Reports (MKT-04) = **full analytics** — interactive charts + filters by period/channel/product/round, best-sellers, repeat customers, AOV, with **CSV export.** (Intentional, not over-build.)

**Chatbot (MKT-02)**
- **D-25:** Canned LINE chatbot — **no NLU**. Keyword/postback replies for "เมนูรอบนี้ / ราคาวันนี้ / ของเหลือ" return Flex cards + **deep-link that opens LIFF to order**. "Takes orders" = routes into LIFF, not in-chat ordering. Reuses Phase-2 webhook + Flex path.

### Claude's Discretion
- Exact new tables/columns + **reversible migrations** (up + hand-written down per Phase-0 D-12/13): variety-param extension, planting batches, planting-mix templates, harvest logs/lots, subscriptions, B2B standing orders, B2B credit-terms/status, report aggregate queries.
- `web-admin/` directory layout, routing, component structure; exact `@tanstack/vue-query`/`@tanstack/vue-table` versions (research pins current); a self-contained low-cost chart library for D-24 (NFR-08).
- Exact Flex-card copy for chatbot (D-25) + substitution notice (D-16); dashboard card layout.
- Whether planting-mix template / harvest-log are separate tables or extend existing; precise TypeBox schemas for all new endpoints.

### Deferred Ideas (OUT OF SCOPE)
- Full B2B credit line/limit with blocking (D-11 records terms + pay status only).
- Demand-driven reverse planting recommendation (CROP-07) — Phase 4.
- Conversational/NLU chatbot ordering + segmented broadcast (LINE-04/MKT-03) — Phase 4.
- Public web storefront (ORD-05), promotions/coupons (MKT-01), loyalty/points (CUST-03), multi-carrier tracking API (DEL-05) — Phase 4.
- Auto parameter tuning from harvest history (D-04 manual to avoid drift).
- Recurring/prepaid subscription billing engine (per-round QR + hold reuses Phase-2, D-15).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CROP-01 | Variety params (days-to-harvest, g/plant, survival %, harvest window) | Extend `varieties` (§Standard Stack / §Pattern 1); `avgGramsPerPlant` already present |
| CROP-02 | Planting Batch record (variety, plant date, plant count, bed/tray) | New `planting_batches` table (§Pattern 1) |
| CROP-03 | Auto-compute harvest date + expected yield from variety params | Pure derived-column / service compute (§Pattern 1, §Code Examples) |
| CROP-04 | Harvest calendar → auto-feed sellable qty per round (replaces manual) | Batch→round sum WRITES `round_stock.quota_plants` behind admin publish gate (§Pattern 1/2) |
| CROP-05 | Log actual harvest vs forecast, show delta | New `harvest_logs` table + delta compute (§Pattern 1) |
| CROP-06 | Planting Mix template → auto-create batches | `planting_mix_templates` recipe → batch spawn (§Pattern 1) |
| INV-10 | Lot / best-before traceability | 1 batch = 1 lot; best-before = harvestDate + shelfLifeDays (D-05, §Pattern 1) |
| CUST-02 | B2B wholesale visibility + credit terms | Gate `b2b` price tier visibility; add B2B flag/approval + credit-terms cols (§Pattern 3) |
| CUST-05 | B2B standing order + forecast quota reserved before B2C | Reserve via existing `reserve()` at round-open (§Pattern 2) |
| SALE-03 | Subscription box: package+frequency, auto-gen, pause/skip/cancel | pg-boss round-open generator + reserve (§Pattern 2/4) |
| ORD-03 | Pack queue by route + printable pack/label slips | Group by round→deliveryMethod/zone; pdfmake PDF (§Pattern 5, §Pattern 6) |
| MKT-02 | Canned LINE chatbot menu/stock + take orders | Extend `webhook.ts` postback routing → Flex + LIFF deep-link (§Pattern 7) |
| MKT-04 | Sales reports by period/channel/product/round + CSV | Aggregate SQL + Chart.js + papaparse CSV (§Pattern 8) |
| ADM-01 | Dashboard (today/round sales, unpaid, near-sold-out, next yield) | Aggregate queries + TanStack Query (§Pattern 8) |
| ADM-02 | Role-based access (owner/admin/grower/packer) | Extend `requireRole()` on new endpoints + nav gating (§Pattern 3) |
| ADM-03 | System settings configurable | DB-backed settings table for hot values; secrets stay in env (D-22, §Pattern 3) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Locked stack (do not deviate):** Bun 1.3.14 / Elysia 1.4.29 / PostgreSQL 17 / Drizzle 0.45.2 / postgres.js 3.4.9 / TypeBox / jose 6.2.3 / Vue 3.5.39 + Vite 8.1.0 + Tailwind 4.3.1.
- **Phase-3-relevant libs already in CLAUDE.md table:** pg-boss 12.23.0, pdfmake 0.3.11 + Sarabun font (must embed Thai font), @elysiajs/eden 1.4.9.
- **"What NOT to Use":** no Prisma (Drizzle only, explicit `FOR UPDATE`), no payment gateway for PromptPay (self-hosted QR), no Firebase/Mongo (PG relational only), no Express/NestJS (Elysia), no serverless free tier for webhook/timer.
- **NFR-02** oversell protection: atomic guarded decrement — never add SELECT-then-check.
- **NFR-08** lowest cost: reuse the single PG + pg-boss; new libs must be self-contained/offline (no paid SaaS, no external chart service).
- **NFR-04** PDPA: private slip bucket + signed URL; never log secrets/API keys.
- **Money is ALWAYS integer satang** (never float/numeric).
- **Reversible migrations:** every migration has a hand-written `.down.sql` (drizzle-kit emits no down). Drop children before parents, pgEnum type LAST, `IF EXISTS` everywhere.
- **Migrations run on `DATABASE_URL_DIRECT`** (unpooled) — Pitfall 2.
- **TanStack Query/Table + chart lib are NOT in CLAUDE.md** — user-chosen (D-18/D-24); versions pinned in this doc.

## Summary

Phase 3 เป็น **layer เพิ่มบน engine ที่มีอยู่แล้ว** ไม่ใช่การสร้างใหม่. โครงสร้าง Phase 0–2 ออกแบบมารองรับเฟสนี้ตรง ๆ: ตัว oversell counter (`round_stock.quota_plants` / `reserved_plants`) แยก quota (ตัวตั้ง) ออกจาก reserved (ตัวจอง) ชัดเจน — crop forecast แค่ **เขียน `quota_plants`**, ส่วน B2B/subscription **จอง `reserved_plants` ผ่าน `reserve()` เดิม** ที่พิสูจน์แล้วว่ากัน oversell ได้. ไม่ต้องแตะ guard เลย. pg-boss มี worker seam พร้อม (hold-expiry) — subscription/standing generator เป็น worker ตัวใหม่บน pattern เดิม. RBAC มี `requireRole()` + `roleEnum` (owner/admin/grower/packer) + staff login (`POST /auth/staff`) ครบแล้ว — เฟสนี้แค่เพิ่ม grower/packer ลง endpoint ที่เกี่ยว. webhook + notify (Flex) พร้อมต่อ chatbot.

งานใหม่จริง ๆ คือ: (1) ตารางใหม่ ~6–8 ตัว (variety param extension, planting batches, mix templates, harvest logs/lots, subscriptions, standing orders, B2B approval/credit, settings) + reversible migrations; (2) forecast compute service + admin publish gate; (3) **แอป `web-admin/` ใหม่ทั้งตัว** (Vue+Vite+TanStack) — งาน frontend ก้อนใหญ่สุด; (4) 3 external libs ใหม่ (TanStack Query/Table, Chart.js, pdfmake+papaparse).

**ความเสี่ยงสูงสุด** ไม่ใช่ oversell (engine พร้อม) แต่คือ: **ลำดับการจอง** (B2B+subscription ต้องจองก่อน B2C เปิด — เป็นเรื่อง *เวลา/orchestration* ไม่ใช่ locking), **pdfmake ฟอนต์ไทยฝั่ง server บน Bun** (gotcha คลาสสิก), และ **ขนาดงาน `web-admin/`** (dashboard + reports + 10+ ตารางในแอปใหม่).

**Primary recommendation:** ต่อยอด seam เดิมทุกจุด — crop forecast เขียน `quota_plants`, B2B/subscription จองผ่าน `reserve()` เดิม, generator เป็น pg-boss worker ใหม่, RBAC ขยาย `requireRole()`, chatbot ขยาย `webhook.ts`. สร้าง `web-admin/` เป็น package แยกที่ mirror `web/` (Eden Treaty typed client). ห้าม hand-roll: forecast/reservation ordering ต้องเดินผ่าน guarded `reserve()` เท่านั้น, ห้ามคำนวณ available stock เองนอก transaction.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Yield forecast compute (CROP-03) | API / Backend (service) | — | Derived from variety params; pure fn, deterministic, testable |
| Sellable-qty publish (CROP-04, D-03) | API / Backend (writes `quota_plants`) | web-admin (review UI) | Stock correctness is a DB property; UI only triggers publish |
| B2B + subscription reservation (D-09/D-13) | API / Backend (`reserve()` in tx) | pg-boss worker (subscription trigger) | Oversell guarantee lives in the guarded UPDATE — never client |
| Subscription round-open generation (D-13) | pg-boss worker (Backend) | — | Recurring/scheduled = background job on existing worker seam |
| RBAC enforcement (ADM-02) | API / Backend (`requireRole`) | web-admin (nav hide) | Server is the authority; nav-hiding is cosmetic only |
| Data grids / dashboard / reports UI (ADM-01, MKT-04) | web-admin SPA (Vue) | API (aggregate endpoints) | Client renders; server computes aggregates + owns pagination |
| Pack/label PDF (D-21) | API / Backend (pdfmake) | web-admin (download trigger) | Font embedding + layout server-side; browser just downloads |
| Canned chatbot (MKT-02) | API / Backend (`webhook.ts`) | LINE client (Flex render) | Keyword routing + Flex build server-side; no DOM |
| CSV export (D-24) | web-admin (papaparse) OR API | — | Small datasets client-side; large → server stream (see §Pattern 8) |

## Standard Stack

### Core (already installed — REUSE, do not re-add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| elysia | 1.4.29 | API framework | Existing; all new endpoints follow `makeXRoutes(db)` + TypeBox pattern [VERIFIED: api/package.json] |
| drizzle-orm | 0.45.2 | ORM + migrations | Existing; new tables extend `schema.ts` [VERIFIED: api/package.json] |
| postgres | 3.4.9 | PG driver | Existing [VERIFIED: api/package.json] |
| pg-boss | 12.23.0 | Job queue + cron | Existing worker seam; subscription/standing generators plug in [VERIFIED: api/package.json + jobs/boss.ts] |
| jose | 6.2.3 | Session JWT | Existing `requireRole`/`issueSession` reused by web-admin [VERIFIED: api/plugins/auth.plugin.ts] |
| @line/bot-sdk | 11.0.2 | LINE Messaging | Existing webhook + notify; chatbot extends it [VERIFIED: api/package.json] |
| vue | 3.5.39 | web-admin UI | Same as `web/`; web-admin mirrors it [VERIFIED: web/package.json] |
| vite | 8.1.0 | build | Same as `web/` [VERIFIED: web/package.json] |
| tailwindcss | 4.3.1 | styling | CSS-first `@theme`; web-admin reuses `web/` tokens [VERIFIED: web/package.json] |
| @elysiajs/eden | 1.4.9 | typed client | web-admin imports `App` type like `web/src/api.ts` [VERIFIED: web/package.json] |
| lucide-vue-next | ^1.0.0 | icons | Already a `web/` dep; reuse in web-admin [VERIFIED: web/package.json] |

### Supporting (NEW this phase — install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/vue-query | 5.101.2 | server-state fetch/cache (D-18) | web-admin data layer; wraps Eden calls as query fns [VERIFIED: npm registry 2026-06-30] |
| @tanstack/vue-table | 8.21.3 | headless data grids (D-18) | every web-admin table (orders, packing, catalog, reports) [VERIFIED: npm registry 2026-07-07] |
| chart.js | 4.5.1 | canvas charts (D-24) | reports charts; self-contained, offline, MIT [VERIFIED: npm registry 2025-10-13] |
| vue-chartjs | 5.3.3 | Vue 3 wrapper for Chart.js | thin Vue binding over chart.js 4 [VERIFIED: npm registry 2025-11-03] |
| pdfmake | 0.3.11 | pack/label + invoice PDF (D-21) | server-side PDF with embedded Sarabun [VERIFIED: npm registry 2026-06-12; in CLAUDE.md table] |
| papaparse | 5.5.4 | CSV export (D-24) | serialize report rows → CSV client- or server-side [VERIFIED: npm registry 2026-06-19] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| chart.js + vue-chartjs | @unovis/vue 1.6.7 | Smaller/SVG, but chart.js is more battle-tested for bar/line/pie mix; UI-SPEC recommends chart.js. Unovis fine if a lighter footprint is wanted. |
| papaparse | hand-rolled `Array.join(',')` | Hand-roll breaks on Thai commas/quotes/newlines in fields; papaparse escapes correctly (RFC 4180). See §Don't Hand-Roll. |
| pdfmake vfs base64 blob | pdfmake `PdfPrinter` (fs fonts) | Server-side, `PdfPrinter` reads TTF straight from disk — no giant base64 vfs module. Recommended (see §Pattern 6). |

**Installation:**
```bash
# web-admin/ (new package)
bun add @tanstack/vue-query @tanstack/vue-table chart.js vue-chartjs papaparse
bun add -d vue vite @vitejs/plugin-vue @vue/compiler-sfc tailwindcss @tailwindcss/vite  # mirror web/
# API (pdfmake — pack/label + invoice PDF, server-side)
cd api && bun add pdfmake
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @tanstack/vue-query | npm | mature (TanStack) | very high | github.com/TanStack/query | OK | Approved |
| @tanstack/vue-table | npm | mature (TanStack) | very high | github.com/TanStack/table | OK | Approved |
| chart.js | npm | 10+ yrs | ~5M/wk class | github.com/chartjs/Chart.js | OK | Approved |
| vue-chartjs | npm | 8+ yrs | high | github.com/apertureless/vue-chartjs | OK | Approved |
| pdfmake | npm | 10+ yrs | high | github.com/bpampuch/pdfmake | OK | Approved (already in CLAUDE.md) |
| papaparse | npm | 10+ yrs | ~3M/wk class | github.com/mholt/PapaParse | OK | Approved |

All 6 checked via `npm view <pkg> version / repository.url / scripts.postinstall / time.modified`. No postinstall scripts on any package. All resolve to well-known, long-lived, actively-maintained repos with recent publish dates (2025-10 → 2026-07). No SLOP, no SUS.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> Note: package names came from the approved 03-UI-SPEC (D-18/D-24, user-chosen) + CLAUDE.md — authoritative project docs, not free WebSearch discovery. Versions were confirmed on the npm registry directly.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────── EXISTING (Phase 0–2) ───────────────────────┐
 STAFF (desktop)          │                                                                     │
   web-admin/ SPA ──HTTPS──> Elysia API (index.ts composition)                                  │
   (Vue+TanStack)     │      ├── requireRole() guard (jose HS256 session)  ◄── POST /auth/staff  │
        │             │      │                                                                   │
        │ Eden Treaty │      ├── reservation.ts: reserve()/release()  ── guarded UPDATE ──┐       │
        │ typed calls │      │                                                            ▼       │
        ▼             │      ├── order-transition.ts: applyTransition() ──► round_stock (quota/   │
                      │      │                              (row-lock + release on cancel) reserved)│
 CUSTOMER (mobile)    │      ├── notify.ts (Flex push) ──► LINE client                            │
   web/ LIFF ─────────┘      ├── webhook.ts (signature-checked inbound)                          │
                             └── pg-boss worker (hold-expiry + hold-sweep cron)                  │
                          └─────────────────────────────────────────────────────────────────────┘

                          ┌─────────────────────────── NEW (Phase 3) ──────────────────────────┐
 admin publishes ─────────► forecast service: batch(plantDate+daysToHarvest→round) × plants ×    │
                          │   survival% ── writes ──► round_stock.quota_plants  (D-02/03/04/07)   │
                          │                                                                       │
 round opens (pg-boss) ───► subscription generator ─┐                                             │
 admin creates standing ──► B2B standing reserve ───┼─► reserve(round, variety, plants) [SAME fn] │
                          │   (BEFORE B2C opens)     │      ├─ ok    → quota locked for member     │
                          │                          │      └─ false → OVERFLOW FLAG to admin (D-10)│
                          │   generated order ──► Phase-2 payment flow (QR+slip+hold) [REUSE]      │
                          │                                                                       │
 keyword/postback ───────► webhook.ts canned router ──► Flex card + LIFF deep-link (D-25)         │
 report request ─────────► aggregate SQL ──► TanStack Query ──► Chart.js / papaparse CSV (D-24)   │
 print request ──────────► pdfmake + Sarabun (PdfPrinter) ──► PDF buffer download (D-21)          │
                          └─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
api/src/
├── db/schema.ts                    # EXTEND: variety params + ~7 new tables
├── services/
│   ├── forecast.ts                 # NEW: batch→round yield compute (pure, tested)
│   ├── crop.ts                     # NEW: mix-template → batch spawn, lot/best-before
│   ├── subscription.ts             # NEW: box-fill from round availability + substitution
│   └── reservation.ts              # REUSE unchanged (reserve/release/reserveBox)
├── jobs/boss.ts                    # EXTEND: add subscription + standing generators
├── routes/
│   ├── crop.ts, harvest.ts         # NEW: grower-gated CRUD
│   ├── subscriptions.ts            # NEW
│   ├── b2b.ts                      # NEW: approval, standing orders, credit terms
│   ├── packing.ts                  # NEW: packer-gated queue + PDF
│   ├── reports.ts, dashboard.ts    # NEW: aggregates
│   ├── settings.ts                 # NEW: hot config
│   └── webhook.ts                  # EXTEND: canned chatbot postback routing
├── pdf/pack-slip.ts, label-slip.ts # NEW: pdfmake docDefinitions
└── fonts/Sarabun-*.ttf             # NEW: embedded Thai font files (400 + 600)

web-admin/                          # NEW package (mirror web/ layout)
├── src/
│   ├── api.ts                      # Eden treaty<App>() — copy web/src/api.ts
│   ├── main.ts                     # + VueQueryPlugin install
│   ├── router.ts                   # RBAC-gated routes
│   ├── style.css                   # @theme re-using web/ tokens (UI-SPEC)
│   ├── composables/                # useOrders, usePackingQueue (TanStack Query)
│   ├── components/DataTable.vue     # headless @tanstack/vue-table wrapper
│   └── views/                      # Dashboard, CropPlanning, Packing, Reports, Settings...
```

### Pattern 1: Forecast → `quota_plants` (crop auto-feed, CROP-03/04/07 + D-02/07)
**What:** Each planting batch's projected harvest date = `plantDate + daysToHarvest`. Match to the round whose `harvestDate` equals that date; sum `plantCount × survivalPct` across same-variety batches into that round's `round_stock.quota_plants`.
**When:** Admin clicks publish (D-03 gate) — never automatic.
**Example:**
```typescript
// forecast.ts — pure, deterministic, unit-testable (Wave-0 test target)
export function projectedHarvestDate(plantDate: Date, daysToHarvest: number): Date {
  const d = new Date(plantDate); d.setDate(d.getDate() + daysToHarvest); return d;
}
export function forecastPlants(plantCount: number, survivalPct: number): number {
  return Math.floor(plantCount * survivalPct / 100); // per-variety haircut (D-02); floor = conservative
}
export function bestBefore(harvestDate: Date, shelfLifeDays: number): Date { // D-05
  const d = new Date(harvestDate); d.setDate(d.getDate() + shelfLifeDays); return d;
}
```
The publish step then UPSERTs `round_stock` (round, variety) with the summed forecast — reusing the existing `round_stock_round_variety_idx` unique index. Manual override (D-03) is a later staff write to the same `quotaPlants` column; keep an `is_manual_override` boolean so re-publish never clobbers a hand-set value.

### Pattern 2: Reservation ordering — B2B/subscription BEFORE B2C (D-09/D-13, CUST-05)
**What:** "Reserved before B2C opens" is an **orchestration/timing** property, NOT a new locking primitive. At round-open, run B2B-standing + subscription reservations FIRST (each calls the existing `reserve()`), so `reserved_plants` is pre-incremented before any B2C order can call `reserve()`. B2C then sees `quota − reserved` = only the leftover.
**When:** round-open event (pg-boss for subscriptions D-13; admin/round-creation for standing D-09).
**Example:**
```typescript
// Reuse reservation.ts UNCHANGED. Priority is achieved by ORDER OF EXECUTION.
await db.transaction(async (tx) => {
  const ok = await reserve(tx, roundId, varietyId, memberPlants); // existing guarded UPDATE
  if (!ok) {
    // D-10: overflow — do NOT auto-decide. Flag the admin, record the shortfall.
    await tx.insert(quotaOverflowFlags).values({ roundId, varietyId, shortfall: memberPlants });
  }
});
```
**Anti-pattern:** do NOT invent a second "priority reserved" counter or a `SELECT available` pre-check — that reintroduces the TOCTOU/oversell window the guarded UPDATE was built to close.

### Pattern 3: RBAC extension + settings (ADM-02/03, D-19/22)
**What:** `requireRole(...allowed)` already returns 401/403 correctly. Add grower/packer to the relevant endpoints; keep owner/admin on everything.
```typescript
const grower = requireRole("owner", "admin", "grower"); // crop/harvest routes
const packer = requireRole("owner", "admin", "packer"); // packing routes
const staff  = requireRole("owner", "admin");           // settings, reports, B2B approval
```
web-admin nav hides out-of-role sections (cosmetic, D-19) — server guard is the authority. Settings (D-22): a `settings` table (key/value JSONB) for hot values; secrets remain in `env.ts` TypeBox-validated config and are **absent from the settings API response**.

### Pattern 4: pg-boss recurring subscription generation (D-13/D-14)
**What:** A cron-scheduled queue that, per open round, generates one order per active subscription and reserves its box components — reusing the Phase-2 worker lifecycle (`startJobs()` under `import.meta.main`, DIRECT unpooled URL).
**When:** round-open (D-13). Handler MUST be idempotent (pg-boss default retryLimit = 2 [CITED: github.com/timgit/pg-boss releases/10.0.0]).
**Example:**
```typescript
// jobs/boss.ts — add alongside hold-expiry. Idempotency: a UNIQUE(subscriptionId, roundId)
// on generated orders makes a retry a no-op (23505 → skip), NOT a duplicate box.
await boss.createQueue("subscription-generate");
await boss.work("subscription-generate", async (jobs) => {
  for (const job of jobs) await generateForRound(db, (job.data as {roundId:string}).roundId);
});
// schedule with an explicit key so scheduling itself dedups (singletonKey label only under
// standard policy — CITED pg-boss docs). Prefer a DB unique constraint as the real guard.
```
**Pause/skip/cancel (D-14):** generation reads subscription status at run time — `paused`/`skipped`/`cancelled` rows are skipped. After cut-off the generated order locks (follows normal hold-expiry). Status changes after cut-off apply to the NEXT round (UI copy already contracted in 03-UI-SPEC).

### Pattern 5: Packing queue grouping (ORD-03, D-20)
Group paid orders by `roundId` → then by `deliveryMethod`/`deliveryZone` (existing snapshot columns on `orders`). No new join needed; a single indexed query ordered by `(round_id, delivery_zone)` feeds the queue. Per-order pack state ("to-pack"/"packed") = a new nullable `packed_at` column on `orders` (additive migration).

### Pattern 6: Server-side Thai PDF (D-21) — use `PdfPrinter`, not vfs blob
**What:** pdfmake's browser path uses a base64 `vfs_fonts` blob; server-side, the cleaner path is `PdfPrinter` reading TTF straight from disk.
**Example:**
```typescript
// api/src/pdf/pack-slip.ts
import PdfPrinter from "pdfmake/src/printer";
const printer = new PdfPrinter({
  Sarabun: {            // weights 400 + 600 only (UI-SPEC typography)
    normal: "src/fonts/Sarabun-Regular.ttf",
    bold:   "src/fonts/Sarabun-SemiBold.ttf",
  },
});
export function renderPackSlip(doc: TDocumentDefinitions): Promise<Buffer> {
  const pdf = printer.createPdfKitDocument({ ...doc, defaultStyle: { font: "Sarabun" } });
  const chunks: Buffer[] = [];
  return new Promise((res, rej) => {
    pdf.on("data", c => chunks.push(c)).on("end", () => res(Buffer.concat(chunks))).on("error", rej);
    pdf.end();
  });
}
```
**Bun caveat:** pdfmake depends on pdfkit (Node stream/fs APIs). Bun 1.3 is ~98% Node-compatible; treat "pdfmake renders a valid Thai PDF buffer under Bun" as a **must-verify Wave-0 spike** (§Open Questions). If a Bun/pdfkit incompatibility surfaces, the fallback is generating the vfs the standard way. [VERIFIED: WebSearch pdfmake server-side font docs; Bun compat ASSUMED]

### Pattern 7: Canned chatbot postback routing (MKT-02, D-25)
Extend the EXISTING `webhook.ts` (keep the raw-bytes-first signature check — Pitfall 1 there). Route on `event.message.text` keyword OR `event.postback.data`; reply with a Flex card built like `notify.ts buildOrderFlex`, footer button = LIFF deep-link (`https://liff.line.me/${LIFF_ID}/...`). Fallback text for unmatched input. NO NLU, NO in-chat order state.

### Pattern 8: Dashboard + reports aggregates (ADM-01, MKT-04, D-23/24)
Aggregate SQL lives server-side (Drizzle `sql` + `groupBy`); web-admin fetches via TanStack Query and renders with Chart.js. CSV: for MVP volumes, `papaparse.unparse(rows)` client-side is fine; if a report grows large, stream from the API instead. Keep channel↔color mapping fixed (UI-SPEC chart palette).

### Anti-Patterns to Avoid
- **Second reservation counter for "priority":** breaks the single-source oversell guarantee. Priority = execution order (Pattern 2).
- **SELECT available then INSERT order:** classic TOCTOU. Always `reserve()` (guarded UPDATE) inside the tx.
- **Auto-tuning variety params from harvest logs:** explicitly deferred (D-04). Show delta only.
- **Editing `index.ts` composition order for new routes:** append `.use(newRoutes)` at the end — never reorder (Phase-0 fixed-order invariant).
- **Hand-rolled CSV string join:** breaks on Thai/quotes/newlines — use papaparse.
- **Logging LINE token / slip-verify key:** PDPA + T-02-29. Structured logs never carry secrets.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic oversell reservation | new counter / SELECT-check | existing `reserve()`/`release()` | Proven by N-way race test; correctness is a DB property |
| Order status transitions | ad-hoc UPDATE status | `applyTransition()` | Single row-locked path; 3 callers can't re-break the concurrent-cancel fix |
| Recurring generation | setInterval / custom timer | pg-boss cron (`boss.schedule`) | Survives restart, uses same PG, no extra infra (NFR-08) |
| Data grid sort/filter/paginate | hand-built table logic | @tanstack/vue-table (headless) | Sorting/pagination/column model solved; you own only markup |
| Server-state fetch/cache/refetch | manual `ref` + fetch | @tanstack/vue-query | Caching, dedup, background refetch, loading/error states |
| CSV serialization | `rows.map(r=>r.join(','))` | papaparse `unparse` | RFC-4180 escaping of quotes/commas/newlines/Thai |
| Thai PDF font embedding | manual PDF byte-writing | pdfmake + Sarabun TTF | Glyph shaping, kerning, page layout are hard |
| LINE webhook signature | custom HMAC | `validateSignature` (@line/bot-sdk) | Raw-bytes-first check already correct in webhook.ts |
| Staff auth / RBAC | new login system | `POST /auth/staff` + `requireRole` | Argon2id + timing-safe + jose session already shipped |

**Key insight:** almost every "hard" part of this phase already exists as a tested seam. The genuine new build is UI-heavy (`web-admin/`) + additive schema + one pure forecast service.

## Common Pitfalls

### Pitfall 1: Reintroducing oversell via a "priority" reservation
**What goes wrong:** Building a separate reserved-quota mechanism for B2B/subscription that bypasses `reserve()`.
**Why:** Splitting the counter breaks the single guarded UPDATE that serialises racers.
**How to avoid:** ALL reservations (B2C, B2B, subscription) call the SAME `reserve()`. Priority = who runs first (Pattern 2).
**Warning sign:** any new `SELECT ... quota - reserved` outside a `reserve()` call at write time.

### Pitfall 2: pg-boss subscription generator not idempotent
**What goes wrong:** Retry (default retryLimit=2) generates a duplicate box order for the same subscription+round.
**Why:** pg-boss retries are opt-out; `singletonKey` under standard policy is a label, not dedup [CITED: pg-boss docs].
**How to avoid:** DB `UNIQUE(subscription_id, round_id)` on generated orders — the 23505 makes a retry a safe no-op (mirror the `payments_trans_ref_idx` dedup idiom already in schema).
**Warning sign:** members getting two boxes in one round during a worker restart.

### Pitfall 3: pdfmake fonts under Bun
**What goes wrong:** `vfs_fonts` blob path or pdfkit stream APIs behave differently on Bun; Thai glyphs render as tofu or the buffer never ends.
**How to avoid:** Use `PdfPrinter` + on-disk TTF (Pattern 6). Spike a one-page Thai PDF early (Wave 0). Confirm `defaultStyle.font = "Sarabun"`.
**Warning sign:** empty/blank PDF, `.end()` never firing, or squares instead of Thai.

### Pitfall 4: Migration ordering / reversibility for new pgEnums
**What goes wrong:** New enums (e.g. subscription_status, b2b_status) block `DROP TYPE` if a column still uses them; drizzle-kit emits no down.
**How to avoid:** Follow the existing `0003_*.down.sql` idiom exactly — drop children/indexes/columns first, pgEnum type LAST, `IF EXISTS` everywhere. Run migrations on `DATABASE_URL_DIRECT`.
**Warning sign:** `cannot drop type ... because other objects depend on it` on `db:down`.

### Pitfall 5: CROP-04 silently replacing manual entry with no override kept
**What goes wrong:** Publish overwrites a hand-set `quota_plants` on re-publish, losing the manual override the ROADMAP requires kept permanently.
**How to avoid:** `is_manual_override` flag on `round_stock` (or a parallel column); publish skips rows flagged manual. (D-03.)
**Warning sign:** an admin's hand-corrected quantity reverts after the next forecast publish.

### Pitfall 6: web-admin session/CORS + `customer` role leakage
**What goes wrong:** web-admin origin not in `CORS_ORIGINS`; or a `customer`-role token (issued by `/auth/line`) reaching a staff endpoint.
**How to avoid:** add the web-admin origin to `env.CORS_ORIGINS`. `requireRole` already excludes `customer` from staff lists — never add `customer` to a staff guard. Note `"customer"` is an app-level `Role` not in the DB `roleEnum` (confirm in `api/src/types.ts`).
**Warning sign:** preflight blocks web-admin mutations; or a LIFF token opening an admin page.

## Code Examples

### web-admin Eden Treaty client (copy from web/src/api.ts)
```typescript
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index"; // compile-time contract, erased at build
export const api = treaty<App>(import.meta.env?.VITE_API_URL ?? "http://localhost:3000");
```

### TanStack Query install (web-admin main.ts)
```typescript
import { VueQueryPlugin } from "@tanstack/vue-query";
createApp(App).use(VueQueryPlugin).use(router).mount("#app");
```

### Query wrapping an Eden call
```typescript
import { useQuery } from "@tanstack/vue-query";
export const usePackingQueue = (roundId: string) => useQuery({
  queryKey: ["packing", roundId],
  queryFn: async () => {
    const { data, error } = await api.packing.get({ query: { roundId } });
    if (error) throw error; return data;
  },
});
```

### New route (grower-gated crop CRUD — mirrors makePricesRoutes)
```typescript
export function makeCropRoutes(database = defaultDb) {
  const grower = requireRole("owner", "admin", "grower");
  return new Elysia().post("/planting-batches", async ({ body, set }) => { /* ... */ },
    { body: PlantingBatchBody, beforeHandle: grower });
}
// append `.use(cropRoutes)` at END of index.ts — never reorder existing composition.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase-1 MANUAL sellable qty entry | CROP-04 crop forecast auto-feed + manual override kept | This phase | `quota_plants` written by forecast publish, not by hand (override retained) |
| pdfmake browser vfs base64 blob | `PdfPrinter` fs-font (server) | pdfmake 0.2+ | Cleaner server PDF, no giant vfs module |
| pg-boss v10 default export | v12 named `PgBoss` export | v10→v12 | Already handled in `jobs/boss.ts` |
| Options-in fetch state | TanStack Query cache | — | web-admin gets caching/refetch free |

**Deprecated/outdated:**
- pdfmake 0.1 vfs docs (search hits) — this project pins 0.3.11; use 0.3 `PdfPrinter` server path.
- Any "argon2"/"bcrypt" dep — project uses native `Bun.password` (Argon2id).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pdfmake 0.3.11 renders valid Thai (Sarabun) PDF buffer under Bun 1.3 via `PdfPrinter` | §Pattern 6 / Pitfall 3 | Pack/label + invoice PDF (D-21/PAY-04) blocked; needs Wave-0 spike |
| A2 | `"customer"` is an app-level `Role` accepted by `issueSession` but NOT in DB `roleEnum` | Pitfall 6 | Verify in `api/src/types.ts`; affects RBAC guard correctness |
| A3 | A round has exactly one `harvestDate` that a batch's projected date maps onto cleanly (D-07) | §Pattern 1 | If harvest windows span multiple days, batch→round mapping needs a range match, not equality |
| A4 | Subscription "package value" (S/M/L by ฿) fills from round availability using the existing box/BOM model (D-12) | §Pattern 4 | If value-based fill needs dynamic per-round composition, more logic than a fixed BOM |
| A5 | papaparse client-side CSV is adequate for MVP report volumes | §Pattern 8 | Large exports may need server streaming |
| A6 | Sarabun TTF (Regular + SemiBold) is licensed/available to embed | §Pattern 6 | Sarabun is SIL OFL (free); confirm files added to `api/src/fonts/` |

## Open Questions

1. **pdfmake under Bun (A1)**
   - Known: `PdfPrinter` is the server path; Bun ~98% Node-compat.
   - Unclear: pdfkit stream/fs behavior on Bun for Thai.
   - Recommendation: Wave-0 spike — render one Thai pack slip to a buffer, open it, confirm glyphs.

2. **Batch → round mapping when harvest spans a window (A3, CROP-01 harvest window)**
   - Known: D-07 maps by projected harvest date; CROP-01 adds a harvest *window*.
   - Unclear: does a batch map to the round containing its window start, or overlap?
   - Recommendation: planner picks equality-on-start for MVP; document as a decision.

3. **Subscription value-fill algorithm (A4, D-12/D-16)**
   - Known: package = value (฿); fill from round availability; substitute + notify.
   - Unclear: greedy fill order (by price? by freshness? by stock depth?) to hit target value.
   - Recommendation: define a deterministic fill order in `subscription.ts`; make it a tested pure fn.

4. **Manual-override persistence mechanism (Pitfall 5, D-03)**
   - Recommendation: add `is_manual_override boolean` (or `manual_quota_plants`) to `round_stock`; publish respects it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | all API/build | ✓ (project standard) | 1.3.14 | — |
| PostgreSQL 17 | schema + pg-boss | ✓ (Phase 0 live) | 17.x (Neon/self-host) | — |
| pg-boss on DATABASE_URL_DIRECT | subscription/standing gen | ✓ (Phase 2 wired) | 12.23.0 | — |
| Sarabun TTF (Regular+SemiBold) | pdfmake D-21 | ✗ (must add) | SIL OFL | download OFL fonts → `api/src/fonts/` |
| LINE Messaging + webhook | chatbot D-25 | ✓ (Phase 2 live) | @line/bot-sdk 11 | — |
| web-admin origin in CORS_ORIGINS | web-admin fetch | ✗ (must add) | — | add origin to `env.CORS_ORIGINS` |

**Missing dependencies with no fallback:** none (Sarabun + CORS origin are trivial adds).
**Missing dependencies with fallback:** Sarabun font files (download OFL); web-admin CORS origin (env edit).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (built-in) |
| Config file | none — `bun test` (api/) ; `.env.test` at repo root + api/ |
| Quick run command | `cd api && bun test <file> -t <name>` |
| Full suite command | `cd api && bun test` |

Existing: 187 passing tests (STATE). New pure services (`forecast.ts`, `subscription.ts` fill) are ideal unit targets; reservation-ordering + generator idempotency need integration tests against the seeded pool.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CROP-03 | harvest date + yield compute | unit | `cd api && bun test forecast.test.ts` | ❌ Wave 0 |
| CROP-04 | publish writes quota_plants; manual override kept | integration | `cd api && bun test forecast-publish.test.ts` | ❌ Wave 0 |
| CROP-05 | actual-vs-forecast delta | unit | `cd api && bun test harvest-log.test.ts` | ❌ Wave 0 |
| INV-10 | 1 batch=1 lot, best-before computed | unit | `cd api && bun test lot-bestbefore.test.ts` | ❌ Wave 0 |
| CUST-05 | B2B standing reserves before B2C; overflow flag | integration | `cd api && bun test standing-reserve.test.ts` | ❌ Wave 0 |
| SALE-03 | subscription generate idempotent; pause/skip/cancel | integration | `cd api && bun test subscription-gen.test.ts` | ❌ Wave 0 |
| ORD-03 | pack queue grouping by route | integration | `cd api && bun test packing-queue.test.ts` | ❌ Wave 0 |
| ADM-02 | grower/packer role gating (401/403) | integration | `cd api && bun test rbac-roles.test.ts` | ❌ Wave 0 |
| MKT-02 | canned keyword → Flex + deep-link | unit | `cd api && bun test chatbot-router.test.ts` | ❌ Wave 0 |
| D-21 | pdfmake Thai PDF renders buffer | smoke | `cd api && bun test pdf-thai.test.ts` | ❌ Wave 0 (spike) |

### Sampling Rate
- **Per task commit:** targeted `bun test <file> -t <name>`
- **Per wave merge:** full `cd api && bun test`
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `api/tests/forecast.test.ts` — CROP-03 pure compute
- [ ] `api/tests/standing-reserve.test.ts` — CUST-05 reservation ordering + overflow
- [ ] `api/tests/subscription-gen.test.ts` — SALE-03 idempotency (UNIQUE(subscription,round))
- [ ] `api/tests/rbac-roles.test.ts` — ADM-02 grower/packer 401/403
- [ ] `api/tests/pdf-thai.test.ts` — D-21 pdfmake+Bun spike (highest risk)
- [ ] web-admin has no test infra yet — decide if UI gets component tests or relies on API tests + manual UAT

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `POST /auth/staff` Argon2id + timing-equalized (existing) |
| V3 Session Management | yes | jose HS256 2h session (existing `issueSession`/`verifySession`) |
| V4 Access Control | yes | `requireRole()` per-endpoint; grower/packer least-privilege (D-19) — server is authority, not nav-hiding |
| V5 Input Validation | yes | TypeBox per-route schema on every new endpoint (uuid/int-satang) |
| V6 Cryptography | yes | never hand-roll; `Bun.password` + jose only |
| V7 Error/Logging | yes | structured JSON logs; NEVER log LINE token / slip key (PDPA, T-02-29) |
| V13 API | yes | LINE webhook signature (raw-bytes-first) preserved for chatbot |

### Known Threat Patterns for Bun/Elysia + PG + LINE
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection | Tampering | Drizzle parameterized `sql` only (never string concat) |
| Privilege escalation (packer → admin data) | Elevation | `requireRole` allow-list per endpoint; `customer` never in staff guard |
| Broken access control via direct URL | Elevation | server 403 even when nav hidden (D-19 UI-SPEC copy) |
| Oversell via race | Tampering | guarded `reserve()` UPDATE (NFR-02) |
| Duplicate subscription order on retry | — | DB UNIQUE(subscription,round) idempotency |
| Webhook forgery (chatbot) | Spoofing | `validateSignature` over raw bytes; 401 on missing/bad sig |
| B2B price-tier leak to non-approved | Info disclosure | gate `b2b` tier visibility on approved flag (D-08) |
| Secret in settings API (D-22) | Info disclosure | hot values only in settings table; secrets env-only, absent from response |
| PDPA slip/customer exposure | Info disclosure | private bucket + signed URL (existing); never log secrets |

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `api/src/db/schema.ts`, `services/reservation.ts`, `services/order-transition.ts`, `jobs/boss.ts`, `plugins/auth.plugin.ts`, `routes/webhook.ts`, `routes/prices.ts`, `routes/auth.ts`, `services/notify.ts`, `index.ts`, `drizzle/0003_*.sql/.down.sql`, `web/src/api.ts`, `web/package.json`, `api/package.json` — existing seams verified.
- npm registry (`npm view <pkg> version / repository.url / time.modified / scripts.postinstall`) 2026-07-07 — @tanstack/vue-query 5.101.2, @tanstack/vue-table 8.21.3, chart.js 4.5.1, vue-chartjs 5.3.3, pdfmake 0.3.11, papaparse 5.5.4, @unovis/vue 1.6.7.
- 03-CONTEXT.md (D-01..D-25) + 03-UI-SPEC.md (approved) + REQUIREMENTS.md + CLAUDE.md — project design authority.

### Secondary (MEDIUM confidence)
- [pg-boss docs / releases](https://github.com/timgit/pg-boss) — cron `schedule`, retryLimit=2 default, singletonKey semantics.
- [pdfmake custom fonts (server-side/vfs)](https://pdfmake.github.io/docs/0.3/fonts/custom-fonts-client-side/vfs/) + [pumzth/pdfmake-thai](https://github.com/pumzth/pdfmake-thai) — Thai Sarabun embedding.

### Tertiary (LOW confidence)
- Bun ↔ pdfkit runtime compatibility for Thai PDF — ASSUMED from ~98% Node-compat claim; needs Wave-0 spike (A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing libs verified in package.json; new libs verified on npm registry with repos + dates.
- Architecture: HIGH — reservation/transition/pg-boss/RBAC/webhook seams read directly; forecast→quota mapping is additive and does not touch the guard.
- Pitfalls: HIGH for oversell/migration/RBAC (grounded in code + prior CR fixes); MEDIUM for pdfmake-Bun (spike needed).

**Research date:** 2026-07-07
**Valid until:** 2026-08-06 (stable stack; re-verify TanStack/chart.js minor versions at install)

## Sources
- [pumzth/pdfmake-thai](https://github.com/pumzth/pdfmake-thai)
- [pdfmake custom fonts (VFS) 0.3 docs](https://pdfmake.github.io/docs/0.3/fonts/custom-fonts-client-side/vfs/)
- [timgit/pg-boss](https://github.com/timgit/pg-boss)
- [pg-boss v10 release notes (retryLimit default)](https://github.com/timgit/pg-boss/releases/tag/10.0.0)
