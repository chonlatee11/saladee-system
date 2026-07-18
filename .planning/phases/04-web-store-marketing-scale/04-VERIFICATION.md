---
phase: 04-web-store-marketing-scale
verified: 2026-07-18T02:05:00Z
status: human_needed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
mode: mvp
deferred:
  - truth: "SEO go-live (canonical/sitemap/OG absolute URLs) served on a real production domain"
    addressed_in: "Deferred prereq D-06 — production .com domain"
    evidence: "04-08 artifacts (sitemap + JSON-LD + useSeoMeta + robots) are present and build-verified; only the live domain swap is outstanding. Store builds/tests without it (nuxt.config site.url placeholder)."
  - truth: "web-admin strict vue-tsc typecheck is fully clean"
    addressed_in: "Follow-up type-tightening (deferred-items.md)"
    evidence: "Pre-existing CouponComposer.vue:86 Eden body typing; the real build gate `vite build` passes (exit 0). Logged in deferred-items.md, not a functional gap."
human_verification:
  - test: "Web-store guest checkout PromptPay QR end-to-end scan with a real bank app"
    expected: "The rendered NET (post-discount) whole-baht QR scans in a real banking app and shows the exact discounted amount; slip upload completes the order"
    why_human: "Requires a real mobile banking app scanning a live QR — cannot be automated. Owner-deferred per phase note."
  - test: "Load the public web store on desktop AND mobile viewport"
    expected: "Current round's catalog is server-rendered, product page opens with real gallery imagery, layout is correct mobile-first (NFR-07) and at store-max 1200px desktop"
    why_human: "Visual/responsive rendering quality is not observable via grep; MVP-mode user-flow confirmation."
  - test: "Admin sends a segmented LINE broadcast to a real consented test audience"
    expected: "Only marketing-consented customers with a line_user_id receive the multicast; a customer who opted out does not"
    why_human: "Real LINE multicast delivery to real accounts requires a live OA + test users (audience filter is unit-tested, but end-to-end delivery is external)."
---

# Phase 4: Web Store, Marketing & Scale — Verification Report

**Phase Goal:** The store expands beyond LINE — a public web storefront, promotions and loyalty, segmented broadcasts, full multi-carrier delivery, and demand-driven planting close the omnichannel loop on the proven order core.
**Verified:** 2026-07-18T02:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification
**Mode:** mvp (goal is a compound omnichannel outcome, verified against the 4 ROADMAP Success Criteria)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Customer browses + checks out through a public web storefront (cart → checkout) reusing the same order/reservation core | ✓ VERIFIED | `web-store/` Nuxt SSR: `pages/index.vue` (SSR catalog), `pages/p/[id].vue` (product + JSON-LD), `pages/checkout.vue` POSTs `api.orders.post` → `GET /orders/:id/qr` → `POST /orders/:id/slip`. `stores/cart.ts` stores only `{roundId,varietyId,saleUnitId,qty}` — no money. Server re-resolves price + `reserve()` (no second oversell path). `web-store` build passes (cloudflare-pages). |
| 2 | Admin creates promotions/coupons (percent/baht, min, expiry, usage limit, segment codes) and customers earn+redeem loyalty points | ✓ VERIFIED | `coupon.ts redeemCouponGuarded()` (guarded UPDATE + UNIQUE per-customer arbiter); `loyalty.ts earnPoints/redeemPointsGuarded/getBalance` (append-only ledger, `ON CONFLICT (order_id) WHERE kind='earn' DO NOTHING`); discount composes into `netSatang` before `buildPromptPayPayload`; whole-baht guard `netSatang % 100`. Admin `CouponComposer.vue`+`LoyaltySettings.vue` bundle in web-admin build. Tests: coupon, coupon-race, loyalty, checkout-discount — all green. |
| 3 | Admin sends a segmented LINE broadcast and a conversational chatbot can take orders | ✓ VERIFIED | `broadcast.ts` audience = `DISTINCT ON (customer_id)` latest marketing consent `granted=true AND line_user_id NOT NULL`, ≤500 multicast chunking; `broadcasts.ts` compose/schedule/send + pg-boss worker; `webhook.ts` rule-based (no-LLM, per D-19/D-20) postback state machine after `validateSignature`, deep-links to LIFF to pay. Tests: broadcast-audience, webhook-bot, chatbot-router — all green. |
| 4 | Delivery records carrier tracking number/status (Grab/Lalamove/general), and system recommends per-Monday planting quantities from demand history | ✓ VERIFIED | `carrier/{index,manual.adapter,types}.ts` env-selected adapter seam (grab/lalamove commented for later, no route rework); `tracking.ts` sets carrier+tracking, PATCH `deliveryStatus` enum, reuses `pushOrderUpdate` (guest-guarded). `crop-recommend.ts plantsToMeetDemand = ceil(demand*100/survivalPct)` (inverse of forecast.ts) + trailing demand + unmet (back-in-stock) demand; `GET /crop/planting-recommendation`; `PlantingMix.vue` prefill card. Tests: tracking, crop-recommend — all green. |

**Score:** 4/4 truths verified (0 present-behavior-unverified — every behavior-dependent invariant has a passing named test)

### Deferred Items

