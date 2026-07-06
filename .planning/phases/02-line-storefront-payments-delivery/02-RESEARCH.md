# Phase 2: LINE Storefront, Payments & Delivery - Research

**Researched:** 2026-07-04
**Domain:** LINE LIFF commerce, Thai slip verification, self-hosted PromptPay, background jobs (pg-boss), delivery-fee engine, PDPA
**Confidence:** HIGH (vendor + library facts fetched from official docs; integration wiring read from the actual Phase-0/1 code)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Copied verbatim from `02-CONTEXT.md` — research these, do NOT explore alternatives.

**Payments — PromptPay + slip verification**
- **D-01:** Slip-verify provider chosen at research time behind an **adapter interface** so the concrete vendor (EasySlip / SlipOK / Slip2Go) can be swapped without touching call sites. Pick the cheapest that meets free-tier + reliability (NFR-08). Self-OCR stays out of scope.
- **D-02:** Verify matches BOTH payee and amount. Shop's PromptPay payee ID lives in env/config (single static payee); a slip must show a transfer to that payee for the exact order amount to pass.
- **D-03:** Amount must match exactly (to the satang). PromptPay is amount-specified and Phase-1 unit prices round to whole baht, so over/under = reject → admin review.
- **D-04:** Admin manual-confirm is always available as a fallback. If verify API is down / quota-exhausted / non-clean, order sits in `awaiting-review` and an admin can confirm by hand.
- **D-05:** Clean verify → auto-mark `paid`. Payee + exact amount + not-duplicate → order transitions to `paid` automatically and customer is notified; admin queue only holds failed/ambiguous cases.
- **D-06:** Duplicate slips blocked system-wide by persisting the bank transaction ref under a unique constraint across all orders.
- **D-07:** PromptPay QR generated backend-side (`promptpay-qr`/`promptparse` + `qrcode`), amount-specified, correct CRC — zero gateway fee.

**Hold-expiry & stock release**
- **D-08:** Hold window configurable (default 30 min), in config/settings. pg-boss delayed job.
- **D-09:** On expiry → cancel the order + release stock (guarded `reserved → available` in the SAME transaction, reusing Phase-1 cancel/release path — the only transition that releases stock).
- **D-10:** Hold timer starts at order creation. `POST /orders` already reserves atomically; QR is built and the pg-boss expiry job scheduled in the same flow.
- **D-11:** Re-showing the QR is idempotent and does NOT extend the hold. A GET returns the same QR any number of times; no regenerate-to-reset-timer path.

**Delivery — zones, fees, restrictions**
- **D-12:** Zones are named entries in config, priced per (zone × method) as a flat rate. Admin edits config — no carrier rate API. Province/postal granularity deferred.
- **D-13:** Freshness gating via a `delivery-class` field on each variety (very-fresh → self/cold only; normal → any). A mixed box uses the strictest class among its components. Drives DEL-03 method blocking at checkout.
- **D-14:** Delivery date derived from the round's `deliveryDate` (already on Phase-1 `rounds`). Customer chooses method + address; date follows the round — no free-form date picker.
- **D-15:** Free shipping over 500฿ applies only to self-delivery + general carrier. On-demand couriers (Grab/Lalamove) charged per trip regardless of order value.

**LIFF storefront, Rich Menu & login**
- **D-16:** Checkout is a multi-step wizard (varieties/packs → round+method+address → summary+slip), mobile-first, per-step error surfacing.
- **D-17:** LINE Login default; guest checkout allowed. Inside LIFF obtain `idToken`, verify server-side (jose), populate `customers.line_user_id`. Guest may order but forgoes history/reorder/push.
- **D-18:** Rich Menu ships 5 buttons: สั่งผักรอบนี้ (open LIFF), ราคาวันนี้ (catalog/prices), ติดตามออเดอร์ (order history+status), ติดต่อร้าน, ความรู้เรื่องผัก/วิธีเก็บรักษา. สมาชิก/แต้ม deferred to Phase 4.

**Order history & reorder**
- **D-19:** History + reorder are member-only (require LINE Login / `line_user_id`). Guests get neither.
- **D-20:** Reorder pre-fills the cart with same varieties/units, re-prices at the currently selected open round; items now sold-out/absent are flagged so the customer confirms before paying.

**Notifications**
- **D-21:** Push only on key milestones — paid, packing/shipping, done, and cancelled/hold-expired. Not every transition.
- **D-22:** Notifications are Flex-message cards (order summary + deep-link into the LIFF order page), not plain text.
- **D-23:** Push targets members with `line_user_id` only. Guests without login receive no push.

**Product content**
- **D-24:** Short care-content fields per variety (`storage_tips`, `washing_tips` — nullable), editable via existing catalog CRUD, shown on the LIFF variety detail. Rich Menu content button links to a LIFF content list. Full content hub deferred to Phase 4.

**PDPA & data protection**
- **D-25:** Consent captured at checkout, before personal data is collected (name/address/phone). Consent + policy version logged with a timestamp. Not gated at first LIFF open.
- **D-26:** Marketing consent is a separate, default-unchecked checkbox at checkout (explicit opt-in), logged separately — feeds Phase-4 broadcast.
- **D-27:** Data access/deletion requests handled manually by admin for MVP (documented in the privacy policy). Self-serve deletion deferred.
- **D-28:** Slips compressed then stored in a private R2 bucket, reachable only via short-lived signed URLs. Compress with Bun.Image (native, or sharp) reusing the Phase-0 `storage.plugin`.

### Claude's Discretion
- Concrete slip-verify vendor (behind D-01 adapter), PromptPay QR library choice, and exact TypeBox request/response schemas.
- Flex-message card layout/copy (D-22), the exact milestone→message mapping (D-21).
- Table/column layout and migration structure (up + hand-written down per Phase-0 D-12/13) for new payment/slip/consent/delivery/content columns; directory layout within `api/src` and `web/src`.
- Config surface/shape for hold window (D-08), zones×methods (D-12), and payee ID.
- Reorder edge-case UX details beyond the D-20 shape.

### Deferred Ideas (OUT OF SCOPE — ignore)
- สมาชิก/แต้ม (loyalty/points) Rich Menu button + program — Phase 4.
- Full vegetable content/education hub — Phase 4.
- Conversational/NLU chatbot + segmented broadcast — Phase 4 (explicitly out of scope).
- Self-serve PDPA data export/deletion in LIFF — admin-manual for MVP.
- Province/postal-code delivery zones + carrier rate/tracking API — Phase 4.
- Invoice PDF generation — off Phase-1 data when needed; not a Phase-2 criterion.
- B2B/subscriptions/packing queue/dashboards/reports/crop auto-feed — Phase 3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-04 | PDPA consent + marketing consent + data rights + log | `consent_logs` table + separate marketing opt-in (D-25/26); slips in private R2 + signed URLs; privacy-policy discloses third-party slip processor. See PDPA section. |
| ORD-01 | LINE → single backend | LIFF calls the existing `POST /orders` (Phase-1 D-02 seam) via Eden Treaty. No new order engine. |
| ORD-04 | Auto LINE status notify | Flex push on milestone transitions via `line.client.pushMessage` (D-21/22). See Notifications. |
| PAY-01 | Amount-specified PromptPay QR, backend-generated | `promptpay-qr` `generatePayload(payeeId, { amount })` + `qrcode` render, server-side. See PromptPay section. |
| PAY-02 | Slip upload + slip-verify API, dup/forged/wrong-amount rejected, admin confirm | **SlipOK** behind the D-01 adapter; `transRef` unique for dedup; `amount` param + branch-linked account for payee/amount; admin fallback (D-04). |
| PAY-03 | QR hold-expiry → release reserved stock | pg-boss delayed job → guarded `release()` in the Phase-1 cancel path. See pg-boss section. |
| DEL-01..04 | 4 methods, fee by zone/method, freshness restriction, delivery round/date | Config-driven zone×method flat-rate engine + `varieties.delivery_class`; date from round. See Delivery section. |
| CUST-04 | Order history + reorder | Member-only endpoints keyed on `line_user_id`; reorder re-prices at current round (D-19/20). |
| LINE-01 | Rich Menu | `@line/bot-sdk` v11 create/upload/setDefault via a one-time provisioning script. |
| LINE-02 | LIFF ordering page | `@line/liff` 2.29.0 init + Vue SPA in `web/`; server-side idToken verify (Phase-0 `verifyLineIdToken`). |
| LINE-03 | Messaging API webhook + status notify | Extend existing signature-validated `webhook.ts`; push via `line.client`. |
</phase_requirements>

