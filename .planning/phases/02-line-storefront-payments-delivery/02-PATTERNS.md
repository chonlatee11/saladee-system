# Phase 2: LINE Storefront, Payments & Delivery - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 27 (new + modified)
**Analogs found:** 24 / 27 (3 greenfield surfaces have no in-repo analog)

> Every analog below is a **shipped Phase-0/1 file** (118 tests green). Phase 2 is
> integration wiring around a proven core — new files should copy these exact
> shapes, not invent new ones. All API routes are Elysia + TypeBox + the
> `makeXxxRoutes(db)` DI pattern; all money is integer satang; all migrations are
> up + hand-written down.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `api/src/services/order-transition.ts` (NEW) | service | request-response / state-machine | `api/src/routes/orders.ts` PATCH block (534-583) + `api/src/services/order-status.ts` | exact (extract) |
| `api/src/services/promptpay.ts` (NEW) | service | transform (pure lib wrap) | `api/src/services/pricing.ts` (pure derive) | role-match |
| `api/src/services/delivery.ts` (NEW) | service | transform / compute | `api/src/services/reservation.ts` (pure `boxAvailability`) | role-match |
| `api/src/services/notify.ts` (NEW) | service | event-driven / push | `api/src/routes/webhook.ts` (49-52 `line.client`) | role-match |
| `api/src/services/slip-verify/types.ts` (NEW) | service (interface) | request-response | `api/src/services/order-status.ts` (pure types module) | partial |
| `api/src/services/slip-verify/slipok.adapter.ts` (NEW) | service (adapter) | request-response (external HTTP) | — (first outbound HTTP client) | none |
| `api/src/services/slip-verify/index.ts` (NEW) | service (factory) | config-select | `api/src/env.ts` (env-driven selection) | partial |
| `api/src/jobs/boss.ts` (NEW) | service (worker) | event-driven / batch | `api/src/index.ts` (58-62 `import.meta.main` lifecycle) | partial |
| `api/src/config/delivery.ts` (NEW) | config | transform | `api/src/env.ts` (TypeBox validate-at-boot) | exact |
| `api/src/routes/payments.ts` (NEW) | controller | request-response / file-I/O | `api/src/routes/files.ts` + `orders.ts` PATCH | role-match |
| `api/src/routes/delivery.ts` (NEW) | controller | request-response (read) | `api/src/routes/catalog.ts` (public read) | exact |
| `api/src/routes/me-orders.ts` (NEW) | controller | CRUD / request-response | `api/src/routes/catalog.ts` + `orders.ts` | role-match |
| `api/src/routes/orders.ts` (MODIFY) | controller | request-response | self (QR + hold schedule in POST) | self |
| `api/src/routes/auth.ts` (MODIFY) | controller | request-response | self (73-90 `POST /auth/line` stub) | self |
| `api/src/routes/catalog.ts` (MODIFY) | controller | request-response (read) | self (add care-content fields) | self |
| `api/src/routes/varieties.ts` (MODIFY) | controller | CRUD | self (add `delivery_class` + care fields) | self |
| `api/src/routes/webhook.ts` (MODIFY) | controller | event-driven | self (extend event handling) | self |
| `api/scripts/provision-rich-menu.ts` (NEW) | script | config / provisioning | `api/scripts/r2-smoke.ts` + `line.plugin.ts` | role-match |
| `api/src/env.ts` (MODIFY) | config | — | self (add SLIPOK/PROMPTPAY/HOLD keys) | self |
| `api/src/db/schema.ts` (MODIFY) | model | — | self (new tables + columns) | self |
| `api/drizzle/0003_*.sql` + `.down.sql` (NEW) | migration | — | `0002_prices_default_uniq.sql` (+down) & `0001_commerce.down.sql` | exact |
| `web/src/liff.ts` (NEW) | provider/util | request-response | `web/src/main.ts` (30-35 `initLiff`) | exact |
| `web/src/api.ts` (NEW) | provider (client) | request-response | `web/src/main.ts` (10-23 treaty client) | exact |
| `web/src/router + views/*` (NEW) | component | request-response | — (greenfield Vue SPA; main.ts is scaffold only) | none |
| `web/src/components/*` (NEW) | component | — | — (greenfield SFCs) | none |
| `api/test/*.test.ts` (NEW) | test | — | `web/tests/eden-types.test.ts` + Phase-1 `test/reservation.test.ts` | role-match |
| `bruno/Saladee/**` (extend) | test | — | `bruno/Saladee/orders/create-order.bru` | exact |

