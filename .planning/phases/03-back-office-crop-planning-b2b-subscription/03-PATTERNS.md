# Phase 3: Back-office, Crop Planning & B2B/Subscription - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** ~34 (new/modified across `api/` + new `web-admin/`)
**Analogs found:** 30 / 34 (Phases 0–2 are shipped — nearly every backend file has an exact/role analog; `web-admin/` mirrors `web/`)

> ทุกไฟล์ backend มี analog ที่ shipped แล้ว. งานใหม่จริงคือ (1) ตารางใหม่ + migration, (2) forecast pure service, (3) แอป `web-admin/` ทั้งตัว (mirror `web/`). ห้าม hand-roll: reservation ต้องผ่าน `reserve()` เดิม, recurring ต้องผ่าน pg-boss, RBAC ต้องผ่าน `requireRole()`.

---

## File Classification

### Backend (`api/`)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `api/src/db/schema.ts` (MODIFY) | model | CRUD | itself (extend existing pattern) | exact |
| `api/src/services/forecast.ts` | service | transform | `api/src/services/reservation.ts` (pure fns) | role-match |
| `api/src/services/crop.ts` | service | CRUD | `api/src/services/reservation.ts` + `varieties.ts` tx | role-match |
| `api/src/services/subscription.ts` | service | transform | `api/src/services/reservation.ts` (`reserveBox`/`boxAvailability`) | exact |
| `api/src/jobs/boss.ts` (MODIFY) | job/worker | event-driven | itself (`hold-expiry` worker) | exact |
| `api/src/routes/crop.ts` | route | CRUD | `api/src/routes/varieties.ts` | exact |
| `api/src/routes/harvest.ts` | route | CRUD | `api/src/routes/stock.ts` | exact |
| `api/src/routes/subscriptions.ts` | route | CRUD | `api/src/routes/varieties.ts` | role-match |
| `api/src/routes/b2b.ts` | route | CRUD | `api/src/routes/prices.ts` (tier gate) + `varieties.ts` | role-match |
| `api/src/routes/packing.ts` | route | request-response | `api/src/routes/stock.ts` (staff-gated GET) | role-match |
| `api/src/routes/reports.ts` | route | request-response | `api/src/routes/prices.ts` (`/resolve` aggregate GET) | role-match |
| `api/src/routes/dashboard.ts` | route | request-response | `api/src/routes/prices.ts` (`/resolve`) | role-match |
| `api/src/routes/settings.ts` | route | CRUD | `api/src/routes/prices.ts` (upsert) + `config/delivery.ts` | role-match |
| `api/src/routes/webhook.ts` (MODIFY) | route | event-driven | itself (signature check) + `notify.ts` (Flex) | exact |
| `api/src/pdf/pack-slip.ts` | utility | file-I/O | none (RESEARCH Pattern 6) + `notify.ts buildOrderFlex` (doc-tree build) | partial |
| `api/src/pdf/label-slip.ts` | utility | file-I/O | `api/src/pdf/pack-slip.ts` (sibling, once built) | role-match |
| `api/src/env.ts` (MODIFY) | config | config | itself + `config/delivery.ts` | exact |
| `api/src/index.ts` (MODIFY) | config | — | itself (append `.use()` at END) | exact |
| `api/drizzle/0004_*.sql` + `.down.sql` | migration | — | `api/drizzle/0003_*.sql` / `.down.sql` | exact |

### Frontend — NEW `web-admin/` package (mirror `web/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `web-admin/src/api.ts` | provider | request-response | `web/src/api.ts` | exact |
| `web-admin/src/main.ts` | config | — | `web/src/main.ts` | role-match |
| `web-admin/src/router.ts` | route | — | `web/src/router.ts` | role-match |
| `web-admin/src/style.css` | config | — | `web/src/style.css` (`@theme` tokens) | exact |
| `web-admin/src/stores/session.ts` | store | — | `web/src/stores/cart.ts` (module-singleton reactive) | role-match |
| `web-admin/src/composables/useX.ts` | hook | request-response | RESEARCH Code Examples (TanStack Query) + `web/src/api.ts` | partial |
| `web-admin/src/components/DataTable.vue` | component | — | none (headless `@tanstack/vue-table`) | no-analog |
| `web-admin/src/views/*.vue` | component | — | `web/src/views/*.vue` (SFC structure) | role-match |
| `web-admin/package.json` / `vite.config.ts` / `tsconfig.json` | config | — | `web/*` equivalents | exact |

### Tests (Wave 0 — see RESEARCH §Validation)