## Summary

Phase 2 is almost entirely **integration wiring around a proven core**, not new invention. The oversell-safe order engine (`reserve`/`release`, the guarded conditional UPDATE, the box all-or-nothing path, the row-locked status transition), the LINE client, the R2 storage plugin, `jose` sessions AND a working `verifyLineIdToken(idToken)`, and boot-time TypeBox env validation **already exist and are battle-tested** (Phase 1 shipped with 118 passing tests including the concurrent-cancel oversell fix). The real Phase-2 work is: (1) pick and wrap a slip-verify vendor, (2) generate PromptPay QR, (3) introduce pg-boss for hold-expiry, (4) build the LIFF Vue app + Rich Menu + Flex push, (5) add a config-driven delivery-fee engine, and (6) add PDPA consent logging + private slip storage.

**The single highest-value research output — the slip-verify vendor — resolves to SlipOK.** It is the only candidate with a genuine *recurring* free monthly quota (100 slips/month, resets monthly, 2 shops), the cheapest entry paid tier (500 slips / ฿210/mo), the clearest public docs, and it returns everything the locked decisions need: `transRef` (D-06 dedup), an `amount` compare parameter (D-03), and per-branch **linked-account verification** via `log:true` that binds a slip to the shop's own receiving account (D-02). EasySlip is the strong runner-up (cleaner explicit `isAmountMatched`/`matchedAccount`, but only a one-time free trial and ฿99 minimum), so it is the natural second adapter implementation behind the D-01 interface.

The most important architectural caution: three different code paths now transition an order and possibly release stock — the staff `PATCH /orders/:id/status`, the customer slip-verify flow, and the pg-boss expiry job. Phase 1 inlined the row-lock + `canTransition` + release logic inside the PATCH handler. **Extract that into one shared `applyTransition()` service** so all three reuse the exact same guarded, TOCTOU-safe path, and make the expiry job cancel **only** an order still in the unpaid hold state (never a paid one).

**Primary recommendation:** Adopt **SlipOK** behind a `SlipVerifier` adapter; generate QR with `promptpay-qr` + `qrcode`; pin **pg-boss 12.23.0** (CLAUDE.md-blessed) for a per-order delayed expiry job backed by a periodic safety-net sweep; extract a shared `applyTransition()` from the Phase-1 PATCH handler; keep the Phase-1 order-status enum intact and track slip/`awaiting-review` state on a new `payments` table.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Browse round / catalog | LIFF (Vue SPA) | API `GET /catalog` | Read surface already exists (Phase-1 catalog.ts); LIFF only renders. |
| LINE Login / idToken exchange | API (jose, `verifyLineIdToken`) | LIFF (`liff.getIDToken()`) | idToken MUST be verified server-side (never trust the client); Phase-0 helper already does ES256+JWKS. |
| Checkout / place order | API `POST /orders` (tx) | LIFF wizard | Atomic reservation is a DB property — belongs in the transaction, never the client. |
| PromptPay QR generation | API (backend) | — | D-07 / NFR-08: generate server-side, zero gateway. Payee ID is a secret-ish config, never shipped to client except as the rendered QR. |
| Slip verification | API → SlipOK adapter | External vendor | Third-party processor; API orchestrates, enforces payee/amount/dedup, never OCRs. |
| Hold-expiry / stock release | API + pg-boss worker (same DB) | — | Must run inside a DB tx reusing `release()`; an always-on VPS worker (no serverless). |
| Delivery fee compute | API (config engine) | LIFF (display only) | Money math is server-authoritative; LIFF shows the computed fee but never sets it. |
| Status notifications | API (Messaging push) | LINE client renders Flex | Push targets `line_user_id`; Flex JSON built server-side. |
| Slip image storage | API + R2 (private) | Bun.Image/sharp compress | Private bucket + short-TTL signed URL (PLAT-03/04); never public. |
| PDPA consent capture | LIFF checkbox → API log | `consent_logs` table | Consent recorded server-side with policy version + timestamp. |

## Standard Stack

All core libraries are **LOCKED by CLAUDE.md** — do not re-litigate. Versions below verified against the npm registry on 2026-07-04.

### Already installed (reuse — do NOT reinstall)
| Library | Version (in repo) | Purpose in Phase 2 |
|---------|-------------------|--------------------|
| `elysia` | 1.4.29 | All new endpoints (TypeBox schemas → OpenAPI + Eden types). |
| `@line/bot-sdk` | 11.0.2 | Push (Flex notify), Rich Menu API, webhook signature (already wired). |
| `@line/liff` | 2.29.0 (web) | LIFF init, LINE Login, `getIDToken()`. |
| `jose` | 6.2.3 | Session issue/verify + `verifyLineIdToken` (ALREADY implemented in auth.plugin.ts). |
| `drizzle-orm` | 0.45.2 | New tables/columns + migrations (drizzle-kit 0.31.10). |
| `postgres` | 3.4.9 | Driver (also the connection pg-boss points at). |
| `vue` / `vite` / `tailwindcss` | 3.5.39 / 8.1.0 / 4.3.1 | LIFF SPA in `web/` (currently only `web/src/main.ts` exists — the app is greenfield). |
| `@elysiajs/eden` | 1.4.9 | Typed LIFF → API client (`web/tests/eden-types.test.ts` proves it). |