Items not blocking goal achievement; addressed by an explicit deferred prereq or follow-up.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | SEO go-live on production domain | Deferred prereq D-06 (.com domain) | SEO artifacts present + build-verified; only live domain swap outstanding |
| 2 | web-admin strict vue-tsc clean | Follow-up (deferred-items.md) | Real gate `vite build` passes (exit 0); CouponComposer.vue:86 pre-existing type strictness |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/drizzle/0005_phase4.sql` + `.down.sql` | Additive schema + rollback | ✓ VERIFIED | migrate.test.ts up/down/up green |
| `api/src/services/coupon.ts` | Guarded redeem | ✓ VERIFIED | redeemCouponGuarded, wired in orders.ts |
| `api/src/services/loyalty.ts` | Ledger earn/redeem/balance | ✓ VERIFIED | earnPoints on paid transition, ON CONFLICT once-per-order |
| `api/src/services/broadcast.ts` | Consent-filtered audience | ✓ VERIFIED | DISTINCT ON latest marketing granted + line_user_id |
| `api/src/services/carrier/*` | Adapter seam | ✓ VERIFIED | makeCarrierAdapter(manual); grab/lalamove seam |
| `api/src/services/crop-recommend.ts` | Inverse-forecast kernel | ✓ VERIFIED | plantsToMeetDemand + trailing + unmet demand |
| `api/src/services/consent.ts` | Append-only opt-out/re-consent | ✓ VERIFIED | optOutMarketing inserts granted=false; getConsentStatus |
| `api/src/routes/{coupons,loyalty,broadcasts,tracking,product-images,crop,me-orders}.ts` | Real routes (no 501) | ✓ VERIFIED | All composed in index.ts; zero 501 stubs found |
| `api/src/routes/catalog.ts` | Gallery payload | ✓ VERIFIED | variety_images/box_images cover-first gallery |
| `web-store/` Nuxt SSR app | Storefront + checkout | ✓ VERIFIED | index/p[id]/checkout + cart store; build passes |
| `web/src/components/{CouponField,PointsRedeem}.vue`, `ConsentSettings.vue` | LIFF coupon/points + opt-out | ✓ VERIFIED | Present; me-orders opt-out route wired |
| web-admin views (6) | Admin surfaces | ✓ VERIFIED | All bundle in vite build (exit 0) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| checkout.vue | POST /orders | api.orders.post (guest) | ✓ WIRED | reuses existing endpoint, no new order/payment API |
| orders.ts | promptpay | discount→netSatang before buildPromptPayPayload | ✓ WIRED | whole-baht guard enforced |
| payments.ts | slip verify | expectedAmountSatang subtracts discountSatang | ✓ WIRED | discounted slip auto-paid |
| order-transition.ts | loyalty | earnPoints in-tx on paid, ON CONFLICT | ✓ WIRED | once-per-order |
| broadcast.ts | consent_logs | DISTINCT ON latest marketing granted | ✓ WIRED | opt-out excludes (consent-optout.test) |
| tracking.ts | notify.ts | pushOrderUpdate (guest-guarded) | ✓ WIRED | LINE push per status transition |
| webhook.ts | LIFF | postback state machine after validateSignature | ✓ WIRED | signature block untouched |
| crop.ts | crop-recommend.ts | plantsToMeetDemand inverse forecast | ✓ WIRED | PlantingMix prefill |
| catalog GET | web-store + LIFF | one round model (D-04) | ✓ WIRED | same GET /catalog gallery |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full API suite | `bun test` | 369 pass / 0 fail (64 files) | ✓ PASS |
| web-store build | `bun run build` | dist generated (cloudflare-pages) | ✓ PASS |
| web-admin build | `bun run build` | built in 609ms (exit 0) | ✓ PASS |
| No 501 stubs in new routers | grep 501 | none | ✓ PASS |
| Migration up/down/up | migrate.test.ts | green | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| ORD-05 | 04-04, 04-08, 04-09 | เว็บสั่งซื้อ (ตะกร้า→checkout) | ✓ SATISFIED | web-store checkout + catalog gallery |
| DEL-05 | 04-01, 04-05 | เลขพัสดุ/สถานะจัดส่ง | ✓ SATISFIED | tracking.ts + carrier seam + status enum |
| CUST-03 | 04-01, 04-03, 04-10 | สมาชิก/สะสมแต้ม | ✓ SATISFIED | loyalty ledger earn/redeem |
| MKT-01 | 04-01, 04-03, 04-10 | โปรโมชัน/คูปอง | ✓ SATISFIED | coupon guarded + admin composer |
| MKT-03 | 04-01, 04-06, 04-10 | Broadcast ตามกลุ่ม | ✓ SATISFIED | consent-filtered multicast |
| LINE-04 | 04-01, 04-06 | แชทบอตรับออเดอร์ + broadcast | ✓ SATISFIED | rule-based bot deep-link + broadcast |
| CROP-07 | 04-07 | แนะนำการปลูกย้อนกลับ | ✓ SATISFIED | inverse-forecast recommendation |

All 7 phase requirements accounted for; no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX in phase-4 source | — | None |
| — | — | No TODO/HACK/PLACEHOLDER (except EmptyState stub components, intended) | — | None |

### Human Verification Required

1. **Web-store PromptPay QR live scan** — scan the rendered NET whole-baht QR with a real bank app; confirm exact discounted amount, complete slip upload. (Owner-deferred; cannot automate.)
2. **Web-store responsive render** — load on desktop + mobile; catalog SSR, product gallery imagery, mobile-first + 1200px desktop layout.
3. **Segmented LINE broadcast live delivery** — send to a real consented test audience; confirm opted-out user is excluded.

### Gaps Summary

No gaps. All 4 success criteria are implemented, wired end-to-end, and covered by passing tests (369 pass / 0 fail). Both web-store and web-admin production builds pass (the real gates). The two deferred items (SEO .com go-live D-06, web-admin strict vue-tsc) are non-blocking: artifacts exist, the real build gate passes, and both are explicitly tracked. Status is `human_needed` solely because three items require real-world confirmation (live PromptPay scan, responsive visual, live LINE multicast) — the owner has already deferred the PromptPay live scan.

---

_Verified: 2026-07-18T02:05:00Z_
_Verifier: Claude (gsd-verifier)_