---

## Pattern Assignments

### `api/src/services/order-transition.ts` (service — extract-and-share) — HIGHEST PRIORITY

**Analog:** `api/src/routes/orders.ts` PATCH handler (lines 518-602) + `api/src/services/order-status.ts`.
The row-lock + `canTransition` + on-cancel `release()` block is currently **inlined** in the PATCH handler. Extract it into `applyTransition(tx, orderId, next, opts)` so all THREE Phase-2 callers (staff PATCH, slip-verify→paid, expiry job→cancelled) reuse one guarded, TOCTOU-safe path.

**Core pattern to lift verbatim — the row lock + re-read + guarded release** (orders.ts 523-583):
```typescript
const finalStatus = await database.transaction(async (tx) => {
  const [locked] = await tx
    .select({ status: orders.status, roundId: orders.roundId })
    .from(orders)
    .where(eq(orders.id, params.id))
    .for("update")          // ← SELECT … FOR UPDATE: serialises concurrent racers
    .limit(1);
  if (!locked) throw new OrderError("order_not_found", 404);
  const current = locked.status as OrderStatus;
  if (!canTransition(current, next)) throw new OrderError("illegal_transition", 400);

  if (next === "cancelled" && current !== "cancelled") {
    const lines = await tx.select({ lineKind: orderLines.lineKind, varietyId: orderLines.varietyId,
      plants: orderLines.plantsDecremented, qty: orderLines.qty, boxBomJson: orderLines.boxBomJson })
      .from(orderLines).where(eq(orderLines.orderId, params.id));
    for (const l of lines) {
      if (l.lineKind === "box") {
        const bom = l.boxBomJson as { components?: { varietyId: string; plantsPerBox: number }[] } | null;
        for (const c of bom?.components ?? []) await release(tx, locked.roundId, c.varietyId, c.plantsPerBox * l.qty);
      } else if (l.varietyId) {
        await release(tx, locked.roundId, l.varietyId, l.plants);
      }
    }
  }
  await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, params.id));
  return next;
});
```

**Transition table (unchanged — keep the enum intact)** — `order-status.ts` 23-31:
```typescript
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["packing", "cancelled"],   // ← paid→cancelled is LEGAL (staff refund) — see Pitfall 1
  packing: ["shipping", "cancelled"],
  shipping: ["done"],
  done: [], cancelled: [],
};
```

**Phase-2 additions to the extracted function:**
- Add an `opts.onlyIfHold` guard for the expiry job: transition to `cancelled` **only** when `current ∈ {created, awaiting_payment}` (RESEARCH Pitfall 1 — a naive `canTransition` would let a late timer cancel a just-`paid` order and wrongly release sold stock).
- Hook the milestone Flex push (`notify.ts`) after the tx commits, inside the shared function, so every caller emits exactly one notification (RESEARCH Notifications section).
- Keep `OrderError(code, httpStatus)` (orders.ts 42-49) as the throw-to-rollback mechanism.

---

### `api/src/services/promptpay.ts` (service — pure lib wrap)

**Analog:** `api/src/services/pricing.ts` — a pure, side-effect-free service module (`deriveUnitPriceSatang`). PromptPay follows the same "pure function, no DB, exported and unit-tested" shape.

