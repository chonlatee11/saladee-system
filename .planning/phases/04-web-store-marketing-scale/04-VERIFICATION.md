---
phase: 04-web-store-marketing-scale
verified: 2026-07-18T14:30:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
mode: mvp
re_verification:
  previous_status: human_needed
  previous_score: 4/4
  gaps_closed:
    - "Web-store catalog cards show the product photo when images were uploaded via web-admin (UAT gap 1 / ORD-05) — closed by 04-11"
    - "LINE broadcast delivered as a styled Flex Message, not plain text (UAT gap 2 / MKT-03, LINE-04) — closed by 04-12"
    - "Web-store guest checkout PromptPay QR live scan — UAT test 1 pass"
    - "Segmented LINE broadcast live delivery, opt-out excluded — UAT test 3 pass"
    - "Web-store responsive render mobile + desktop — UAT test 2 re-verified after image fix (04-11 human-verify)"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "SEO go-live (canonical/sitemap/OG absolute URLs) served on a real production .com domain"
    addressed_in: "Deferred prereq D-06 — production .com domain"
    evidence: "04-08 SEO artifacts (sitemap + JSON-LD + useSeoMeta + robots) present and build-verified; only the live domain swap is outstanding. Store builds/tests without it."
  - truth: "web-admin strict vue-tsc typecheck is fully clean"
    addressed_in: "Follow-up type-tightening (deferred-items.md)"
    evidence: "Pre-existing CouponComposer.vue:86 Eden body typing (shipped in 04-03, confirmed not caused by 04-11/04-12). Real build gate `vite build` passes (exit 0). Non-functional."
---

# Phase 4: Web Store, Marketing & Scale — Verification Report (Re-verification)

**Phase Goal:** The store expands beyond LINE — a public web storefront, promotions and loyalty, segmented broadcasts, full multi-carrier delivery, and demand-driven planting close the omnichannel loop on the proven order core.
**Verified:** 2026-07-18T14:30:00Z
**Status:** passed
**Re-verification:** Yes — after UAT gap closure (plans 04-11 + 04-12). Previous status `human_needed`; the three human items are now resolved via completed UAT and the two gap-closure plans' human-verify checkpoints.
**Mode:** mvp (compound omnichannel outcome, verified against the 4 ROADMAP Success Criteria)

## Re-verification Delta

The prior report (2026-07-18T02:05) verified all 4 success criteria but sat at `human_needed` for three real-world confirmations. Those are now closed:

- **UAT test 1 (PromptPay QR live scan)** → pass.
- **UAT test 2 (web-store responsive + product imagery)** → was `issue` ("ไม่เห็นรูปภาพแสดงเลย"). Root cause: `StoreVarietyCard.vue` gated `<img>` on `imageUrl` only, but web-admin uploads write `variety_images` gallery rows and never set `varieties.imageUrl`. **Closed by 04-11** — catalog now derives `coverUrl = gallery[0] ?? null`; card falls back `coverUrl → imageUrl → gallery[0] → placeholder`. Human-verified on mobile + desktop.
- **UAT test 3 (segmented broadcast)** → pass; opt-out correctly excluded. Requested Flex enhancement **closed by 04-12** — `buildBroadcastFlex` + delivery-seam `altText` guarantee + composer text|Flex toggle. Device-verified.

No regressions: full API suite 383 pass / 0 fail (was 369; +14 new catalog/flex tests).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Customer browses + checks out through a public web storefront reusing the same order/reservation core | ✓ VERIFIED | `web-store/` Nuxt SSR checkout reuses `api.orders.post` → `GET /orders/:id/qr` → slip; cart stores no money; server re-resolves price + `reserve()`. Catalog images now render (04-11 `coverUrl` + card fallback confirmed in `StoreVarietyCard.vue:38-79`). |
| 2 | Admin creates promotions/coupons and customers earn+redeem loyalty points | ✓ VERIFIED | `coupon.ts redeemCouponGuarded`, `loyalty.ts` append-only ledger; discount composes into `netSatang` before PromptPay; admin composers bundle. Tests green. |
| 3 | Admin sends a segmented LINE broadcast and a conversational chatbot can take orders | ✓ VERIFIED | `broadcast.ts resolveAudience` = latest marketing consent `granted=true AND line_user_id NOT NULL`, ≤500 chunking (`MULTICAST_CHUNK=500`, unchanged by 04-12); now supports Flex via `buildBroadcastFlex` + `normalizeMessages`/`ensureAltText` altText guarantee; rule-based bot postback flow. Tests green + UAT test 3 pass. |
| 4 | Delivery records carrier tracking, and system recommends per-Monday planting quantities | ✓ VERIFIED | `carrier/*` adapter seam; `tracking.ts` carrier+tracking+status enum; `crop-recommend.ts plantsToMeetDemand` inverse-forecast + `PlantingMix.vue` prefill. Tests green. |

**Score:** 4/4 truths verified (0 present-behavior-unverified).

