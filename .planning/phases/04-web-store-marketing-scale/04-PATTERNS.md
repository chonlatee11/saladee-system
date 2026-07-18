# Phase 4: Web Store, Marketing & Scale - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 24 backend (new + edit) + 6 web-store (Nuxt) + 6 web-admin surfaces + 1 migration + 39 test edits
**Analogs found:** 22 exact / 24 (every backend capability has a verified codebase analog; only the Nuxt SSR app config has no in-repo analog)

> This map is the concrete, line-anchored companion to `04-RESEARCH.md`. RESEARCH.md
> already lists the file→analog mapping and Patterns 1–6; this file VERIFIES each
> analog against the live code and gives the planner exact line ranges + excerpts to
> copy. Where RESEARCH.md and the code agree, that is noted `[VERIFIED]`.

---

## File Classification

### New backend files

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `api/src/services/coupon.ts` | service | CRUD (guarded UPDATE) | `api/src/services/reservation.ts` `reserve()` | exact |
| `api/src/services/loyalty.ts` | service | event-driven (ledger append) | `api/src/services/order-transition.ts` + `payments.ts` `isUniqueViolation` | exact |
| `api/src/services/broadcast.ts` | service | pub-sub (multicast + consent filter) | `api/src/services/notify.ts` + `reports.ts` `whereFrag` | exact |
| `api/src/services/carrier/index.ts` | service | adapter seam | `api/src/services/slip-verify/index.ts` | exact |
| `api/src/services/carrier/manual.adapter.ts` | service | adapter impl | `api/src/services/slip-verify/slipok.adapter.ts` | exact |
| `api/src/services/carrier/types.ts` | model | interface | `api/src/services/slip-verify/types.ts` | exact |
| `api/src/services/crop-recommend.ts` | service | transform (pure kernel + aggregate) | `api/src/services/forecast.ts` + `reports.ts` | exact |
| `api/src/routes/coupons.ts` | route | CRUD | `api/src/routes/crop.ts` (requireRole CRUD) | exact |
| `api/src/routes/loyalty.ts` | route | request-response | `api/src/routes/reports.ts` (requireRole GET) | exact |
| `api/src/routes/broadcasts.ts` | route | CRUD + job trigger | `api/src/routes/crop.ts` + `boss.send` in `orders.ts`/`subscription` | exact |
| `api/src/routes/tracking.ts` | route | request-response (status PATCH) | `api/src/routes/orders.ts` PATCH status → `applyTransition` | role-match |
| `api/src/routes/product-images.ts` | route | file-I/O | `api/src/routes/payments.ts` (sharp+R2 slip upload) | exact |

### Edited backend files

| Edited File | Role | Data Flow | Edit | Analog (self) |
|-------------|------|-----------|------|---------------|
| `api/src/routes/orders.ts` | route | request-response | accept `couponCode`+`redeemPoints`, apply discount pre-QR | lines 424–476 (this file) |
| `api/src/routes/payments.ts` | route | request-response | `expectedAmountSatang` must subtract discount | line 183 (this file) |
| `api/src/services/order-transition.ts` | service | event-driven | earn loyalty on entering `paid` (in-tx, idempotent) | lines 149–176 (cancel branch) |
| `api/src/routes/webhook.ts` | route | event-driven | bot postback state machine AFTER signature block | lines 126–172 (this file) |
| `api/src/routes/catalog.ts` | route | CRUD | include image gallery in payload | lines 223/329/405 |
| `api/src/services/settings.ts` | service | config | add loyalty + pdpa keys to `HOT_KEYS` | lines 25–30 |
| `api/src/jobs/boss.ts` | job | event-driven | add `broadcast-send` queue+worker | lines 115–162 |
| `api/src/db/schema.ts` | model | — | new tables/cols/`delivery_status` enum | lines 234–341 |

### New migration + tests

| File | Role | Analog | Match |
|------|------|--------|-------|
| `api/drizzle/0005_phase4.sql` (+ `.down.sql`) | migration | `api/drizzle/0004_phase3.sql` | exact |
| 38 self-resetting tests + `tests/migrate.test.ts` | test | see "Shared Pattern: migration registration" | exact |
| `tests/coupon.test.ts`, `coupon-race.test.ts` | test | `tests/reservation.test.ts` (N-way race) | exact |
| `tests/loyalty.test.ts`, `checkout-discount.test.ts` | test | `tests/order-*.test.ts` | exact |
| `tests/broadcast-audience.test.ts`, `webhook-bot.test.ts`, `tracking.test.ts`, `crop-recommend.test.ts` | test | `tests/notify.test.ts` / `forecast*.test.ts` | role-match |

