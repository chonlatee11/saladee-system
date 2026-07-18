---
phase: 04-web-store-marketing-scale
audited_at: 2026-07-18
asvs_level: 1
block_on: high
threats_total: 43
threats_closed: 43
threats_open: 0
unregistered_flags: 0
status: SECURED
---

# Phase 04 — Security Audit (web-store-marketing-scale)

Register authored at plan time across all 12 PLAN.md `<threat_model>` blocks.
Verification depth: **ASVS L1** (mitigation present in the cited file), with
RBAC verified at *every* route entry point rather than a single grep hit.

Implementation files were not modified by this audit.

## Verification Summary

| Disposition | Count | Closed | Open |
|-------------|-------|--------|------|
| mitigate | 39 | 39 | 0 |
| accept | 4 | 4 | 0 |
| transfer | 0 | — | — |
| **Total** | **43** | **43** | **0** |

`threats_open` = 0 (no OPEN threat at severity ≥ high).

## Threat Verification — Plan 01 (schema + settings)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-01 | Tampering | high | mitigate | `api/drizzle/0005_phase4.sql` — 7 `CREATE TABLE` + `ALTER TABLE orders ADD COLUMN` only; **zero** statements touch `round_stock`. Oversell guard untouched. |
| T-04-02 | Info Disclosure | high | mitigate | `api/src/routes/settings.ts:42` — `{ additionalProperties: false }` closed PUT body over 4 bounded non-secret keys. |
| T-04-03 | DoS | medium | mitigate | 0005 registered in self-resetting tests; full regression 383/0 (04-VERIFICATION.md). |

## Plan 02 (admin nav)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-04 | EoP | high | mitigate | Wave-2 endpoints now real and server-gated, not stubs: `coupons.ts:45`, `tracking.ts:59`, `broadcasts.ts:68`, `product-images.ts:85`, `reports.ts:86` — each `requireRole("owner","admin")`. Nav gate remains cosmetic; server is the authority. |
| T-04-05 | Tampering | low | **accept** | See Accepted Risks AR-1. |

## Plan 03 (coupon + loyalty money path)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-06 | Tampering/EoP | high | mitigate | `api/src/services/coupon.ts:73` guarded conditional `UPDATE … RETURNING` with `rows.length !== 1 → coupon_exhausted 409`; per-customer arbiter = `UNIQUE(coupon_id,customer_id)` (`0005_phase4.sql:81`) with 23505 → `coupon_already_used`. Both run inside the order tx. |
| T-04-07 | Tampering | high | mitigate | `api/src/routes/orders.ts:156` body accepts only `redeemPoints: t.Integer({min:1,max:1_000_000})` + `couponCode`; no client price/discount field. Server resolves via `redeemCouponGuarded` / `redeemPointsGuarded`. |
| T-04-08 | Tampering/DoS | high | mitigate | `orders.discount_satang` persisted (`0005:68`); `api/src/routes/payments.ts:134` **and** `:191` both subtract `ord.discountSatang` — expected-amount matches QR in both computations. |
| T-04-09 | Tampering | high | mitigate | `api/src/services/coupon.ts:98` `Math.floor(raw/100)*100` whole-baht floor; `api/src/routes/orders.ts:659` asserts `netSatang % 100 !== 0` before QR. |
| T-04-10 | EoP | high | mitigate | `coupons.ts` — all 3 routes (POST:91, GET:100, PATCH:118) carry `beforeHandle: staff`. No ungated route. |
| T-04-11 | Tampering | medium | mitigate | `orders.ts:638` `if (body.redeemPoints && isMember)`; ledger is append-only INSERT-only (`loyalty.ts:75,105` — no UPDATE/DELETE on `loyalty_ledger`). |

## Plan 04 (product image upload → R2)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-12 | DoS | high | mitigate | `product-images.ts:38` `MAX_IMAGE_BYTES = 5*1024*1024`, enforced at `:100` **before** sharp; `sharp` compress `:52`; all 3 routes (POST:169, GET:219, DELETE:279) `beforeHandle: adminOnly`. |
| T-04-13 | Tampering | medium | mitigate | `product-images.ts:132` server-assigned key `product-images/${target}/${crypto.randomUUID()}.jpg` — client cannot name the object; no traversal surface. |
| T-04-14 | Info Disclosure | low | **accept** | See Accepted Risks AR-2. |

## Plan 05 (tracking / delivery status)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-15 | EoP | high | mitigate | `tracking.ts` — all 3 routes (GET:86, GET:112, PATCH:186) `beforeHandle: staff` = `requireRole("owner","admin")`. |
| T-04-16 | Tampering | medium | mitigate | `tracking.ts:31` `DeliveryStatusSchema = t.Union([t.Literal(...)])` closed enum → 422 otherwise. |
| T-04-17 | Info Disclosure | medium | mitigate | `tracking.ts:22,155-160` reuses `pushOrderUpdate` keyed on the order's own `customers.lineUserId`; guest skipped inside the guard. No new LINE client. |