### New — to install this phase
| Library | Version to pin | Purpose | Why Standard |
|---------|---------------|---------|--------------|
| `promptpay-qr` | 0.5.0 | EMVCo amount-specified payload + CRC-16 | CLAUDE.md-blessed; `generatePayload(id, {amount})`; used by dtinth (well-known). `[VERIFIED: npm registry]` |
| `qrcode` | 1.5.4 | Render payload → PNG/dataURL/SVG server-side | 15.6M weekly downloads; renders the payload string. `[VERIFIED: npm registry]` |
| `pg-boss` | **12.23.0** (blessed pin, NOT latest 12.25.1) | Postgres-backed delayed job for hold-expiry | CLAUDE.md-blessed; reuses the same PG, `SKIP LOCKED`. See Legitimacy Audit re: pin. `[VERIFIED: npm registry]` |
| `sharp` | 0.35.2 (blessed) / 0.35.3 (latest) | Compress slip images before R2 | Battle-tested; recommended default over Bun.Image (unverified API). `[VERIFIED: npm registry]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `promptpay-qr` + `qrcode` | `promptparse` 1.6.0 | promptparse is TS-native and can also *parse* slip QR payloads (useful if you later want to read the slip QR yourself before sending to the vendor). Adopt if you want one lib for gen+parse. For MVP the two-lib combo is simpler and blessed. |
| `sharp` | `Bun.Image` (native) | CLAUDE.md suggests Bun.Image to drop a dependency, but the public API is unconfirmed for 1.3.14 — treat as `[ASSUMED]`. Use `sharp` as the verified default; swap to Bun.Image only after confirming the API exists. |
| SlipOK | EasySlip | See vendor comparison — EasySlip is the second adapter (cleaner amount-match, no recurring free tier). |

**Installation:**
```bash
# api workspace
cd api && bun add promptpay-qr@0.5.0 qrcode@1.5.4 pg-boss@12.23.0 sharp@0.35.2
bun add -d @types/qrcode
# web workspace already has @line/liff, vue, vite, tailwind — no new deps unless icons:
cd ../web && bun add lucide-vue-next   # per UI-SPEC icon choice
```

## Slip-Verify Vendor Decision (D-01) — SlipOK

> The single most valuable research output. Recommendation is **SlipOK**, behind a swappable `SlipVerifier` adapter (D-01). EasySlip is the documented fallback adapter.

### Comparison

| Factor | **SlipOK (recommend)** | EasySlip | Slip2Go |
|--------|------------------------|----------|---------|
| Recurring free tier | **100 slips/month, resets monthly, 2 shops** `[CITED: slipok.com/price-and-service]` | Free *trial* only, no monthly quota `[CITED: easyslip.com/api-products]` | 100 slips one-time trial `[CITED: slip2go.com]` |
| Cheapest paid | OK START 500/mo = **฿210** | Start 250/mo = ฿99 | Not published |
| Endpoint | `POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>` | `POST https://api.easyslip.com/v2/verify/bank` | Undocumented publicly |
| Auth header | `x-authorization: <API_KEY>` | `Authorization: Bearer <API_KEY>` | — |
| Slip input | `data` (QR string) / `files` (image) / `url` | payload / image / base64 / url | image/QR (unconfirmed) |
| Returns transRef (D-06) | **Yes — `transRef`** | Yes — `transRef` | Yes (claimed) |
| Amount match (D-03) | `amount` param compared server-side | `matchAmount` → `isAmountMatched`, `amountInSlip`/`amountInOrder` | Claimed |
| Payee match (D-02) | **`log:true` verifies against the branch's linked receiving account** | `matchedAccount` (bank + account name/number) | Claimed |
| Duplicate detection | Built-in with `log:true` (per-merchant) | Built-in | Claimed |
| Third-party SDK | `slipok-sdk` (community TS) exists | `n8n-nodes-easyslip` (official) | — |
| Docs quality | **Clear, public, field-by-field** | Public but v2 detail behind sub-pages | Homepage only |

**Verdict:** SlipOK wins on NFR-08 (only recurring free quota; the shop launches free and pays ฿210/mo only once it exceeds 100 slips/month) and on documentation clarity. It returns `transRef`, accepts an `amount` compare, and binds verification to the shop's own receiving account via the branch API key + `log:true` — covering D-02/D-03/D-06 at the vendor level.

### SlipOK request/response (concrete) `[CITED: slipok.com/api-documentation/check-slip]`
```
POST https://api.slipok.com/api/line/apikey/<BRANCH_ID>
Headers: { "x-authorization": "<SLIPOK_API_KEY>" }
Body (multipart or json — one of):
  data:  "<QR string from slip lower-right>"    // if the LIFF reads the QR
  files: <image JPG/JPEG/PNG/JFIF/WEBP>          // simplest: send the slip image
  url:   "<image url>"                            // e.g. an R2 signed GET URL
Optional: amount: <number>   // server-side compare → mismatch flagged
          log: true          // enables linked-account check + duplicate detection + dashboard log
```
Success response fields (the ones the adapter maps):
```
success, message,
transRef,                       // → persist under UNIQUE constraint (D-06)
transDate (yyyyMMdd), transTime (HH:mm:ss), transTimestamp (ISO8601),
amount (decimal),               // → compare to order total to the satang (D-03)
sender  { name, proxy, account (masked) },
receiver{ name, proxy, account (masked) },   // → payee (D-02); relies on branch link
receivingBank (3), sendingBank (3),
ref1, ref2, ref3
```

### Adapter interface (D-01)
```typescript
// api/src/services/slip-verify/types.ts — the swappable seam
export interface SlipVerifyInput {
  image?: Uint8Array;        // slip bytes (compressed) — SlipOK `files`
  qrPayload?: string;        // or the QR string — SlipOK `data`
  expectedAmountSatang: number;
}
export type SlipVerifyResult =
  | { status: "clean"; transRef: string; amountSatang: number; payeeOk: true; raw: unknown }
  | { status: "rejected"; reason: "wrong_amount" | "wrong_payee" | "duplicate" | "not_a_slip"; raw: unknown }
  | { status: "unavailable"; raw?: unknown };   // API down / quota → D-04 awaiting-review
export interface SlipVerifier { verify(input: SlipVerifyInput): Promise<SlipVerifyResult>; }
// api/src/services/slip-verify/slipok.adapter.ts implements SlipVerifier.
```
Call sites depend only on `SlipVerifier`; a `EasySlipAdapter` can be dropped in later.

### New env/config keys for the adapter
```
SLIP_VERIFY_PROVIDER = "slipok"            # selects the adapter
SLIPOK_BRANCH_ID     = "<branch id>"       # path segment
SLIPOK_API_KEY       = "<secret>"          # x-authorization header — NEVER logged (Phase-0 D-15)
PROMPTPAY_PAYEE_ID   = "<phone or natid>"  # the QR payee (D-02 reference)
HOLD_WINDOW_SECONDS  = "1800"              # 30 min default (D-08)
```
Add these to the boot-time `EnvSchema` (api/src/env.ts) so the app refuses to start without them (Phase-0 D-10 pattern).

### Amount/payee correctness note (D-02/D-03)
- Order total (subtotal + delivery fee) is **whole-baht satang** everywhere (Phase-1 D-13 rounds unit prices up to whole baht; delivery fees are flat whole-baht). QR `amount` (baht) = `totalSatang / 100`, always `X.00`. The `amount` compare with SlipOK is therefore exact.
- **Enforce dedup in OUR DB, not only the vendor.** SlipOK's duplicate detection is per-merchant/branch; the locked D-06 requirement is *system-wide*. Persist `transRef` under a UNIQUE constraint on our `payments` table — a unique-violation on insert IS the duplicate rejection. Do not rely solely on the vendor.

## PromptPay QR Generation (PAY-01 / D-07)