### New Nuxt web-store app (`web-store/`)

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `web-store/composables/useApi.ts` | provider | request-response | `web/src/api.ts` (Eden `treaty<App>()`) | exact |
| `web-store/stores/cart.ts` | store | client state | `web/src/stores/cart.ts` | exact |
| `web-store/pages/index.vue`, `p/[id].vue` | component | request-response (SSR) | `web/src/views/CatalogView.vue`, `VarietyDetailView.vue` | role-match |
| `web-store/pages/checkout.vue` | component | request-response | `web/src/views/CheckoutWizard.vue` + `PayView.vue` + `lib/checkout.ts` | role-match |
| `web-store/components/*` | component | — | reuse `web/src/components/*` (VarietyCard, QtyStepper, SlipUploader…) | exact |
| `web-store/assets/style.css` | config | — | `web/src/style.css` `@theme` block (UI-SPEC binding) | exact |
| `web-store/nuxt.config.ts` | config | — | **no in-repo analog** (new SSR runtime) | none |

### New web-admin surfaces (Vue SFC)

| Component | Reuses / extends | Match |
|-----------|------------------|-------|
| CouponComposer, BroadcastComposer, CarrierTrackingForm | `web-admin/` DataTable + form + selected-tile | role-match |
| LoyaltySettings | Phase-3 `web-admin` settings hot-config form | exact |
| PlantingRecommendationCard | Phase-3 planting-mix template card | exact |
| ProductImageUploader | `web/src/components/SlipUploader.vue` (sharp+R2 upload) | exact |
| DeliveryStatusBadge | existing status-badge component | exact |

---

## Pattern Assignments

### `api/src/services/coupon.ts` (service, guarded UPDATE) — MKT-01

**Analog:** `api/src/services/reservation.ts` `reserve()` (lines 32–47) + `payments.ts` `isUniqueViolation()` (lines 67–79). `[VERIFIED — RESEARCH Pattern 1/2]`

**Core pattern — copy the guarded conditional UPDATE verbatim** (`reservation.ts:38-46`). Global usage-limit enforcement is a DB property, exactly like stock. Zero rows ⇒ exhausted ⇒ reject/rollback:
```ts
const rows = await tx.execute(sql`
  UPDATE round_stock
     SET reserved_plants = reserved_plants + ${plants}
   WHERE round_id = ${roundId}
     AND variety_id = ${varietyId}
     AND quota_plants - reserved_plants >= ${plants}
  RETURNING id
`);
return rows.length === 1;
```
Coupon adaptation: `UPDATE coupons SET global_used = global_used + 1 WHERE code = $1 AND active AND (expires_at IS NULL OR expires_at > now()) AND (global_limit IS NULL OR global_used < global_limit) RETURNING id, discount_kind, discount_value, min_subtotal_satang`.

**Per-customer cap — copy the 23505 arbiter** (`payments.ts:67-79`, walks `.cause` chain 5 deep because Drizzle wraps the PostgresError):
```ts
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
```
Insert into `coupon_redemptions` with `UNIQUE(coupon_id, customer_id)`; on 23505 throw `OrderError("coupon_already_used", 409)`.

**Constraints:** only the parameterized drizzle `sql` template (no string concat, `reservation.ts:12-14`). MUST run INSIDE the `POST /orders` transaction so a shortfall rolls back the reservation. `DbOrTx = Pick<PostgresJsDatabase, "execute">` (`reservation.ts:25`) is the handle type to accept.

---

### `api/src/services/loyalty.ts` + edit `order-transition.ts` (service, ledger) — CUST-03

**Analog:** `api/src/services/order-transition.ts` `applyTransition()` cancel branch (lines 149–176) — the milestone seam that already fires a single guarded action on a status change, in-tx. `[VERIFIED — RESEARCH Pattern 3]`

**Earn seam — add an in-tx branch to `applyTransition`** mirroring the existing `next === "cancelled" && current !== "cancelled"` block (`order-transition.ts:149`):
```ts
// existing pattern at line 149 — copy its shape for `paid`:
if (next === "cancelled" && current !== "cancelled") { /* release() per line */ }
// ADD:
if (next === "paid" && current !== "paid") {
  await earnPoints(tx, orderId);   // INSERT positive loyalty_ledger row, ON CONFLICT DO NOTHING
}
```
Prefer an in-tx ledger insert (durable DB write that must roll back with the transition), NOT the fire-and-forget `notifier` (which is post-commit, lines 183–206). `UNIQUE(order_id) WHERE kind='earn'` makes a re-entered `paid` transition a safe no-op (Pitfall 4 / points double-credit).