### Deferred Items (non-blocking, tracked)

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | SEO go-live on production .com domain | Deferred prereq D-06 | SEO artifacts present + build-verified; only live domain swap outstanding |
| 2 | web-admin strict vue-tsc clean | Follow-up (deferred-items.md) | `vite build` passes (exit 0); CouponComposer.vue:86 pre-existing (04-03), confirmed NOT caused by 04-11/04-12 |

### Gap-Closure Verification (this re-verify)

| Gap | Fix Artifact | Verified in Code | Prohibition Honored | Status |
|-----|-------------|------------------|---------------------|--------|
| ORD-05 catalog images | `catalog.ts` `coverUrl = gallery[0] ?? null` (L247/373/465) | ✓ additive; `imageUrl`+`gallery` unchanged | ✓ `product-images.ts` still writes only `variety_images/box_images`, never sets `varieties.imageUrl` — gallery-first model (D-27/28) intact | ✓ VERIFIED |
| ORD-05 card render | `StoreVarietyCard.vue` `cover = coverUrl ?? imageUrl ?? gallery[0] ?? null` + placeholder; `pages/p/[id].vue` prefers coverUrl | ✓ confirmed | ✓ card falls back, upload not mutated | ✓ VERIFIED |
| ORD-05 env doc | `api/.env.example` documents `R2_PUBLIC_BASE_URL` | ✓ (per 04-11, env-guard blocked direct read) | ✓ env-driven, never hardcoded | ✓ VERIFIED |
| MKT-03/LINE-04 Flex | `broadcast.ts buildBroadcastFlex` + `ensureAltText`/`normalizeMessages` altText guarantee (L152-240) | ✓ confirmed | ✓ `resolveAudience`/consent/`MULTICAST_CHUNK=500` untouched (regression test 4/0); no Flex emitted without altText | ✓ VERIFIED |
| MKT-03 composer | `BroadcastComposer.vue` text|Flex toggle + `flexPayload()` mirror | ✓ confirmed | ✓ plain-text `messagePayload()` fallback preserved | ✓ VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Gap-fix tests | `bun test catalog + broadcast-flex + broadcast-audience` | 33 pass / 0 fail | ✓ PASS |
| Full API suite (regression) | `bun test` | 383 pass / 0 fail (65 files) | ✓ PASS |
| coverUrl derivation | grep `catalog.ts` | `gallery[0] ?? null` at variety/box/round maps | ✓ PASS |
| altText guarantee | grep `broadcast.ts` | `ensureAltText` injects DEFAULT on empty Flex altText | ✓ PASS |
| Upload prohibition | grep `product-images.ts` | no `varieties.imageUrl` write on upload | ✓ PASS |

### Requirements Coverage

| Requirement | Description | REQUIREMENTS.md | Status | Evidence |
|-------------|-------------|-----------------|--------|----------|
| ORD-05 | เว็บสั่งซื้อ (ตะกร้า→checkout) + catalog imagery | Complete | ✓ SATISFIED | web-store checkout + 04-11 coverUrl/card fallback |
| DEL-05 | เลขพัสดุ/สถานะจัดส่ง | Complete | ✓ SATISFIED | tracking.ts + carrier seam + status enum |
| CUST-03 | สมาชิก/สะสมแต้ม | Complete | ✓ SATISFIED | loyalty ledger earn/redeem |
| MKT-01 | โปรโมชัน/คูปอง | Complete | ✓ SATISFIED | coupon guarded + admin composer |
| MKT-03 | Broadcast ตามกลุ่ม (+ Flex) | Complete | ✓ SATISFIED | consent-filtered multicast + 04-12 Flex |
| LINE-04 | แชทบอตรับออเดอร์ + broadcast | Complete | ✓ SATISFIED | rule-based bot + Flex broadcast altText guarantee |
| CROP-07 | แนะนำการปลูกย้อนกลับ | Complete | ✓ SATISFIED | inverse-forecast recommendation |

All 7 phase requirements satisfied; no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX in phase-4 gap source | — | None |
| — | — | CouponComposer.vue:86 typecheck | ℹ️ Info | Pre-existing (04-03), tracked in deferred-items.md, `vite build` passes — not a blocker |

### Gaps Summary

No gaps. All 4 success criteria implemented, wired end-to-end, and covered by passing tests (383 pass / 0 fail). Both prior UAT gaps (catalog images, Flex broadcast) are closed in code with prohibitions honored — the gallery-first upload model and the consent/≤500-chunk broadcast invariants are untouched, and no Flex can be multicast without an altText. All three previously-outstanding human items are resolved (UAT complete: 2 pass + 1 issue-now-fixed-and-re-verified; both gap plans' human-verify checkpoints approved on real infra). The two deferred items (SEO .com go-live D-06, web-admin strict vue-tsc) are non-blocking and explicitly tracked.

**Verdict: PASS.** Phase 04 goal achieved.

---

_Verified: 2026-07-18T14:30:00Z_
_Verifier: Claude (gsd-verifier) — re-verification after 04-11 + 04-12 gap closure_