## Plan 06 (broadcast + bot)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-18 | Repudiation/PDPA | high | mitigate | `api/src/services/broadcast.ts:98-108` — latest-consent-row-per-customer query then `.filter(r => r.granted === true && r.line_user_id != null)`. Withdrawals (newer `granted=false`) dropped. NFR-04. |
| T-04-19 | Spoofing | high | mitigate | `api/src/routes/webhook.ts:239-240` raw-bytes `validateSignature(raw, channelSecret, signature)` rejects before any bot logic; regression in `api/tests/webhook.test.ts`, `webhook-bot.test.ts`. |
| T-04-20 | EoP | high | mitigate | `broadcasts.ts` — all 5 routes (POST:98, GET:107, GET:126, POST:159, DELETE:186) `beforeHandle: staff`. |
| T-04-21 | DoS | medium | mitigate | `api/src/jobs/boss.ts:24,35` pg-boss + `workerDb()` both on `env.DATABASE_URL_DIRECT` (not the pooled endpoint). |
| T-04-22 | DoS | medium | mitigate | `broadcast.ts:38` `MULTICAST_CHUNK = 500`; `:263` `chunk(audience)` before multicast. |

## Plan 07 (demand recommendation)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-23 | Tampering (SQLi) | high | mitigate | `api/src/routes/reports.ts` — 13 parameterized `sql\`\`` fragments; **zero** `sql.raw` / string concat matches. |
| T-04-24 | EoP | medium | mitigate | `crop.ts:77` `const grower = requireRole("owner","admin","grower")` applied at `crop.ts:382` to `GET /crop/planting-recommendation` (the CROP-07 demand-analytics endpoint). Matches the plan exactly; 401/403 covered by tests (04-07-SUMMARY.md:76). |
| T-04-25 | Tampering | low | mitigate | Recommendation card prefills only; admin edits + confirms before save (D-25). |

## Plan 08 (web store shell + SEO)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-SC | Tampering (supply chain) | high | mitigate | `web-store/package.json:15` `"@nuxtjs/seo": "5.3.2"` — exact pin, no range. Blocking-human legitimacy checkpoint documented + owner-approved (04-08-SUMMARY.md:104, harlan-zw/nuxt-seo verified on npmjs.com; not auto-approved). `ogImage` disabled to avoid pulling a further unvetted native/wasm dep. |
| T-04-26 | Info Disclosure | low | **accept** | See Accepted Risks AR-3. |
| T-04-27 | Tampering | medium | mitigate | `api/src/routes/catalog.ts:171-174` `onAfterHandle` sets `cache-control: private, no-store` + `vary: Authorization`; b2b prices gated by `wholesaleVisible` (`:42,148`). Shared cache cannot leak wholesale pricing. |

## Plan 09 (web-store guest checkout)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-28 | Tampering | high | mitigate | `web-store/pages/checkout.vue:273` posts via `api.orders.post` (Eden Treaty → the shared `POST /orders`). Negative verified: `grep -rn "reserve\|FOR UPDATE\|round_stock\|holdExpires" web-store/` returns **no** reservation logic — only UI copy ("accent is reserved for") and the `resolve` npm entry in `bun.lock`. Single reservation path remains `orders.ts:507`. NFR-02 preserved. |
| T-04-29 | Tampering | high | mitigate | `checkout.vue:219-242` `buildOrderBody()` emits ids + qty + delivery + consent + `couponCode` only — **no** money field, and `redeemPoints` deliberately never sent on the guest path. `body.lines` spreads `CartLine` = `{roundId, varietyId, saleUnitId, qty}` (`web-store/stores/cart.ts:17-22`) — identifiers only, zero price. `unitPriceSatang` at `:112,124` lives in the `lineRows` display computed, not the request body. |
| T-04-30 | DoS | medium | mitigate | Existing `holdExpiresAt` sweep + `MAX_SLIP_ATTEMPTS` unchanged; coupon adds only the guarded-limit write. |
| T-04-31 | Spoofing | medium | mitigate | `web-store/components/PointsRedeem.vue:18,43` — `isMember` prop; `v-if="!isMember"` renders the log-in hint instead of the redeem control. Server-side gate at `orders.ts:638` is the authority. |