**Balance = append-only ledger SUM** (mirrors `consent_logs` append-only trail, `schema.ts:332-341`). Never a mutable balance column.

**Economics from settings** (`settings.ts:25-30`, see Shared Patterns). Rate + points→baht are hot-config, not env, not hardcoded (D-11).

**Guest guard (Pitfall 5):** gate earn/redeem on membership (`customers.isMember` / non-null `lineUserId`, `schema.ts:183,186`); a guest order's throwaway customer row never earns.

---

### `api/src/services/broadcast.ts` + edit `boss.ts` (service, pub-sub) — MKT-03 / LINE-04

**Analog:** `api/src/services/notify.ts` (MessagingApiClient construction + push, lines 205–244) + `reports.ts` `whereFrag()` parameterized aggregate (lines 64–83) + `boss.ts` queue+worker (lines 115–162). `[VERIFIED — RESEARCH Pattern 5]`

**Multicast client — copy the offline client construction** (`notify.ts:231-233`), then chunk ≤500 (Pitfall 7):
```ts
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});
// broadcast: for (const batch of chunk(consented, 500)) await client.multicast({ to: batch, messages });
```
`multicast`/`pushMessage` confirmed present in installed v11 `[VERIFIED — RESEARCH Sources]`.

**Consent filter — latest-row-per-customer (Pitfall 3).** `consent_logs` is append-only with TWO rows per checkout (usage + marketing, `schema.ts:336`), and withdrawal is a NEW append row. Use `DISTINCT ON (customer_id) … ORDER BY customer_id, created_at DESC` filtered to `granted=true` + non-null `line_user_id`. Build the WHERE with parameterized `sql` fragments exactly like `reports.ts:64-83` (never string-concat the segment predicate).

**Scheduled send — copy the `boss.ts` queue+worker idiom** (`boss.ts:121-125`) into `startJobs()`:
```ts
await boss.createQueue("broadcast-send");
await boss.work("broadcast-send", async (jobs) => {
  for (const job of jobs) await runBroadcast(db, (job.data as { broadcastId: string }).broadcastId);
});
// route: send-now → boss.send("broadcast-send", { broadcastId })
//        scheduled → boss.send("broadcast-send", { broadcastId }, { startAfter: secondsUntil })
```
**Critical (Pitfall 6):** the worker MUST use the DIRECT/unpooled db — reuse `boss.ts` `workerDb()` (lines 32–38) on `env.DATABASE_URL_DIRECT`; do NOT spin a new pool.

---

### `api/src/services/carrier/{index,manual.adapter,types}.ts` (service, adapter) — DEL-05

**Analog:** `api/src/services/slip-verify/index.ts` (whole file, 26 lines) + `slipok.adapter.ts` + `types.ts`. `[VERIFIED — RESEARCH Pattern 4]`

**Copy the env-selected switch verbatim** (`slip-verify/index.ts:11-23`):
```ts
export function makeSlipVerifier(provider: string = env.SLIP_VERIFY_PROVIDER): SlipVerifier {
  switch (provider) {
    case "slip2go": return new Slip2GoAdapter();
    case "slipok":  return new SlipOkAdapter();
    default: throw new Error(`unknown SLIP_VERIFY_PROVIDER: ${provider}`);
  }
}
export const slipVerifier: SlipVerifier = makeSlipVerifier();
```
Carrier version: `makeCarrierAdapter(provider = env.CARRIER_PROVIDER)` → `case "manual": return new ManualCarrierAdapter()` with a commented `// case "grab":` seam. Call sites import ONLY the `CarrierAdapter` interface + the env-selected singleton (never a concrete vendor) — the one-line-swap discipline (`slip-verify/index.ts:1-4`).

**Env:** add `CARRIER_PROVIDER` (default `"manual"`) to `env.ts` (Runtime State Inventory).

**Status transition + push — reuse `applyTransition`/notifier seam** (see tracking.ts below).

---

### `api/src/routes/tracking.ts` (route, status PATCH) — DEL-05

**Analog:** `api/src/routes/orders.ts` PATCH status → `order-transition.ts` `applyTransition()` (lines 109–208) + `notify.ts` `pushOrderUpdate` (lines 218–227). `[VERIFIED]`