| New Test | Analog |
|----------|--------|
| `api/tests/forecast.test.ts` | pure-fn unit (like `tests/reservation.test.ts` structure) |
| `api/tests/standing-reserve.test.ts` | `tests/reservation.test.ts` (N-way race + seeded pool) |
| `api/tests/subscription-gen.test.ts` | reservation/idempotency integration |
| `api/tests/rbac-roles.test.ts` | route integration via `app.handle` + injected db |
| `api/tests/pdf-thai.test.ts` | smoke (NEW — highest-risk spike) |

---

## Pattern Assignments

### `api/src/routes/crop.ts` / `harvest.ts` / `subscriptions.ts` (route, CRUD)

**Analog:** `api/src/routes/varieties.ts` (best) + `api/src/routes/stock.ts` (data-only + staff GET)

**The canonical route skeleton — copy verbatim** (`varieties.ts` 18–27, 66–70, 197–198):
```typescript
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { /* new tables */ } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeCropRoutes(database: CatalogDb = defaultDb) {
  const grower = requireRole("owner", "admin", "grower");   // D-19 (RESEARCH Pattern 3)
  return new Elysia()
    .post("/planting-batches", async ({ body, set }) => { /* ... */ set.status = 201; return row; },
      { body: PlantingBatchBody, beforeHandle: grower })
    // ...
}
export const cropRoutes = makeCropRoutes();   // default instance — composed in index.ts
```

**Rules the analogs lock in:**
- **DI factory `makeXRoutes(db = defaultDb)` + exported default instance** — `varieties.ts` 66/197, `prices.ts` 57/182, `stock.ts` 32/66. Every new router MUST follow this so it tests against an injected pool.
- **Per-route `beforeHandle: guard`** — never a global guard. Reads that are staff-only get the guard on the GET (`stock.ts` 57–62); open reads carry none.
- **TypeBox body/params/query const declared above the factory** — `prices.ts` 32–55, `varieties.ts` 29–64. UUIDs = `t.String({ format: "uuid" })`; money = `t.Integer({ minimum: 0 })` (never float).
- **Multi-table create in a `database.transaction`** — `varieties.ts` 110–141 (variety + saleUnits). Reuse for mix-template → batches, subscription + generated order.
- **404 shape `{ error: "x_not_found" }` via `set.status`**, soft-delete via `active=false` not hard delete — `varieties.ts` 177–192.

**RBAC guard aliases (RESEARCH Pattern 3, apply per file):**
```typescript
const grower = requireRole("owner", "admin", "grower"); // crop.ts, harvest.ts
const packer = requireRole("owner", "admin", "packer"); // packing.ts
const staff  = requireRole("owner", "admin");           // b2b.ts, reports.ts, dashboard.ts, settings.ts, subscriptions admin
```
> `"customer"` is NOT in `roleEnum`/`StaffRole` (`api/src/types.ts` 5–13) — NEVER add it to a staff guard (Pitfall 6). `requireRole` returns 401 (missing/invalid token) / 403 (wrong role) — `auth.plugin.ts` 87–109.

---

### `api/src/routes/b2b.ts` (route, CRUD — wholesale tier gate + standing orders)

**Analog:** `api/src/routes/prices.ts` (tier handling) + `varieties.ts` (approval flag patch)

**Tier gate (CUST-02, D-08):** the `prices` table already stores both `b2c`/`b2b` tiers (`schema.ts` 122–158). This phase gates *visibility* on the approved-B2B flag. Reuse the tier `t.Union` literal from `prices.ts` 34–35:
```typescript
tier: t.Union([t.Literal("b2c"), t.Literal("b2b")]),
```

**Approval flag patch** mirrors `varieties.ts` PUT (147–175): build a `Partial<...$inferInsert>` patch, `.update().set(patch).where(eq(...)).returning()`, 404 when no row.

**Standing-order reservation (CUST-05, D-09) — reuse `reserve()` UNCHANGED** (see Shared Patterns → Reservation). Overflow (D-10) inserts a flag row inside the tx; NEVER auto-decides.

---

### `api/src/routes/packing.ts` (route, request-response — pack queue + PDF)

**Analog:** `api/src/routes/stock.ts` (staff-gated GET listing)

**Queue grouping (ORD-03, D-20):** single indexed query over existing `orders.deliveryMethod` / `deliveryZone` snapshot columns (`schema.ts` 231–232), ordered by `(round_id, delivery_zone)`. New nullable `packed_at` column on `orders` = per-order pack state (additive migration). Guard = `packer`.