**RESEARCH-provided implementation** (RESEARCH lines 235-246). Money is satang everywhere; convert once at the QR boundary:
```typescript
import generatePayload from "promptpay-qr";
import QRCode from "qrcode";
export function buildPromptPayPayload(payeeId: string, amountBaht: number): string {
  return generatePayload(payeeId, { amount: amountBaht });   // EMVCo string incl. CRC-16
}
export async function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1 });
}
```
- Do NOT hand-roll CRC (RESEARCH Don't Hand-Roll). QR `amount` (baht) = `orderTotalSatang / 100` — Phase-1 whole-baht prices (schema.ts money-is-satang convention) guarantee `X.00`.
- **QR amount = subtotal + delivery fee** (RESEARCH Pitfall 5), not subtotal alone.

---

### `api/src/services/delivery.ts` (service — pure compute)

**Analog:** `api/src/services/reservation.ts` — pure exported helpers with no DB (`boxAvailability` 133-146 does a `min/floor` cart computation; the delivery fee/intersection engine is the same shape). Server-authoritative money math, never trusted from the client (same rule as `reserve()`/pricing).

**RESEARCH-provided engine** (RESEARCH 375-398): `ALLOWED_METHODS[class]` intersection for freshness gating (D-13), `computeDeliveryFee(zone, method, subtotal, cfg)` with free-shipping over `50000` satang for `["self","general"]` only (D-15). Snapshot chosen `delivery_method`/`delivery_zone`/`delivery_fee_satang` onto the order like the Phase-1 price snapshot (orders.ts 458-500).

---

### `api/src/services/notify.ts` (service — LINE push)

**Analog:** `api/src/routes/webhook.ts` (49-52) is the only existing `line.client` call site (`replyMessage`); Phase-2 notify uses the sibling `pushMessage`. The client comes from `linePlugin` (line.plugin.ts 12-20).

**Existing client-call shape to copy** (webhook.ts 48-52):
```typescript
await line.client.replyMessage({
  replyToken: event.replyToken,
  messages: [{ type: "text", text: event.message.text ?? "" }],
});
```
**Phase-2 push** (RESEARCH 351-364): `line.client.pushMessage({ to: lineUserId, messages: [{ type: "flex", altText, contents: {...bubble...} }] })`.
- Target ONLY members with `line_user_id` (D-23) — guests skipped silently.
- Push only on milestones {paid, packing/shipping, done, cancelled} (D-21).
- NEVER log the channel secret/token (line.plugin.ts 4-5, logger.ts 2).
- The service consumes the injected `line` decoration — plumb it in the same way `linePlugin` decorates context (line.plugin.ts 17-20).

---

### `api/src/services/slip-verify/{types.ts, slipok.adapter.ts, index.ts}` (service — adapter seam)

**Analog (types.ts):** `api/src/services/order-status.ts` — a pure types-and-contract module (interface + union result), no DB. Use its "explicit union, no library" style for `SlipVerifyResult`.

**Interface (D-01 seam)** — RESEARCH 204-216 provides `SlipVerifier`, `SlipVerifyInput`, and the `{status: "clean"|"rejected"|"unavailable"}` union verbatim. Call sites depend only on `SlipVerifier`.

**slipok.adapter.ts:** No in-repo analog — this is the **first outbound HTTP client**. Build with `fetch` to `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>`, header `x-authorization: <SLIPOK_API_KEY>` (RESEARCH 181-200). Read secrets ONLY from `env` (env.ts pattern) and NEVER log the key (logger.ts 2, Phase-0 D-15). Map response `transRef`/`amount`/`receiver` → the result union.

**index.ts:** provider selection from `env.SLIP_VERIFY_PROVIDER` — mirror the env-driven-selection discipline in `env.ts` (nothing reads `process.env` by key outside the schema).

---

### `api/src/jobs/boss.ts` (service — background worker, first in codebase)

**Analog (lifecycle only):** `api/src/index.ts` 58-62 — the `import.meta.main` guard that binds the port only as entry point. Start `startJobs()` under the SAME guard so `bun test` importing `app` never spins a worker.

**RESEARCH-provided init/schedule/handler** (RESEARCH 257-292):
```typescript
export const boss = new PgBoss(process.env.DATABASE_URL_DIRECT!);  // DIRECT url — Pitfall 6
export async function startJobs() {
  await boss.start();
  await boss.createQueue("hold-expiry");
  await boss.work("hold-expiry", async ([job]) => {   // v10+ handler receives an ARRAY
    await expireHold(job.data.orderId as string);
  });
}
```
- Schedule at order creation: `boss.send("hold-expiry", { orderId }, { startAfter: HOLD_WINDOW_SECONDS, singletonKey: orderId })` — `singletonKey` makes re-showing the QR idempotent (D-11).
- `expireHold` calls the shared `applyTransition(tx, orderId, "cancelled", { onlyIfHold: true })` inside `db.transaction` (RESEARCH 285-292).
- Point pg-boss at `DATABASE_URL_DIRECT` (already in env.ts line 14), NOT the pooled URL (Pitfall 6). Add a periodic safety-net sweep for the schedule/commit crash window (Pitfall 2).

---

### `api/src/config/delivery.ts` (config — TypeBox validate-at-boot)

**Analog:** `api/src/env.ts` (whole file). Copy the "schema is the single source of truth, validate at load, fail-fast, no `process.env` by key elsewhere" pattern.

**env.ts validate shape to mirror** (env.ts 45-52):
```typescript
export function validateEnv(source: Record<string, unknown>): ValidateEnvResult {
  const candidate = Value.Default(EnvSchema, { ...source }) as Record<string, unknown>;
  if (Value.Check(EnvSchema, candidate)) return { ok: true, errors: [] };
  const errors = [...Value.Errors(EnvSchema, candidate)].map((e) => `${e.path}: ${e.message}`);
  return { ok: false, errors };
}
```
Delivery config is a committed TypeBox-validated file (RESEARCH Open Question 3): `zones[]`, `freeShippingThresholdSatang`, `freeShippingMethods[]` — all satang.

---

### `api/src/routes/payments.ts` (controller — NEW; slip upload + QR)

**Analogs:** `api/src/routes/files.ts` (R2 presign + key-safety guard), `api/src/routes/orders.ts` (PATCH transaction + `OrderError` mapping), `api/src/routes/catalog.ts` (`makeXxxRoutes(db)` DI).

**Route module skeleton (DI + default export)** — copy from orders.ts 141-143 / 606-607:
```typescript
export function makePaymentsRoutes(database: OrdersDb = defaultDb) {
  return new Elysia().post("/orders/:id/slip", async ({ params, body, set }) => { /* … */ },
    { params: t.Object({ id: t.String({ format: "uuid" }) }), body: SlipBody });
}
export const paymentsRoutes = makePaymentsRoutes();
```

**Storage discipline** — files.ts shows presign + `isSafeKey` (files.ts 19-27), but RESEARCH 432 warns: do NOT reuse `/files/presign` for slips (client-chosen key = clobber risk). **Server-assign** the key `slips/${orderId}/${crypto.randomUUID()}.jpg` and store via the `storage` decoration (storage.plugin.ts 41-44 `presignPut`/`presignGet`, 300s TTL). View only via short-lived `presignGet` (D-28).

**Endpoints:** `POST /orders/:id/slip` (compress → private R2 → SlipVerifier → applyTransition on clean, else `awaiting-review`); `GET /orders/:id/qr` idempotent (D-11). Persist `transRef` under a UNIQUE constraint — a unique-violation on insert IS the duplicate rejection (D-06 / Pitfall 3), mapped via `OrderError` like orders.ts 506-512.

---

### `api/src/routes/delivery.ts` (controller — NEW; fee quote read)

**Analog:** `api/src/routes/catalog.ts` — a public (no-guard) read surface that reads server state and returns computed values. `GET /delivery/quote` computes methods+fee for a cart via `services/delivery.ts`; fee is server-authoritative (display-only on the client). Use the same `makeCatalogRoutes(db)` DI + no `requireRole` (public, like catalog D-03).

---

### `api/src/routes/me-orders.ts` (controller — NEW; member history + reorder)

**Analogs:** `api/src/routes/catalog.ts` (read shaping + price re-resolution helpers `resolveTierPrice`/`tierPricePayload`, catalog.ts 56-84) and `api/src/routes/orders.ts` (guarded route + tx).

**Member gating:** guests get neither (D-19). Key on `line_user_id` — reuse the session guard style from `requireRole` (auth.plugin.ts 87-109); for a member session, gate on presence of a customer with `line_user_id`. Reorder re-prices at the currently selected open round using the SAME price-resolution rule already in orders.ts 181-197 / catalog.ts 58-68 (dated-today wins, else NULL default) — flag sold-out/absent items (D-20), do not blind-duplicate the snapshot.

---

### `api/src/routes/orders.ts` (MODIFY — schedule hold + return QR in POST)

**Self analog** — the existing `POST /orders` transaction (orders.ts 360-503) already reserves atomically. Phase-2 additions (RESEARCH 273-281, D-10):
- Set `awaiting_payment` in the same tx (RESEARCH Open Question 2) OR emit `created` then transition — either satisfies D-10.
- After commit, `buildPromptPayPayload` + schedule `boss.send("hold-expiry", …, { singletonKey: orderId })` **in the same flow** (no separate generate-QR step).
- Add delivery method/zone/fee to `CreateOrderBody` (orders.ts 82-90) and snapshot onto the order row (like the existing subtotal snapshot, orders.ts 453).
- Total = subtotal + delivery fee → drives the QR amount (Pitfall 5).

---

### `api/src/routes/auth.ts` (MODIFY — real `POST /auth/line`)

**Self analog** — the stub already exists (auth.ts 72-90) and already calls `auth.verifyLineIdToken(body.idToken)`. Phase-2 replaces the TODO (auth.ts 78-80): upsert `customers` by `line_user_id = payload.sub` (schema.ts 158, `isMember=true`), then `issueSession`. `verifyLineIdToken` is already implemented (auth.plugin.ts 65-72, enforces `iss`/`aud=LINE_LOGIN_CHANNEL_ID`/ES256) — do NOT reimplement (RESEARCH Pitfall 4 covers the aud mismatch).

---

### `api/src/routes/catalog.ts` (MODIFY — care-content on detail)

**Self analog** — add `storage_tips`/`washing_tips` to the variety payload objects (catalog.ts 169-184 and 343-361). Nullable fields, surfaced on the variety detail. Reads stay public (D-03).

---

### `api/src/routes/varieties.ts` (MODIFY — edit delivery_class + care fields)

**Self analog** — extend `CreateVarietyBody`/`UpdateVarietyBody` (varieties.ts 36-52) and the PUT patch-builder (varieties.ts 137-143) with `deliveryClass` (enum) + `storageTips`/`washingTips` (nullable). Staff-gated writes already use `requireRole("owner","admin")` (varieties.ts 57, 132/159/176). The PUT `if (body.x !== undefined) patch.x = body.x` idiom is the exact template for the new nullable columns.

---

### `api/src/routes/webhook.ts` (MODIFY — extend event handling)

**Self analog** — extend the event loop (webhook.ts 46-53). **CRITICAL:** do NOT attach a body schema (webhook.ts 6-7 / RESEARCH anti-pattern) — it would consume the raw bytes and break `validateSignature` (webhook.ts 32-42). Keep the RAW-bytes-first ordering.

---

### `api/scripts/provision-rich-menu.ts` (script — NEW; one-time LINE-01)

**Analogs:** `api/scripts/r2-smoke.ts` / `neon-smoke.ts` (a standalone `bun run` script, not a route) + `api/src/plugins/line.plugin.ts` (how the SDK client is constructed from env, line.plugin.ts 6-14).

**RESEARCH-provided script** (RESEARCH 304-322): `new messagingApi.MessagingApiClient({ channelAccessToken })` + `messagingApi.MessagingApiBlobClient` for the image upload; `createRichMenu` (2500×1686, 5 areas) → `blob.setRichMenuImage` → `client.setDefaultRichMenu`. Make it idempotent: list + delete existing menus by name before creating. Token from `env.LINE_CHANNEL_ACCESS_TOKEN` (env.ts 16), never a literal.

---

### `api/src/env.ts` (MODIFY — new secrets/config keys)

**Self analog** — add to `EnvSchema` (env.ts 8-30): `SLIP_VERIFY_PROVIDER`, `SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY`, `PROMPTPAY_PAYEE_ID`, `HOLD_WINDOW_SECONDS` (RESEARCH 220-227). Same `t.String({ minLength: 1 })` style; fail-fast at boot. `DATABASE_URL_DIRECT` (env.ts 14) already exists for pg-boss.

---

### `api/src/db/schema.ts` (MODIFY — new tables + columns)

**Self analog** — copy the existing table conventions (schema.ts 8-12 header): `uuid defaultRandom pk`, `timestamptz defaultNow notNull createdAt`, snake_case↔camelCase, `pgEnum` declared before use, money as integer satang.

**New tables (RESEARCH 407-416, 529-535):**
- `payments` — with `transRef text UNIQUE` (D-06 system-wide dedup; copy the `uniqueIndex` idiom, schema.ts 39/110/197).
- `consent_logs` — `consentType`, `granted`, `policyVersion`, `source`, `customerId` nullable FK (RESEARCH 408-416).
- `delivery_zones` — only if DB-backed (RESEARCH recommends a config file for MVP; table deferred to Phase 3).

**New columns:**
- `varieties.deliveryClass` (new `pgEnum`, declare before table like schema.ts 42-55) + `storageTips`/`washingTips` (nullable text, like `description` schema.ts 61).
- `orders`: `holdExpiresAt` (timestamptz), `qrPayload` (text), `deliveryMethod`/`deliveryZone`/`deliveryFeeSatang` (snapshot cols alongside `subtotalSatang` schema.ts 216).

---

### `api/drizzle/0003_*.sql` + `.down.sql` (migration — NEW; reversible)

**Analogs:** `0002_prices_default_uniq.sql` (a hand-focused up with a partial UNIQUE index) and `0001_commerce.down.sql` (the reversal ordering template).

**Up:** `CREATE TYPE` for the new enum first, then `CREATE TABLE`/`ALTER TABLE ADD COLUMN`, then the `CREATE UNIQUE INDEX … ON payments (trans_ref)` (mirror 0002 line 15).

**Down (hand-written — drizzle-kit emits none, Pitfall 3):** copy 0001_commerce.down.sql 1-4 header + ordering: drop children before parents, indexes/columns before tables, `pgEnum` types LAST, every statement `IF EXISTS` for idempotency. Note the pg-boss `pgboss` schema is auto-created by `boss.start()` — document it; it is NOT part of these migrations (RESEARCH 535).

---

### `web/src/liff.ts` and `web/src/api.ts` (provider — NEW; LIFF + Eden client)

**Analog:** `web/src/main.ts` — already contains BOTH seams:
- Eden client (main.ts 10-23): `treaty<App>(API_URL)` importing `import type { App } from "../../api/src/index"` — split into `api.ts`.
- Guarded LIFF init (main.ts 30-35):
```typescript
export async function initLiff(): Promise<void> {
  const liffId = import.meta.env?.VITE_LIFF_ID;
  if (!liffId) return;
  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });
}
```
Phase-2 adds `liff.getIDToken()` → `POST /auth/line` (RESEARCH 331-338). `VITE_LIFF_ID` is a new web env var (already referenced in main.ts 31). Keep the `typeof document !== "undefined"` bun-test guard (main.ts 56).

---

### `api/test/*.test.ts` and `bruno/Saladee/**` (tests)

**Analogs:** `web/tests/eden-types.test.ts` (`bun:test` describe/it/expect shape) and the Phase-1 `test/reservation.test.ts` (referenced by RESEARCH as the N-way race proof) for integration tests against an injected/seeded pool. Bruno: copy `bruno/Saladee/orders/create-order.bru` shape (meta/post/body:json/docs/settings blocks) for new payment/slip/delivery/webhook requests. Framework = `bun test` (RESEARCH Validation Architecture); the DI `makeXxxRoutes(db)` on every route (orders.ts 141, catalog.ts 86, auth.ts 34) is what makes route tests possible against a test pool.

---

## Shared Patterns

### Elysia route module DI + default export
**Source:** `api/src/routes/orders.ts` 141-143 & 606-607 (also catalog.ts 86, auth.ts 34, varieties.ts 56).
**Apply to:** ALL new route files (payments, delivery, me-orders).
```typescript
export function makeXxxRoutes(database: XxxDb = defaultDb) {
  return new Elysia().get(/* … */);
}
export const xxxRoutes = makeXxxRoutes();   // index.ts composes this
```
`XxxDb = PostgresJsDatabase<typeof schema>`. index.ts composition order is fixed (index.ts 42-52) — new routes append via `.use(...)`; do not reorder.

### TypeBox per-route schemas → OpenAPI + Eden types
**Source:** `api/src/routes/orders.ts` 51-102, `varieties.ts` 29-54.
**Apply to:** every new endpoint. Never accept server-authoritative fields (price, plants, delivery fee, `transRef`) from the client — resolve them server-side (orders.ts 54-63 comment; the same rule extends to delivery fee + QR amount).

### Transaction + row-lock + `OrderError`-to-HTTP mapping
**Source:** `api/src/routes/orders.ts` 42-49 (`OrderError`), 523-583 (`.for("update")` + guarded release), 506-512 (catch → `set.status`).
**Apply to:** order-transition service, payments route (slip→paid, dedup violation).

### Atomic guarded reserve/release (do not reimplement)
**Source:** `api/src/services/reservation.ts` 32-70. `reserve()`/`release()` signatures stay unchanged; the expiry job and slip flow call the SAME `release()` via `applyTransition`.

### Money = integer satang
**Source:** `api/src/db/schema.ts` 12 + every `*Satang` column. Convert to baht ONLY at the PromptPay QR boundary (`/100`).

### Staff RBAC guard
**Source:** `api/src/plugins/auth.plugin.ts` 87-109 `requireRole(...)` as `beforeHandle` (usage: orders.ts 600, varieties.ts 57).
**Apply to:** admin payment-confirm endpoints (D-04 manual confirm), any staff-gated Phase-2 route. Public reads (catalog, delivery quote) carry NO guard (D-03).

### R2 private bucket + short-TTL signed URL
**Source:** `api/src/plugins/storage.plugin.ts` 41-44 (`presignPut`/`presignGet`, 300s, never public ACL).
**Apply to:** slip storage — but server-assign the key (`slips/{orderId}/…`), do NOT reuse `/files/presign` (RESEARCH 432).

### Secrets discipline / structured logging
**Source:** `api/src/env.ts` (all config via schema, fail-fast) + `api/src/lib/logger.ts` 2 (NEVER log secrets/raw slips). SLIPOK_API_KEY, LINE tokens, payee id — env only, never logged (Phase-0 D-15).

### LINE SDK client construction
**Source:** `api/src/plugins/line.plugin.ts` 12-20 (`messagingApi.MessagingApiClient` from env, decorated as `line`).
**Apply to:** notify service (`pushMessage`), rich-menu script (`MessagingApiClient` + `MessagingApiBlobClient`).

### Reversible migration (up + hand-written down)
**Source:** `api/drizzle/0002_prices_default_uniq.sql` (+`.down.sql`) & `0001_commerce.down.sql` 1-4. Children before parents, `pgEnum` types last, `IF EXISTS` everywhere.

### Eden Treaty typed web client + guarded LIFF
**Source:** `web/src/main.ts` 10-35. `treaty<App>()` from the api `App` type; `initLiff` guarded on `VITE_LIFF_ID`; bootstrap guarded on `typeof document`.

---

## No Analog Found

| File | Role | Data Flow | Reason — use RESEARCH pattern instead |
|------|------|-----------|----------------------------------------|
| `api/src/services/slip-verify/slipok.adapter.ts` | service (adapter) | external HTTP | First outbound HTTP client in the codebase (Phase-0/1 only receive requests). Build with `fetch` per RESEARCH 181-200; follow env/logging discipline from env.ts + logger.ts. |
| `web/src/router + views/*` | component | request-response | `web/` is a greenfield SPA — `main.ts` is a health-check scaffold only, no Vue components/router exist yet. Follow the RESEARCH structure (RESEARCH 495-501) + CLAUDE.md Vue 3.5 + Vite 8 + Tailwind 4; hand-built SFCs (no shadcn). |
| `web/src/components/*` | component | — | Same greenfield reason. UI layout is Claude's discretion (per UI-SPEC). |

---

## Metadata

**Analog search scope:** `api/src/{routes,services,plugins,db,lib}`, `api/drizzle/`, `api/scripts/`, `web/src`, `web/tests`, `bruno/Saladee/`.
**Files scanned:** 20 read in full (orders, order-status, reservation, line/storage/auth plugins, webhook, files, auth, catalog, varieties, schema, env, index, logger, 4 migrations, web main.ts, eden test, bruno create-order) + full source-tree listing.
**Pattern extraction date:** 2026-07-04