**Status push — reuse the existing notifier seam** (`notify.ts:218-227`): guest guard is already there (`if (!order.lineUserId) return false`, line 223). Each `delivery_status` transition (D-22) notifies via LINE by pushing a Flex through `line.client.pushMessage({ to: order.lineUserId, messages: [flex] })`. Do NOT build a new push client.

**Delivery status enum** (`delivery_status` pgEnum, D-22 / UI-SPEC binding palette): `pending → handed_to_carrier → in_transit → delivered` (+ `failed`). Declare the pgEnum BEFORE the tables that use it (`schema.ts:11` migration-ordering rule).

**RBAC:** `requireRole("owner","admin")` (see `reports.ts:86`).

---

### `api/src/routes/product-images.ts` (route, file-I/O) — D-26/27/28

**Analog:** `api/src/routes/payments.ts` sharp+R2 slip pipeline (lines 57–97, 190–193). `[VERIFIED — RESEARCH Don't-Hand-Roll]`

**Copy `sharpCompress` + presign PUT** (`payments.ts:58-64`):
```ts
async function sharpCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes))
    .rotate().resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 72 }).toBuffer();
  return new Uint8Array(out);
}
```
Store via `storage.presignPut(key, PRESIGN_TTL)` then `fetch(url, { method: "PUT", body: new Uint8Array(bytes) })` (`payments.ts:85-97`). Bound size BEFORE sharp (`payments.ts:190-193`, `MAX_SLIP_BYTES = 5 * 1024 * 1024`).

**Difference from slip (D-26 discretion):** product photos are PUBLIC marketing assets → use a public R2 path, not the private signed-URL path slips use. Server-assigned key (never client-named). Admin-only RBAC.

**Schema:** new `variety_images` (+ `box_images`) child table; existing `varieties.imageUrl`/`boxes.imageUrl` (`schema.ts:73,211`) becomes the cover image (backward compatible, D-28).

---

### `api/src/services/crop-recommend.ts` + edit `crop.ts` (service, transform) — CROP-07

**Analog:** `api/src/services/forecast.ts` `forecastPlants()` (lines 38–40, PURE kernel) + `reports.ts` `whereFrag` aggregate (lines 64–83) + `back_in_stock_requests` table (`schema.ts:285-296`). `[VERIFIED — RESEARCH Pattern/Code-Example]`

**Inverse of the forecast kernel** — `forecastPlants(200,90)=180` (floor haircut, `forecast.ts:38-40`); the CROP-07 inverse:
```ts
// meet demandPlants sellable given survivalPct → plant this many:
export function plantsToMeetDemand(demandPlants: number, survivalPct: number): number {
  return Math.ceil((demandPlants * 100) / survivalPct);
}
```
Keep it PURE/DB-free like `forecast.ts` (unit-tests trivially, no DB handle).

**Demand aggregate** (D-24): trailing-avg over last N rounds of realized sales (`Σ order_lines.plants_decremented` on `SOLD_STATUSES` orders per variety — see `reports.ts:36`) PLUS `back_in_stock_requests` per variety (`schema.ts:285`). Build with parameterized `sql` (`reports.ts:64-83`), never string concat. Realized statuses = `["paid","packing","shipping","done"]` (`reports.ts:36`).

**Surface (D-25):** on-demand `GET /crop/planting-recommendation` (cheaper than a scheduled job, NFR-08 / A2), prefills the Phase-3 planting-mix template (`crop.ts` `planting_mix_items/templates`, lines 17–19). `requireRole("owner","admin","grower")` like `crop.ts:75`.

---

### Edit `api/src/routes/orders.ts` (route) — discount composition — MKT-01+CUST-03

**Analog:** the same file's checkout block (lines 424–476, transaction lines 488–599). `[VERIFIED — RESEARCH Pattern 6 / Code Example]`