**PDF download endpoint** returns the buffer from `pack-slip.ts` with `Content-Type: application/pdf`; the guard is `packer`.

---

### `api/src/pdf/pack-slip.ts` / `label-slip.ts` (utility, file-I/O)

**Analog:** none in codebase (first server PDF) — follow RESEARCH Pattern 6 exactly. For the doc-tree *build* style, borrow the nested-object composition from `notify.ts buildOrderFlex` (`notify.ts` 67–119) — same "build a plain nested spec, return it" shape.

**Core pattern (RESEARCH Pattern 6 — `PdfPrinter`, NOT vfs blob):**
```typescript
import PdfPrinter from "pdfmake/src/printer";
const printer = new PdfPrinter({
  Sarabun: { normal: "src/fonts/Sarabun-Regular.ttf", bold: "src/fonts/Sarabun-SemiBold.ttf" },
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
> **Wave-0 spike (Pitfall 3 / A1):** verify pdfmake+pdfkit renders valid Thai (Sarabun) buffer under Bun 1.3 BEFORE building on it. Money in the doc = `baht(satang)` helper style from `notify.ts` 55–60 (`toLocaleString("th-TH")`). Sarabun TTF (Regular + SemiBold) must be added to `api/src/fonts/` (SIL OFL).

---

### `api/src/services/forecast.ts` (service, transform — PURE)

**Analog:** `api/src/services/reservation.ts` (pure, deterministic, heavily-commented, unit-tested)

**Copy the pure-fn discipline** (RESEARCH Pattern 1 — Wave-0 test target):
```typescript
export function projectedHarvestDate(plantDate: Date, daysToHarvest: number): Date { /* +days */ }
export function forecastPlants(plantCount: number, survivalPct: number): number {
  return Math.floor(plantCount * survivalPct / 100); // per-variety haircut D-02; floor = conservative
}
export function bestBefore(harvestDate: Date, shelfLifeDays: number): Date { /* +shelfLife, D-05 */ }
```
The publish step then UPSERTs `round_stock` reusing the existing `round_stock_round_variety_idx` unique index (`schema.ts` 118) — mirror the `onConflictDoUpdate` upsert idiom in `prices.ts` 82–88. Add `is_manual_override` boolean so re-publish skips hand-set rows (Pitfall 5, D-03).

---

### `api/src/services/subscription.ts` (service, transform — box fill)

**Analog:** `api/src/services/reservation.ts` — `reserveBox()` (106–118) + `boxAvailability()` (133–146)

The subscription box borrows the mixed-box BOM model (`boxes`/`boxComponents`, `schema.ts` 182–206). Value-fill (D-12/D-16) is a NEW deterministic pure fn (test target, RESEARCH OQ3); reservation of the filled box goes through the existing `reserveBox()` (all-or-nothing, sorted-lock-order). Substitution notice reuses the Flex path (see Shared → Notify).

---

### `api/src/jobs/boss.ts` (MODIFY — subscription + standing generators)

**Analog:** itself — the shipped `hold-expiry` worker (`boss.ts` 113–133) is the exact template.

**Add a queue + worker alongside hold-expiry** (mirror 118–130):
```typescript
await boss.createQueue("subscription-generate");
await boss.work("subscription-generate", async (jobs) => {
  for (const job of jobs) await generateForRound(db, (job.data as { roundId: string }).roundId);
});
```
- **Worker DB handle:** reuse the lazy `workerDb()` on `DATABASE_URL_DIRECT` (`boss.ts` 29–36) — NEVER the pooled request `db` (Pitfall 4 / T-02-02).
- **Idempotency (Pitfall 2):** a DB `UNIQUE(subscription_id, round_id)` on generated orders makes a pg-boss retry (default retryLimit=2) a safe no-op (23505) — mirror the `payments_trans_ref_idx` partial-unique dedup idiom (`schema.ts` 294–300).
- **Per-item own-transaction loop** so one failure never rolls back the batch — `sweepExpiredHolds` 99–104.
- **Scheduling call site** (from a route, like standing-order creation): `boss.send("queue", data, { singletonKey })` — `orders.ts` 58–61. Generated order then flows the normal payment/hold path (D-15) via `applyTransition`.

---

### `api/src/routes/webhook.ts` (MODIFY — canned chatbot)

**Analog:** itself (signature check must be preserved) + `notify.ts buildOrderFlex` (Flex build)

**Preserve the raw-bytes-first signature check UNCHANGED** (`webhook.ts` 37–47) — attaching a TypeBox body schema would consume the stream and break `validateSignature` on Thai text (Pitfall 1). Extend only the event loop (51–58): route on `event.message.text` keyword OR `event.postback.data` → reply a Flex card built like `buildOrderFlex` (`notify.ts` 67–119), footer button = LIFF deep-link `https://liff.line.me/${LIFF_ID}/...` (`notify.ts` 70). NO NLU, NO in-chat order state (D-25).