```typescript
// api/src/services/promptpay.ts
import generatePayload from "promptpay-qr";       // [CITED: github.com/dtinth/promptpay-qr]
import QRCode from "qrcode";

/** payeeId: phone "0812345678" or national id "1234567890123" (e-wallet id also supported). */
export function buildPromptPayPayload(payeeId: string, amountBaht: number): string {
  return generatePayload(payeeId, { amount: amountBaht });   // EMVCo string incl. correct CRC-16
}
export async function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1 });
}
```
- `generatePayload` returns the EMVCo merchant-presented payload with the CRC already appended — do **not** hand-roll CRC (see Don't Hand-Roll).
- Render server-side to a dataURL (or PNG buffer) and return it in the order/payment response; the LIFF `<img>` shows it. Payee ID is never sent to the client except embedded in the QR.
- Payee ID format: 10-digit phone or 13-digit national ID (the library normalizes dashes). Choose based on the shop's registered PromptPay ID. Store as `PROMPTPAY_PAYEE_ID`.

## pg-boss Hold-Expiry Integration (PAY-03 / D-08/09/10/11)

> First background worker in the codebase — the seam Phase-3 standing-order/subscription generation reuses.

### Init & lifecycle (always-on VPS — no serverless)
```typescript
// api/src/jobs/boss.ts
import PgBoss from "pg-boss";                        // [CITED: timgit.github.io/pg-boss]
export const boss = new PgBoss(process.env.DATABASE_URL_DIRECT!);  // see pitfall below
export async function startJobs() {
  await boss.start();                                // creates its own `pgboss` schema/tables
  await boss.createQueue("hold-expiry");
  await boss.work("hold-expiry", async ([job]) => {  // v10+ handler receives an ARRAY
    await expireHold(job.data.orderId as string);
  });
}
// graceful shutdown: await boss.stop();
```
- Start `startJobs()` from `index.ts` only when `import.meta.main` (the same guard that calls `app.listen`) so tests importing `app` do not spin up a worker.
- pg-boss creates a dedicated `pgboss` schema in the same database — no extra infra (NFR-08).

### Schedule at order creation (D-10) — idempotent (D-11)
```typescript
await boss.send(
  "hold-expiry",
  { orderId },
  { startAfter: HOLD_WINDOW_SECONDS, singletonKey: orderId }  // singletonKey dedups re-scheduling
);
```
- `singletonKey: orderId` makes re-issuing the schedule a no-op — re-showing the QR (D-11) never adds a second timer or extends the hold.

### The handler — release ONLY an unpaid hold (critical, D-09)
```typescript
async function expireHold(orderId: string) {
  await db.transaction(async (tx) => {
    // reuse the SHARED applyTransition() extracted from the PATCH handler:
    // it row-locks the order (FOR UPDATE), reads authoritative status, and only
    // transitions awaiting_payment/created → cancelled (releasing stock in the SAME tx).
    await applyTransition(tx, orderId, "cancelled", { onlyIfHold: true });
  });
}
```
- **The expiry job MUST NOT cancel a paid order.** `TRANSITIONS` allows `paid → cancelled` (a legitimate staff refund path), so a naive `canTransition` check would let a late-firing timer cancel a just-paid order and wrongly release its (now sold) stock. Gate the job on `current ∈ {created, awaiting_payment}` — the unpaid hold states only. Once paid/packing/etc., the job is a safe no-op.
- Because the row is locked and the state re-read inside the tx, the job is naturally idempotent and race-safe (same pattern as the Phase-1 concurrent-cancel fix).

### Slip-under-review vs expiry interaction (D-04 ↔ D-09)
- When a customer uploads a slip that enters `awaiting-review` (D-04), **deschedule or neutralize the expiry** so the hold does not cancel an order a human is about to confirm. Options: (a) `boss.cancel` the singleton job on slip upload, or (b) have `expireHold` skip orders that have a pending slip in review. Recommend (b) — simpler and self-consistent: the job checks for a `payments` row in `awaiting_review`/`verifying` and no-ops if present.

## LINE Rich Menu (LINE-01 / D-18)

One-time **provisioning script**, not a runtime route. Use `@line/bot-sdk` v11.
```typescript
// api/scripts/provision-rich-menu.ts  (run: bun run api/scripts/provision-rich-menu.ts)
import { messagingApi } from "@line/bot-sdk";
const client = new messagingApi.MessagingApiClient({ channelAccessToken: TOKEN });
const blob   = new messagingApi.MessagingApiBlobClient({ channelAccessToken: TOKEN }); // image upload
// 1) create the menu (2500x1686 full-size, 3+2 grid for 5 buttons)
const { richMenuId } = await client.createRichMenu({
  size: { width: 2500, height: 1686 }, selected: true, name: "saladee-main", chatBarText: "เมนูร้าน",
  areas: [
    { bounds: {x:0,y:0,width:833,height:843},    action: { type:"uri", uri:"https://liff.line.me/<LIFF_ID>" } },        // สั่งผักรอบนี้
    { bounds: {x:833,y:0,width:834,height:843},  action: { type:"uri", uri:"https://liff.line.me/<LIFF_ID>/prices" } }, // ราคาวันนี้
    { bounds: {x:1667,y:0,width:833,height:843}, action: { type:"uri", uri:"https://liff.line.me/<LIFF_ID>/orders" } }, // ติดตามออเดอร์
    { bounds: {x:0,y:843,width:1250,height:843}, action: { type:"uri", uri:"https://liff.line.me/<LIFF_ID>/contact" } },// ติดต่อร้าน
    { bounds: {x:1250,y:843,width:1250,height:843}, action: { type:"uri", uri:"https://liff.line.me/<LIFF_ID>/care" } },// ความรู้เรื่องผัก
  ],
});
// 2) upload the 2500x1686 PNG/JPEG, 3) set as default
await blob.setRichMenuImage(richMenuId, imageBlob, "image/png");
await client.setDefaultRichMenu(richMenuId);
```
- Image spec: full menu **2500×1686** (or 2500×843 half). Areas are pixel bounds mapped to actions. `uri` actions deep-link into LIFF routes.
- Rich Menu image is a design artifact (per UI-SPEC, its pixel layout is Claude's discretion) — the script consumes a PNG produced separately.
- Idempotency for the script: list + delete existing menus by name before creating, so re-running is safe.

## LIFF Init + Server-Side idToken Verify (LINE-02 / D-17)

**Server side already exists** — `verifyLineIdToken(idToken)` in `api/src/plugins/auth.plugin.ts` verifies ES256 against LINE's remote JWKS with `iss=https://access.line.me` and `aud=LINE_LOGIN_CHANNEL_ID`. Phase 2 only adds a thin login route + client wiring.

```typescript
// web/src/liff.ts
import liff from "@line/liff";
await liff.init({ liffId: import.meta.env.VITE_LIFF_ID });   // new web env var
if (liff.isLoggedIn()) {
  const idToken = liff.getIDToken();                         // send to API
  // POST /auth/line { idToken } → server verifies → upsert customer by line_user_id → session
} // else guest checkout path (no idToken) — order still allowed (D-17), no history/push
```
```typescript
// api/src/routes/auth.ts (extend): POST /auth/line
const payload = await verifyLineIdToken(body.idToken);       // throws on forged/expired
const lineUserId = payload.sub as string;                    // LINE user id
// upsert customers row (isMember=true, lineUserId), issue jose session (issueSession)
```
- Guest path: no idToken; `POST /orders` accepts a `GuestCustomer` block already (name/phone/recipient…). Members pass `customerId` after login.
- New web env: `VITE_LIFF_ID` (the LIFF app id from the LINE console). `LINE_LOGIN_CHANNEL_ID` (the idToken `aud`) is already in the API env.

## LINE Flex Notifications (ORD-04 / D-21/22/23)

```typescript
// api/src/services/notify.ts — push only on milestones {paid, packing/shipping, done, cancelled}
await line.client.pushMessage({
  to: lineUserId,                       // ONLY members with line_user_id (D-23)
  messages: [{
    type: "flex",
    altText: "อัปเดตคำสั่งซื้อ #" + shortId,
    contents: { type: "bubble", body: { /* order summary block */ },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary",
          action: { type: "uri", label: "ดูคำสั่งซื้อ",
                    uri: "https://liff.line.me/<LIFF_ID>/orders/" + orderId } } ] } },
  }],
});
```
- Trigger point: hook the milestone push inside the shared `applyTransition()` so every path (staff PATCH, slip-verify, expiry job) emits the right notification once, on commit. Map: `paid`→paid card, `packing`/`shipping`→shipping card, `done`→done card, `cancelled`→cancelled/hold-expired card (D-21).
- Guests (no `line_user_id`) are skipped silently (D-23). Push consumes LINE quota — only milestones (D-21), never every transition.
- Deep link `https://liff.line.me/<LIFF_ID>/orders/{orderId}` opens the order page inside LINE.

## Delivery Fee Engine (DEL-01..04 / D-12/13/14/15)

Pure, server-authoritative, config-driven. No carrier API (deferred).

### Methods (DEL-01) and delivery classes (D-13)
```typescript
type DeliveryMethod = "self" | "cold" | "on_demand" | "general";  // ส่งเอง / ขนส่งเย็น / Grab-Lalamove / ขนส่งทั่วไป
// new column: varieties.delivery_class enum ("very_fresh" | "normal")
const ALLOWED_METHODS: Record<DeliveryClass, DeliveryMethod[]> = {
  very_fresh: ["self", "cold"],           // fresh forces self/cold only (DEL-03)
  normal:     ["self", "cold", "on_demand", "general"],
};
```
- **Strictest-in-mixed-box (D-13):** the cart's allowed set = intersection of `ALLOWED_METHODS[class]` across every variety (and every box component). A box uses the strictest class among its components. Block methods not in the intersection at checkout (UI-SPEC "method disabled-by-freshness").

### Zone × method flat-rate config (D-12) + free-shipping (D-15)
```typescript
// api/src/config/delivery.ts — TypeBox-validated at boot (like env), admin edits the file for MVP
interface DeliveryConfig {
  zones: { id: string; nameTh: string; fees: Partial<Record<DeliveryMethod, number>> }[]; // satang
  freeShippingThresholdSatang: number;   // 50000 (= ฿500)
  freeShippingMethods: DeliveryMethod[]; // ["self","general"]  (D-15)
}
function computeDeliveryFee(zoneId, method, subtotalSatang, cfg): number {
  const base = cfg.zones.find(z => z.id===zoneId)?.fees[method];
  if (base == null) throw new Error("method_not_available_in_zone");
  if (subtotalSatang >= cfg.freeShippingThresholdSatang && cfg.freeShippingMethods.includes(method)) return 0;
  return base;   // on_demand/cold never free even over ฿500 (D-15)
}
```
- Date (D-14): read `rounds.deliveryDate` (already on the Phase-1 table) — no date picker. Show it read-only at checkout.
- **Snapshot** the chosen `delivery_method`, `delivery_zone`, and `delivery_fee_satang` onto the order (new columns), like the Phase-1 price snapshot, so the order total is reconstructable and the QR amount is stable.
- Config shape is Claude's discretion (D-12). A committed TypeBox-validated config file is the lowest-cost MVP choice (admin-editable via git/redeploy); a DB-backed editable table is deferrable to the Phase-3 admin UI.

## PDPA Consent + Slip Storage (PLAT-04 / D-25/26/28)

### Consent logging (D-25/26)
```sql
-- new table
consent_logs(
  id uuid pk, customer_id uuid null references customers(id),
  consent_type text not null,          -- 'usage' | 'marketing'
  granted boolean not null,
  policy_version text not null,
  source text,                          -- 'checkout'
  created_at timestamptz not null default now()
)
```
- Usage consent (required, D-25) captured at checkout **before** name/address/phone are submitted — the wizard gates step 2→3 on the usage checkbox (UI-SPEC "consent-ungated → CTA disabled").
- Marketing consent (D-26) is a **separate, default-unchecked** row (`consent_type='marketing'`), logged independently — feeds Phase-4 broadcast.
- Log the policy version + timestamp per PLAT-04. Data access/deletion is admin-manual for MVP (D-27) — document in the privacy policy; no self-serve endpoint.

### Slip storage (D-28) — reuse the Phase-0 storage plugin
```typescript
// 1) compress (sharp default; Bun.Image optional if API confirmed)
const compressed = await sharp(rawBytes).rotate().resize({ width: 1080, withoutEnlargement: true })
                    .jpeg({ quality: 72 }).toBuffer();
// 2) store under a private key (storage.plugin uses a PRIVATE R2 bucket, no public ACL)
const key = `slips/${orderId}/${crypto.randomUUID()}.jpg`;  // PUT via storage.presignPut or server-side put
// 3) verify: send `compressed` to SlipOK adapter (files) OR pass storage.presignGet(key) as `url`
// 4) view: only ever storage.presignGet(key, 300)  — short-lived signed URL (PLAT-03/04)
```
- **Do not reuse the generic `POST /files/presign` for slips** — that mints a client-controlled key. Slip keys must be server-assigned (`slips/{orderId}/…`) and the slip flow controlled by a dedicated endpoint so a customer cannot overwrite another order's slip.
- PDPA disclosure: the privacy policy must state that slip images are processed by a third-party verifier (SlipOK) — the slip leaves the system boundary during verification.

## Architecture Patterns

### System Architecture Diagram
```
                 ┌──────────────── LINE App (customer) ────────────────┐
                 │  Rich Menu (5 btns)      LIFF WebView (Vue SPA)      │
                 └───────┬───────────────────────┬─────────────────────┘
                         │ uri actions            │ Eden Treaty (typed HTTPS)
                         ▼                        ▼
                   deep-link into        ┌─────────────────────────────┐
                   LIFF routes           │      Elysia API (Bun, VPS)  │
                                         │                             │
  LINE Messaging  ──webhook (signed)──▶  │  /webhook  (Phase-0)        │
  push (Flex) ◀────────────────────────  │  /auth/line → verifyIdToken │──▶ LINE JWKS (ES256)
                                         │  GET /catalog (Phase-1)     │
     customer checkout ───────────────▶  │  POST /orders (Phase-1 tx)  │
                                         │    ├─ reserve() atomic       │──▶ ┌────────────┐
                                         │    ├─ buildPromptPay QR      │    │ PostgreSQL │
                                         │    └─ boss.send(hold-expiry) │◀──▶│  (Neon)    │
     upload slip ─────────────────────▶  │  POST /orders/:id/slip      │    │  + pgboss  │
                                         │    ├─ sharp compress → R2    │──▶ │  schema    │
                                         │    ├─ SlipVerifier.verify()  │    └────────────┘
                                         │    │      │                  │          ▲
                                         │    │      ▼ (payee+amount+dup)│          │
                                         │    └─ applyTransition(paid)  │          │
                                         │  PATCH /orders/:id/status    │          │
                                         │    (staff, shared transition) │          │
                                         │                             │          │
                                         │  pg-boss worker: hold-expiry │──────────┘
                                         │    → applyTransition(cancel) → release()│
                                         └───────┬─────────────┬────────┘
                                                 │             │
                                    SlipVerifier adapter   R2 (private, signed URL)
                                                 │
                                                 ▼
                                          SlipOK API (external)
```

### Recommended Project Structure
```
api/src/
├── config/delivery.ts          # zone×method fee config (TypeBox-validated)
├── jobs/boss.ts                # pg-boss init + hold-expiry worker
├── services/
│   ├── promptpay.ts            # generatePayload + qrcode render
│   ├── order-transition.ts     # SHARED applyTransition() (extracted from orders.ts)
│   ├── notify.ts               # Flex push on milestones
│   ├── delivery.ts             # allowed-methods + computeDeliveryFee
│   └── slip-verify/
│       ├── types.ts            # SlipVerifier interface + result types (D-01 seam)
│       ├── slipok.adapter.ts   # concrete vendor
│       └── index.ts            # provider selection from env
├── routes/
│   ├── orders.ts               # extend: schedule hold, return QR, awaiting_payment
│   ├── payments.ts             # NEW: POST /orders/:id/slip, GET /orders/:id/qr (idempotent)
│   ├── delivery.ts             # NEW: GET /delivery/quote (methods+fee for a cart)
│   ├── me-orders.ts            # NEW: member order history + reorder (CUST-04)
│   └── auth.ts                 # extend: POST /auth/line
└── scripts/provision-rich-menu.ts   # one-time LINE-01

web/src/                        # currently only main.ts — build the LIFF SPA here
├── liff.ts                     # liff.init + getIDToken
├── api.ts                      # Eden Treaty client
├── style.css                   # Tailwind v4 @theme tokens (per UI-SPEC)
├── router + views/             # catalog, variety detail, 3-step wizard, pay, history
└── components/                 # hand-built SFCs (no shadcn — Vue)
```

### Pattern: one shared, row-locked status transition
**What:** Extract the Phase-1 PATCH handler's `SELECT … FOR UPDATE` + `canTransition` + on-cancel `release()` block into `applyTransition(tx, orderId, next, opts)`.
**When to use:** every state change — staff PATCH, slip-verify→paid, expiry→cancelled.
**Why:** The Phase-1 ship-review found a concurrent-cancel oversell BLOCKER fixed by the row lock. Three new callers must not each re-implement (and re-break) that guard. One function = one correct path.

### Anti-Patterns to Avoid
- **Blindly cancelling on expiry.** `paid → cancelled` is a legal transition; the timer must gate on unpaid-hold states only (see pg-boss section).
- **Trusting the client for price/amount/fee.** All money is server-resolved (Phase-1 already never trusts client price; delivery fee and QR amount follow the same rule).
- **Reusing `/files/presign` for slips.** Client-chosen keys let a customer clobber another order's slip. Server-assign slip keys.
- **Relying only on the vendor's duplicate check.** D-06 is system-wide; enforce a UNIQUE `transRef` in our DB.
- **Attaching a body schema to `/webhook`.** Would consume raw bytes and break signature validation (Phase-0 Pitfall 1 — already handled; keep it that way when extending event handling).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PromptPay EMVCo payload + CRC-16 | Custom TLV/CRC encoder | `promptpay-qr` `generatePayload` | Subtle EMVCo tag ordering + CRC-16/CCITT; a wrong byte = a QR no bank app accepts. |
| QR image render | Canvas/bit-matrix code | `qrcode` | Reed-Solomon ECC + masking; 15M downloads. |
| Slip authenticity / bank verification | OCR/ML on the slip | SlipOK adapter | Explicitly out-of-scope (REQUIREMENTS + D-01); vendors verify against the bank, we cannot. |
| Delayed job / timer | `setTimeout` in-process | pg-boss `startAfter` | setTimeout dies on restart → stranded reserved stock (oversell). PG-backed survives restarts + `SKIP LOCKED`. |
| LINE idToken verification | Manual JWT decode | `verifyLineIdToken` (jose+JWKS) | Already implemented; ES256 + remote JWKS rotation + iss/aud enforcement. |
| Webhook signature | Manual HMAC | `@line/bot-sdk` `validateSignature` | Already wired over raw bytes (Phase-0). |
| Image compression | Manual resize | `sharp` (or Bun.Image) | EXIF orientation, quality, memory safety. |

**Key insight:** Every "primitive" here (QR bytes, JWT verify, timers, HMAC) has a sharp edge that silently produces a *plausible-but-wrong* result — a QR that scans-but-fails, a timer that forgets after deploy, a signature that passes on ASCII but fails on Thai text. The proven libraries and the existing Phase-0/1 helpers already handle these; net-new code should orchestrate, not re-implement.

## Runtime State Inventory

> Phase 2 is additive (new tables/columns/endpoints/app), not a rename/refactor. This inventory covers new external/runtime state introduced.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New DB tables/columns: `payments` (transRef UNIQUE), `consent_logs`, order delivery snapshot cols, order `hold_expires_at`/`qr_payload`, `varieties.delivery_class` + `storage_tips`/`washing_tips`. pg-boss creates its own `pgboss` schema. | Reversible migrations (up + hand-written down, Phase-0 D-12/13). pg-boss schema is auto-created by `boss.start()`; document it and include in the down migration considerations. |
| Live service config | LINE console: Rich Menu (provisioned via script), LIFF app endpoint URL (must point at the deployed web origin), Messaging webhook URL (Phase-0 noted "not set yet" — must be set to the prod domain). SlipOK dashboard: a **branch** with the shop's receiving bank account linked. | Run provision script once; set LIFF endpoint + webhook URL in LINE console; create SlipOK branch + link account. These live in vendor UIs, NOT git. |
| OS-registered state | pg-boss worker must run in the always-on API process on the VPS (systemd unit already runs `bun … index.ts`). No separate scheduler. | Ensure `startJobs()` runs in the prod process; graceful `boss.stop()` on shutdown. |
| Secrets/env vars | New: `SLIPOK_API_KEY`, `SLIPOK_BRANCH_ID`, `PROMPTPAY_PAYEE_ID`, `HOLD_WINDOW_SECONDS`, `VITE_LIFF_ID` (web). | Add to `EnvSchema` (api) + `.env.example` + GitHub Actions Secrets + web build env. Never log secrets (Phase-0 D-15). |
| Build artifacts | New `web/` SPA build (Vite → Cloudflare Pages, already wired in CI). New api deps in `bun.lockb`. | `bun install`; CI already deploys web to Pages and api to the droplet. |

## Common Pitfalls

### Pitfall 1: Expiry timer cancels a paid order
**What goes wrong:** `paid → cancelled` is legal; a late hold-expiry job cancels a just-paid order and releases sold stock.
**Why:** Gating only on `canTransition`, not on the actual unpaid-hold state.
**How to avoid:** In `expireHold`, transition only when locked status ∈ {created, awaiting_payment}; otherwise no-op. Also skip if a slip is in `awaiting_review`.
**Warning signs:** Paid orders flipping to cancelled; reserved counts drifting after promos.

### Pitfall 2: Schedule/commit crash window strands stock
**What goes wrong:** Order commits but the process dies before `boss.send` runs → no timer → reserved stock never releases.
**Why:** The delayed job is enqueued after the order transaction commits (pg-boss `send` uses its own pool, not your tx).
**How to avoid:** Add a periodic **safety-net sweep** (`boss.schedule("hold-sweep", "*/2 * * * *")` or a cron queue) that cancels any `awaiting_payment` order past `hold_expires_at`. Store `hold_expires_at` on the order so the sweep is authoritative and self-healing. The per-order delayed job stays the primary (honors D-08 "pg-boss delayed job"); the sweep guarantees no stranded stock.
**Warning signs:** Orders stuck in `awaiting_payment` with reserved stock long after 30 min.

### Pitfall 3: Duplicate slip only caught per-merchant
**What goes wrong:** The same slip pays two different orders because you trusted the vendor's dedup.
**Why:** SlipOK dedup is per-branch; D-06 requires system-wide.
**How to avoid:** UNIQUE constraint on `payments.trans_ref`; a unique-violation on insert = duplicate → reject (map to the D-06 error copy).
**Warning signs:** Two orders sharing a transRef.

### Pitfall 4: LIFF idToken audience mismatch
**What goes wrong:** `verifyLineIdToken` throws for real users.
**Why:** The LIFF app's linked Login channel must equal `LINE_LOGIN_CHANNEL_ID` (the `aud`). A LIFF created under a different channel fails verification.
**How to avoid:** Confirm the LIFF app is under the same Login channel whose id is in env; the Phase-0 helper enforces `aud` strictly.
**Warning signs:** All logins 401 while the token looks valid.

### Pitfall 5: Slip amount vs total mismatch from delivery fee
**What goes wrong:** QR amount = subtotal only, but the customer must also pay delivery → slip amount ≠ QR → wrongly rejected (or under-collected).
**Why:** Computing the QR before adding the delivery fee.
**How to avoid:** QR amount = `subtotalSatang + deliveryFeeSatang` (the order total), snapshotted on the order; verify against that.
**Warning signs:** Every delivery-charged order flagged wrong_amount.

### Pitfall 6: pg-boss connection to a pooled endpoint
**What goes wrong:** pg-boss maintenance/locks behave oddly through a transaction pooler.
**Why:** Neon's pooled URL (PgBouncer transaction mode) doesn't hold session state pg-boss expects.
**How to avoid:** Point pg-boss at the **direct** connection (`DATABASE_URL_DIRECT`, already in env for migrations), not the `-pooler` URL.
**Warning signs:** Prepared-statement/advisory-lock errors from the pgboss schema.

## Code Examples

See the inline blocks above — all are the concrete Phase-2 patterns:
- PromptPay: `buildPromptPayPayload` + `renderQrDataUrl` (PromptPay section) `[CITED: github.com/dtinth/promptpay-qr]`
- pg-boss: init/send/work + `expireHold` guard (pg-boss section) `[CITED: timgit.github.io/pg-boss]`
- SlipOK request/response + adapter interface (vendor section) `[CITED: slipok.com/api-documentation/check-slip]`
- Rich Menu provisioning (LINE-01 section) `[CITED: @line/bot-sdk v11 messagingApi]`
- LIFF init + `POST /auth/line` (LINE-02 section)
- Flex push (Notifications section)
- Delivery fee + freshness intersection (Delivery section)
- Slip compress → private R2 (PDPA section)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pg-boss `subscribe()` / handler gets one job | `work(name, handler)` where handler receives an **array** of jobs | pg-boss v10+ | Destructure `async ([job]) =>`; the CLAUDE.md examples predate this — use the array form. |
| `new PgBoss(...)` default export | Named/interop; `boss.createQueue(name)` required before `send`/`work` | pg-boss v10+ | Must `createQueue` explicitly at startup. |
| LINE bot-sdk v7 `Client` | v11 `messagingApi.MessagingApiClient` + `MessagingApiBlobClient` for images | v11 (in repo) | Rich Menu image upload uses the Blob client, not the main client. |

**Deprecated/outdated:**
- Self-OCR slip reading — explicitly out of scope (REQUIREMENTS + D-01); use a vendor.
- Payment gateways (Stripe/Omise/2C2P) for PromptPay — banned by CLAUDE.md "What NOT to Use" (fees + KYC); generate QR ourselves.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Bun.Image` native API is usable in Bun 1.3.14 to compress slips | Standard Stack / PDPA | Low — mitigated by recommending `sharp` (verified) as the default; Bun.Image is optional. |
| A2 | SlipOK's masked `receiver` + `log:true` linked-account check is sufficient to enforce D-02 (payee) without a full account number | Vendor | Medium — if masking prevents strict payee match, rely on the branch-linked-account guarantee (slip must be paid into the registered account) + amount + transRef. Confirm during a short spike with a real slip. |
| A3 | SlipOK free tier (100/mo) and paid ฿210/500 pricing current as of 2026-07 | Vendor | Low-Medium — pricing is volatile; reverify at signup. Free tier existence is the load-bearing fact and is well-documented. |
| A4 | Setting order to `awaiting_payment` at `POST /orders` (vs Phase-1 `created`) is acceptable | pg-boss / orders | Low — Phase-2 owns the checkout flow; the planner should confirm whether POST sets awaiting_payment directly or via a follow-on transition. Either satisfies D-10. |
| A5 | `promptpay-qr` default-exports `generatePayload` (last published 2022) | PromptPay | Low — stable, widely used; confirm import shape (`import generatePayload from "promptpay-qr"`) at install. If ESM/CJS interop bites under Bun, `promptparse` is the blessed fallback. |

## Open Questions (RESOLVED)

1. **SlipOK receiver-field masking vs strict payee match (D-02).**
   - What we know: SlipOK returns `receiver` (masked) and, with `log:true`, verifies against the branch's linked receiving account.
   - What's unclear: whether the masked fields alone allow a code-level payee assertion, or whether we lean entirely on the branch-account binding.
   - Recommendation: a 30-minute spike with the free tier + one real slip during Wave 0; if masking blocks it, treat the branch-linked-account as the payee guarantee (still satisfies D-02) and assert amount + transRef in code.
   - RESOLVED: SlipOK payee-masking verification is deferred to a Wave-0 spike (one real slip through the free tier). PAY-02 is fully covered regardless of the spike outcome by the D-04 admin manual-confirm fallback plus the D-02 branch-linked-account guarantee (slip must be paid into the registered receiving account) asserted alongside amount + transRef. See 02-06 (slip adapter + admin confirm) and 02-VALIDATION.md Manual-Only Verifications.

2. **Order status at checkout: `created` vs `awaiting_payment`.**
   - What we know: D-10 wants QR + hold scheduled in the same flow as `POST /orders`.
   - What's unclear: whether to set `awaiting_payment` inside POST or emit `created` then transition.
   - Recommendation: set `awaiting_payment` in the same transaction and schedule the hold; simplest and matches the pay screen states.
   - RESOLVED: The order is set to `awaiting_payment` directly inside the `POST /orders` transaction (same flow that snapshots delivery + builds the QR + schedules the hold). Implemented in 02-04 Task 2.

3. **Delivery config: file vs DB table.**
   - What we know: D-12 says "config, admin edits" but the admin UI is Phase 3.
   - Recommendation: committed TypeBox-validated config file for MVP (edit via git/redeploy); migrate to a DB table when the Phase-3 admin UI lands. No data migration needed later (config → seed rows).
   - RESOLVED: Delivery zones use a committed TypeBox-validated config file (`api/src/config/delivery.ts`, validated at boot), edited via git/redeploy for MVP; migrate to a DB table when the Phase-3 admin UI lands (config → seed rows, no data migration). Implemented in 02-03.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | api + web build | ✓ | 1.3.14 | — |
| Node | tooling | ✓ | 24.10.0 | — |
| PostgreSQL (Neon prod / Docker dev) | orders, pg-boss schema | ✓ (Phase-0 live) | 17 | — |
| Cloudflare R2 (private bucket) | slip storage | ✓ (Phase-0 `saladee-uploads`) | — | — |
| LINE Messaging channel | webhook, push, Rich Menu | ✓ (secret+token in env) | — | — |
| LINE Login channel + LIFF app | idToken verify, LIFF | ⚠ Login channel exists; **LIFF app id not yet created** | — | None — must create LIFF app in console (blocks LINE-02) |
| SlipOK account + branch + linked bank account | PAY-02 slip verify | ✗ not provisioned | — | Admin manual-confirm (D-04) works without it, but auto-verify (D-05) needs it |
| Deployed web origin as LIFF endpoint + webhook URL | LIFF load, webhook | ⚠ web on Pages; LIFF endpoint + webhook URL not set | — | Set in LINE console before UAT |

**Missing dependencies with no fallback:**
- LIFF app id (`VITE_LIFF_ID`) — must be created in the LINE Developers console; blocks the LIFF surface (LINE-02) and Rich Menu deep links.

**Missing dependencies with fallback:**
- SlipOK provisioning — auto-verify (D-05) degrades to admin manual-confirm (D-04) until the branch + linked account exist. Plan a `checkpoint:human-verify` for account signup.

## Validation Architecture

> nyquist_validation is enabled (config.workflow.nyquist_validation = true). Test framework = Bun test (Phase-1 uses `cd api && bun test`, 118 tests passing).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (built-in) |
| Config file | none — `.env.test` at repo root + `api/` (Phase-0 pattern) |
| Quick run command | `cd api && bun test <file>` |
| Full suite command | `cd api && bun test` (+ `cd web && bun test` for Eden types) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAY-01 | PromptPay payload has correct CRC-16 for a known payee+amount (golden vector) | unit | `cd api && bun test test/promptpay.test.ts` | ❌ Wave 0 |
| PAY-02 | Slip adapter maps SlipOK response → clean/rejected; wrong_amount/wrong_payee/duplicate branches (mock HTTP) | unit | `cd api && bun test test/slip-verify.test.ts` | ❌ Wave 0 |
| PAY-02 | transRef UNIQUE rejects a second order using the same slip | integration | `cd api && bun test test/slip-dedup.test.ts` | ❌ Wave 0 |
| PAY-03 | Hold expiry cancels an `awaiting_payment` order and releases exactly the reserved plants; NO-OP on a `paid` order | integration | `cd api && bun test test/hold-expiry.test.ts` | ❌ Wave 0 |
| PAY-03 | Re-showing QR does not add a second timer (singletonKey) | integration | `cd api && bun test test/hold-idempotent.test.ts` | ❌ Wave 0 |
| DEL-01..04 | Fee matrix: zone×method flat rate; free-shipping over ฿500 only self+general; freshness intersection blocks methods | unit | `cd api && bun test test/delivery.test.ts` | ❌ Wave 0 |
| ORD-04 | Milestone push targets only `line_user_id` members; guests skipped (mock line client) | unit | `cd api && bun test test/notify.test.ts` | ❌ Wave 0 |
| LINE-02 | `POST /auth/line` rejects a forged/expired idToken; accepts a valid one (mock JWKS) | integration | `cd api && bun test test/auth-line.test.ts` | ❌ Wave 0 |
| CUST-04 | Reorder re-prices at current round; flags sold-out/absent items | integration | `cd api && bun test test/reorder.test.ts` | ❌ Wave 0 |
| PLAT-04 | Usage + marketing consent logged as separate rows with policy version | integration | `cd api && bun test test/consent.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single new test file for that task (`bun test <file>`).
- **Per wave merge:** `cd api && bun test` (full api suite, must stay green incl. the 118 Phase-1 tests).
- **Phase gate:** full api + web suites green before `/gsd-verify-work`; plus a manual real-bank-app QR scan + one real slip through SlipOK.

### Wave 0 Gaps
- [ ] `test/promptpay.test.ts` — golden CRC vector (PAY-01)
- [ ] `test/slip-verify.test.ts` + `test/slip-dedup.test.ts` — adapter + dedup (PAY-02)
- [ ] `test/hold-expiry.test.ts` + `test/hold-idempotent.test.ts` — pg-boss release + idempotency (PAY-03)
- [ ] `test/delivery.test.ts` — fee/freshness matrix (DEL-01..04)
- [ ] `test/notify.test.ts`, `test/auth-line.test.ts`, `test/reorder.test.ts`, `test/consent.test.ts`
- [ ] Shared `applyTransition()` extracted + covered by the existing Phase-1 status tests (must keep passing)
- [ ] pg-boss test setup: a Docker Postgres with the `pgboss` schema; `startAfter: 0` for fast tests.

## Package Legitimacy Audit

Verified via `gsd-tools query package-legitimacy check --ecosystem npm` + `npm view` on 2026-07-04.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| promptpay-qr | npm | since 2022 | 12.7k/wk | github.com/dtinth/promptpay-qr | OK | Approved (pin 0.5.0) |
| promptparse | npm | active (2026-05) | 1.9k/wk | github.com/maythiwat/promptparse | OK | Approved (optional alt) |
| qrcode | npm | since 2024 build | 15.6M/wk | github.com/soldair/node-qrcode | OK | Approved (pin 1.5.4) |
| pg-boss | npm | 12.25.1 = 1 day old | 812k/wk | github.com/timgit/pg-boss | **SUS (too-new)** | **Approved with pin 12.23.0** — the SUS flag is solely "too-new" on the day-old 12.25.1 patch; the package is the established timgit/pg-boss (812k weekly). Pin the CLAUDE.md-blessed **12.23.0** to sidestep the just-published patch. |
| sharp | npm | 0.35.3 = days old | very high | github.com/lovell/sharp | OK | Approved (pin 0.35.2 blessed, or 0.35.3) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** pg-boss — false positive (recency of a patch release, not a slopsquat). No `checkpoint:human-verify` needed; pin to 12.23.0. No postinstall scripts on pg-boss or sharp (`npm view … scripts.postinstall` empty).

## Sources

### Primary (HIGH confidence)
- slipok.com/api-documentation/check-slip — SlipOK endpoint, headers, body (data/files/url), response fields (transRef, amount, sender/receiver, banks), `log`/`amount` params
- slipok.com/price-and-service — free 100/mo + 2 shops, paid tiers (฿210/500…)
- document.easyslip.com/en/v2 — EasySlip v2 `POST /verify/bank`, Bearer auth, isAmountMatched/matchedAccount
- easyslip.com/api-products — EasySlip pricing tiers (Start 250/฿99…)
- timgit.github.io/pg-boss — pg-boss v12 start/createQueue/send(startAfter)/work(array)/stop, singletonKey, own schema
- github.com/dtinth/promptpay-qr — generatePayload(id,{amount}) → EMVCo payload
- Codebase (read in full): api/src/{db/schema.ts, services/reservation.ts, services/order-status.ts, routes/orders.ts, routes/catalog.ts, routes/webhook.ts, routes/files.ts, plugins/{line,storage,auth}.plugin.ts, env.ts, index.ts} — the exact Phase-0/1 seams
- npm registry (`npm view` + gsd-tools package-legitimacy) — versions + legitimacy on 2026-07-04

### Secondary (MEDIUM confidence)
- slip2go.com — Slip2Go free trial (100 one-time), tiers (pricing not public)
- github.com/PrakritManStudio/slipok-sdk — community TS SlipOK SDK (reference, not a dependency)

### Tertiary (LOW confidence)
- CLAUDE.md claim of `Bun.Image` native compression API (A1) — unverified against Bun 1.3.14 docs; sharp used as verified default

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified; core stack locked by CLAUDE.md.
- Vendor choice (SlipOK): HIGH on selection + endpoint/response shape (official docs fetched); MEDIUM on exact payee-masking behavior (A2, spike recommended).
- Integration wiring: HIGH — grounded in the actual shipped Phase-0/1 code.
- pg-boss / PromptPay usage: HIGH — official docs; minor API-shape confirmations at install (A5).
- Pitfalls: HIGH — the expiry-vs-paid and duplicate-scope pitfalls derive directly from the locked state machine + D-06.

**Research date:** 2026-07-04
**Valid until:** 2026-08-03 for stack/wiring (stable); ~2026-07-18 for vendor pricing/free-tier (volatile — reverify at signup).
</content>
</invoke>