## Plan 10 (LIFF coupon/points + PDPA)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-32 | Tampering | high | mitigate | Same server-authoritative path as T-04-07; LIFF sends code + bounded integer only. |
| T-04-33 | Repudiation/PDPA | high | mitigate | `api/src/services/consent.ts:76-80` `optOutMarketing` inserts `granted: false`; broadcast latest-row filter (T-04-18) excludes them. |
| T-04-34 | Tampering | high | mitigate | Negative verified by full-surface grep: `grep -rn "consentLogs\|consent_logs" api/src/` returns 17 hits — 2 INSERTs (`consent.ts:39,76`), 1 SELECT (`consent.ts:108-111`), 1 read-only SQL join (`broadcast.ts:100`), the table definition (`schema.ts:352`), and comments. **Zero** UPDATE or DELETE against `consentLogs`. Append-only confirmed. |
| T-04-35 | EoP | medium | mitigate | `api/src/routes/me-orders.ts:438,465` opt-out + status routes carry `beforeHandle: memberGuard`; guard returns 401 (no token) / 403 (guest, no `line_user_id`) at `:70,75,85`. |
| T-04-36 | Spoofing | medium | mitigate | PointsRedeem member-only (see T-04-31). |

## Plan 11 (catalog cover image)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-11-01 | Info Disclosure | low | mitigate | `catalog.ts:247,362` `coverUrl: gallery[0] ?? null` — derived from already-public gallery URLs; no new field beyond catalog scope. |
| T-04-11-02 | Tampering | low | mitigate | `api/src/env.ts:29` `R2_PUBLIC_BASE_URL: t.String({ default: "" })`; consumed via `env.R2_PUBLIC_BASE_URL` (`product-images.ts:72`). Never hardcoded. |
| T-04-11-03 | DoS | low | **accept** | See Accepted Risks AR-4. |

## Plan 12 (broadcast Flex composer)

| ID | Category | Sev | Disp | Evidence |
|----|----------|-----|------|----------|
| T-04-12-01 | Tampering | low | mitigate | Composer routes admin-gated (see T-04-20); URLs authored by trusted staff, stored as a `messageJson` snapshot. |
| T-04-12-02 | Spoofing/PDPA | high | mitigate | `resolveAudience` consent filter (`broadcast.ts:98-108`) is shared and UNCHANGED by the Flex path — a Flex broadcast cannot reach a non-consented customer. |
| T-04-12-03 | DoS | medium | mitigate | `broadcast.ts:159` `altText = (headline \|\| DEFAULT_MARKETING_TEXT).slice(0, ALT_TEXT_MAX)` — never empty; `buildBroadcastFlex` omits hero/CTA nodes when fields are empty. |

## Accepted Risks

| ID | Threat | Sev | Rationale |
|----|--------|-----|-----------|
| AR-1 | T-04-05 — Wave-1 stub routers | low | Stubs returned 501 and exposed no feature surface. Superseded: Wave-2 filled every stub with a `requireRole`-gated real endpoint (verified under T-04-04). Residual risk: none. |
| AR-2 | T-04-14 — product photos on the public R2 path | low | Product photos are public marketing assets by design (D-26). Payment slips remain on the separate **private signed-URL** path, unchanged by this phase. Accepted by owner discretion. |
| AR-3 | T-04-26 — store consumes existing public catalog | low | The web store calls only `GET /catalog`, which was already public before Phase 04. No new endpoint added, no admin surface widened. b2b pricing still gated (T-04-27). |
| AR-4 | T-04-11-03 — broken `<img>` src on a card | low | A placeholder renders when cover is null; a 404 image degrades to the browser default and layout is preserved. Cosmetic-only impact. |

## Unregistered Flags

**None.** No SUMMARY.md in this phase contains a `## Threat Flags` section. The
threat-surface sections that do exist affirmatively state no new surface:

- `04-02-SUMMARY.md:79` — "No new trust boundaries introduced beyond the plan threat model."
- `04-08-SUMMARY.md:108` — "No new security-relevant surface introduced beyond the plan's threat model."
- `04-03/04/05/06/07-SUMMARY.md` — threat sections map 1:1 onto registered IDs only.

This is evidence of absence, not merely absent evidence.

## Notes for the Ship Gate

- `threats_open: 0` — nothing at severity ≥ `high` is open. Phase 04 is clear to ship
  on security grounds.
- No plan/code divergences. (An earlier draft of this audit mis-attributed T-04-24 to
  `reports.ts:86` and reported a grower lockout; that was an auditor error. T-04-24's
  endpoint is `GET /crop/planting-recommendation` in `crop.ts`, correctly guarded by
  `requireRole("owner","admin","grower")`. `reports.ts` is Phase-03 code whose
  owner/admin-only guard is the intentional T-03-28 decision — it must NOT be loosened.)