---

### `api/src/routes/reports.ts` / `dashboard.ts` (route, request-response — aggregates)

**Analog:** `api/src/routes/prices.ts` `/resolve` (129–177 — computed/derived GET response)

Aggregate SQL server-side (Drizzle `sql` + `groupBy`), staff-gated GET, TypeBox query for period/channel/product/round filters. Return shaped JSON (like `/resolve` builds `packs: units.map(...)`). `web-admin` renders via Chart.js; CSV via papaparse (RESEARCH Pattern 8). Money stays integer satang until display.

---

### `api/src/routes/settings.ts` (route, CRUD — hot config)

**Analog:** `prices.ts` upsert (82–88) + `config/delivery.ts` (TypeBox-validated config shape, 7–40)

Hot values (rounds/prices/delivery-fee/hold-window/haircut/B2B-ceiling, D-22) → a `settings` key/value JSONB table, staff-gated. **Secrets stay in `env.ts` and MUST be absent from the settings API response** (Pitfall 6, Security). `config/delivery.ts` header note (5) already flags this table as the Phase-3 successor.

---

### `api/src/db/schema.ts` (MODIFY) + `api/drizzle/0004_*` (migration)

**Analog:** `schema.ts` itself + `api/drizzle/0003_*.sql` / `.down.sql`

**Schema conventions (schema.ts header 6–12):** `id: uuid().defaultRandom().primaryKey()`, `createdAt: timestamp({ withTimezone: true }).defaultNow().notNull()`, snake_case column ↔ camelCase key, `pgEnum` declared BEFORE tables that use it, money = `integer` satang. New enums: `subscription_status`, `b2b_status`. Extend `varieties` (61–75) with days-to-harvest / survival% / harvest-window / shelf-life (D-01). New tables: `planting_batches`, `planting_mix_templates`, `harvest_logs` (+lots), `subscriptions`, `standing_orders`, `quota_overflow_flags`, `settings`; add B2B flag/credit cols to `customers` (161–168); add `packed_at` to `orders`.

**Reversible down-migration idiom — copy `0003_*.down.sql` verbatim structure** (all 17 lines): drop indexes → drop child tables → drop columns → **pgEnum type LAST**, `IF EXISTS` everywhere (Pitfall 4). drizzle-kit emits no down — hand-write it. Run on `DATABASE_URL_DIRECT`.

---

### `web-admin/` (NEW package — mirror `web/`)

**Analog:** the entire `web/` package.

**`web-admin/src/api.ts` — copy `web/src/api.ts` verbatim** (1–18), just the Eden client:
```typescript
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index"; // compile-time contract, erased at build
export const api = treaty<App>(import.meta.env?.VITE_API_URL ?? "http://localhost:3000");
```

**`main.ts` — mirror `web/src/main.ts` (10–35) + add VueQueryPlugin** (RESEARCH Code Examples):
```typescript
import { VueQueryPlugin } from "@tanstack/vue-query";
createApp(App).use(VueQueryPlugin).use(router).mount("#app");
```
> web-admin is desktop-staff — DROP the LIFF init (`web/main.ts` 17–27). Session comes from `POST /auth/staff` (jose token), stored + sent as `Authorization: Bearer`.

**`router.ts` — mirror `web/src/router.ts` (11–38):** lazy-imported views, `createWebHistory`, catch-all redirect. ADD RBAC nav-gating per route (cosmetic — server `requireRole` is the authority, D-19).

**`stores/session.ts` — mirror `web/src/stores/cart.ts` (13–148):** module-level `reactive` singleton (NO Pinia — NFR-08), `sessionStorage`-mirrored with the `typeof sessionStorage === "undefined"` guard (37–65) so it imports under `bun test`. Holds the staff token/role.

**Composables (`useOrders`, `usePackingQueue`) — RESEARCH Code Examples** wrap Eden calls as TanStack query fns:
```typescript
export const usePackingQueue = (roundId: string) => useQuery({
  queryKey: ["packing", roundId],
  queryFn: async () => { const { data, error } = await api.packing.get({ query: { roundId } }); if (error) throw error; return data; },
});
```