The QR is built from the full total AFTER reserve succeeds (`orders.ts:472-475`):
```ts
totalSatang = subtotalSatang + deliveryFeeSatang;
qrPayload = buildPromptPayPayload(env.PROMPTPAY_PAYEE_ID, totalSatang / 100);
```
**Edit:** after `reserve()` succeeds (line 571) and BEFORE `buildPromptPayPayload`, subtract discounts:
```ts
let discountSatang = 0;
if (body.couponCode)   discountSatang += await redeemCouponGuarded(tx, body.couponCode, customerId, subtotalSatang, tier);
if (body.redeemPoints && isMember) discountSatang += await redeemPointsGuarded(tx, customerId, orderId, body.redeemPoints);
const netSatang = Math.max(0, subtotalSatang + (deliveryFeeSatang ?? 0) - discountSatang);
// invariant (Pitfall 1): netSatang % 100 === 0  — compute discounts in whole baht
qrPayload = buildPromptPayPayload(env.PROMPTPAY_PAYEE_ID, netSatang / 100);
```
**Pitfall 1 (whole-baht QR):** the code relies on "whole-baht prices + whole-baht fees guarantee X.00" (`orders.ts:473-474`). Floor discounts to 100-satang multiples so `netSatang % 100 === 0` still holds. Add `checkout-discount.test.ts` asserting the invariant.

**Anti-pattern (Security Domain):** client sends only `couponCode` (string) + `redeemPoints` (bounded integer) — NEVER a price/discount value. Server resolves the money, exactly as it re-resolves prices today (`cart.ts:2-7` T-02-17 rule).

**Persist net payable:** add a `discountSatang` column on `orders` (see next).

---

### Edit `api/src/routes/payments.ts` (route) — expectedAmount — Pitfall 2 (REQUIRED)

**Analog:** the same file, lines 131 & 183. `[VERIFIED]`
```ts
// line 131 (GET /orders/:id/qr) and line 183 (slip verify) BOTH compute:
const totalSatang         = ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0);      // :131
const expectedAmountSatang = ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0);      // :183
```
`expectedAmountSatang` does NOT currently know about a discount. **REQUIRED edit:** subtract the persisted `discountSatang` (or read a stored final `totalSatang`) in BOTH computations, else a correctly-discounted payment mismatches and parks in `awaiting_review`. Slice test required.

---

### Edit `api/src/routes/webhook.ts` (route) — guided bot — LINE-04

**Analog:** the same file's canned router (lines 126–172). `[VERIFIED — RESEARCH Pattern/Anti-pattern]`

**DO NOT touch the raw-bytes/signature block** (`webhook.ts:142-152`): `request.text()` is read BEFORE any parse; the route has NO TypeBox schema on purpose (attaching one consumes the stream, breaking HMAC on Thai text, lines 4–7). The bot state machine goes strictly AFTER `validateSignature` (line 157 onward).

**Extend `resolveCanned`/postback routing** (lines 126–134) into a quick-reply/postback state machine (D-19); the existing `POSTBACK_TO_KEY` map (lines 53–57) + `buildCannedFlex` LIFF deep-link (lines 86–124) are the shape to extend. The bot gathers intent then deep-links to LIFF to pay (D-20) — reuse `https://liff.line.me/${LIFF_ID}/${path}` (line 88). Bot NEVER handles money.

---

### `web-store/` Nuxt app — ORD-05

**Analog:** `web/src/api.ts` (Eden client, 18 lines) + `web/src/stores/cart.ts` (148 lines) + `web/src/views/*` + `web/src/components/*` + `web/src/style.css` `@theme`. `[VERIFIED — UI-SPEC binding]`

**Eden client — copy `web/src/api.ts:5-11`:**
```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";
export const api = treaty<App>(API_URL);   // compile-time-safe calls to the EXISTING api
```
`useApi.ts` wraps this as a Nuxt composable pointing at `NUXT_PUBLIC_API_URL`.

**Cart store — mirror `web/src/stores/cart.ts` verbatim.** Critical rule (`cart.ts:2-7`): store ONLY `{roundId, varietyId, saleUnitId, qty}` / `{boxId, roundId, qty}` — NEVER price/plants/money. `CartLine`/`CartBoxLine` are the exact `POST /orders` line shapes. Module-level reactive singleton, no Pinia (NFR-08), sessionStorage-mirrored with try/catch guards (`cart.ts:37-65`).

**Checkout reuses existing endpoints (D-02, zero new order/payment API):** `POST /orders` (guest path, `orders.ts` OPEN route) → `GET /orders/:id/qr` → `POST /orders/:id/slip` (all already public, order-UUID only). Reuse `web/src/lib/checkout.ts` + `web/src/components/SlipUploader.vue`.

**Tokens:** copy the `@theme` block from `web/src/style.css` verbatim + `store-max` 1200px desktop constant (UI-SPEC). SSR + `@nuxtjs/seo` for D-06 (JSON-LD/sitemap/OG).

**Anti-pattern (RESEARCH):** NO second reservation path — the web store MUST call the same `POST /orders`.

---

## Shared Patterns