**Views — mirror `web/src/views/*.vue` SFC structure.** `DataTable.vue` has no analog (headless `@tanstack/vue-table`) — you own only markup; the column/sort/paginate model is the library's.

**`style.css`** re-uses `web/`'s `@theme` tokens (Tailwind 4 CSS-first). **CORS:** add the web-admin origin to `env.CORS_ORIGINS` (`index.ts` 37, `env.ts` 27) — else preflight blocks every mutation (Pitfall 6).

---

## Shared Patterns

### Reservation (oversell-safe) — REUSE UNCHANGED
**Source:** `api/src/services/reservation.ts` — `reserve()` (32–47), `release()` (55–70), `reserveBox()` (106–118)
**Apply to:** `b2b.ts` standing orders (D-09), `subscription.ts` (D-13), any B2C order (existing).
```typescript
const ok = await reserve(tx, roundId, varietyId, plants); // guarded UPDATE; false ⇒ sold out
if (!ok) { /* D-10: insert overflow flag inside tx — do NOT auto-decide */ }
```
> Priority ("B2B/subscription before B2C") = **execution order**, NOT a new counter (RESEARCH Pattern 2 / Pitfall 1). NEVER add a `SELECT quota - reserved` pre-check — that reopens the TOCTOU window the guarded UPDATE closes. Crop forecast only WRITES `quota_plants`; all reservation goes through `reserve()`.

### Order transitions — REUSE `applyTransition()`
**Source:** `api/src/services/order-transition.ts` (`applyTransition(tx, orderId, target, { onlyIfHold })`) — used by `boss.ts` 79.
**Apply to:** subscription/standing generated orders (they follow the normal paid/hold-expiry path, D-14/D-15). NEVER ad-hoc `UPDATE status` — one row-locked path keeps the concurrent-cancel fix intact.

### RBAC guard
**Source:** `api/src/plugins/auth.plugin.ts` — `requireRole(...roles)` (87–109); staff login `POST /auth/staff` (`routes/auth.ts` 37–74)
**Apply to:** every new staff/grower/packer endpoint via `beforeHandle`. Server is the authority; `web-admin` nav-hiding is cosmetic. `"customer"` never in a staff guard.

### LINE Flex notify
**Source:** `api/src/services/notify.ts` — `buildOrderFlex()` (67–119), `pushOrderUpdate()` (126–135); registered via `registerOrderNotifier` at boot.
**Apply to:** substitution notice (D-16), chatbot Flex replies (D-25). Guest (no `lineUserId`) skipped silently. NEVER log the LINE token (T-02-29).

### Config validation
**Source:** `api/src/env.ts` (`EnvSchema` TypeBox, boot-fail-fast, 8–82) + `api/src/config/delivery.ts` (7–40)
**Apply to:** new env keys (haircut default, B2B quota ceiling, subscription config) — add to `EnvSchema`; secrets (payee/API keys) stay here, never surfaced in settings API.

### Route composition
**Source:** `api/src/index.ts` (32–65)
**Apply to:** append `.use(cropRoutes)` … at the END of the chain — NEVER reorder existing composition (fixed-order invariant, 3–6). Export `App` type unchanged (65) so Eden stays typed. Add methods to CORS only if a new verb is used.

---

## No Analog Found

| File | Role | Data Flow | Reason (planner → use RESEARCH) |
|------|------|-----------|--------------------------------|
| `api/src/pdf/pack-slip.ts` | utility | file-I/O | First server-side PDF; no prior pdfmake. Use RESEARCH Pattern 6 + Wave-0 spike (A1). Doc-tree build borrows `notify.ts buildOrderFlex` style only. |
| `api/src/fonts/Sarabun-*.ttf` | asset | — | Must download SIL OFL TTF (Regular + SemiBold) into `api/src/fonts/`. |
| `web-admin/src/components/DataTable.vue` | component | — | Headless `@tanstack/vue-table` — no prior data grid. Own markup only. |
| `web-admin/src/composables/*` | hook | request-response | No TanStack Query usage yet in `web/`. Use RESEARCH Code Examples; query fn wraps the Eden client. |

---

## Metadata

**Analog search scope:** `api/src/routes/`, `api/src/services/`, `api/src/jobs/`, `api/src/plugins/`, `api/src/config/`, `api/src/db/`, `api/drizzle/`, `web/src/` (all read directly).
**Files scanned:** ~20 source files read in full or targeted.
**Pattern extraction date:** 2026-07-07
</content>
</invoke>