### Migration `0005_phase4` — additive idiom + register in every self-resetting test (Pitfall 4)

**Source:** `api/drizzle/0004_phase3.sql` (whole file) + `tests/migrate.test.ts` (lines 22–30, 70+). `[VERIFIED — 38 test files reference `0004_phase3`]`

Follow the 0004 additive shape exactly: `CREATE TYPE` enums first, `CREATE TABLE` (children), then `ALTER TABLE … ADD COLUMN … DEFAULT` (safe defaults, non-breaking), then FKs, then UNIQUE indexes (`0004_phase3.sql:1,3,95-121`). Never touch `round_stock` reservation columns.

Hand-write `0005_phase4.down.sql` dropping children before parents, enum types LAST (`migrate.test.ts:70,140`).

**Wave-0 task (do FIRST):** register `0005_phase4.sql`/`.down.sql` in the down/up sequence of ALL 38 self-resetting tests + `migrate.test.ts`. The idiom (from `tests/catalog-crud.test.ts:58-65`):
```ts
// teardown: newest DOWN first
await client.file("drizzle/0005_phase4.down.sql").catch(() => {});
await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
// setup: oldest UP first … then
await client.file("drizzle/0004_phase3.sql");
await client.file("drizzle/0005_phase4.sql");
```
The 38 files: auth-boundary, auth-line, b2b-approval, boxes-crud, box-order, box-reservation, cancel-release, catalog-crud, catalog, consent, created-hold-sweep, crop, dashboard, forecast-publish, harvest-log, hold-expiry, hold-idempotent, me-account, member-checkout-linkage, migrate, multi-round-order, notify, order-endpoint-race, order-snapshot, order-transition, packing-queue, prices-resolution, reorder, reports, reservation, round-cutoff, settings, slip-dedup, soldout-notify, staff-login, standing-reserve, subscription-gen, verified-slip-park.

### Settings hot-config (loyalty economics + PDPA policy version)

**Source:** `api/src/services/settings.ts` `HOT_KEYS` allow-list (lines 25–30) + `getHotSettings`/`setHotSettings` (61–95). `[VERIFIED]`

Add loyalty + pdpa keys to the `HOT_KEYS` map (line 25) — this map IS the allow-list (only listed keys read/written; the route's `additionalProperties:false` body rejects anything else). SECURITY (lines 6–14): secrets NEVER pass through settings. Upsert via `onConflictDoUpdate({ target: settings.key, … })` (lines 87–93). `settings` table is `{key text PK, value jsonb, updated_at}` (`0004_phase3.sql:49-53`).

### RBAC on new admin routes

**Source:** `requireRole("owner","admin")` from `plugins/auth.plugin.ts`, used in `reports.ts:86` and `crop.ts:75-79` (grower variant). Every new admin surface (coupons, broadcasts, tracking, product-images, loyalty-settings) gates behind `requireRole` (Security Domain V4).

### Parameterized aggregate (never string concat)

**Source:** `reports.ts` `whereFrag()` (lines 64–83) — build `SQL[]` with `sql\`…\`` fragments, join with `sql.join(c, sql\` and \`)`; Drizzle expands a JS array to a `(…)` tuple so `in` (not `= ANY`) is the valid form (line 65). Both `crop-recommend.ts` and `broadcast.ts` audience queries use this.

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `web-store/nuxt.config.ts` | config | No SSR runtime exists in-repo (`web/` and `web-admin/` are Vite SPAs). Use RESEARCH.md §Recommended Project Structure + `@nuxtjs/seo` module docs. Nuxt is the only genuinely new dependency surface. |

All backend capabilities have a verified in-repo analog — Phase 4 is an extension-and-reuse phase (RESEARCH Summary).

---

## Metadata

**Analog search scope:** `api/src/{services,routes,jobs,db,config,plugins}`, `api/drizzle/`, `api/tests/`, `web/src/{api.ts,stores,views,components,lib,style.css}`.
**Files scanned (read):** reservation.ts, slip-verify/index.ts, order-transition.ts, boss.ts, forecast.ts, settings.ts, webhook.ts, config/delivery.ts, orders.ts (424–599), payments.ts (56–135), reports.ts (1–90), notify.ts (215–244 + grep), catalog.ts (grep), schema.ts (234–341 + grep), 0004_phase3.sql, cart.ts, web/api.ts, crop.ts (grep), tests (grep of 38 self-resetting files + migrate.test.ts).
**Pattern extraction date:** 2026-07-17
```
