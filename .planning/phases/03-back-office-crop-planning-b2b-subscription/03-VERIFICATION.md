---
phase: 03-back-office-crop-planning-b2b-subscription
verified: 2026-07-11T02:03:03Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
warnings:
  - concern: "catalog GET / exposes b2b (wholesale) tier price unconditionally"
    file: "api/src/routes/catalog.ts"
    detail: >
      GET /catalog returns prices: { b2c, b2b } for every variety (lines 110-111)
      and priceSatang: { b2c, b2b } for boxes (line 269) regardless of caller B2B
      approval. Pre-existing, NOT caused by Phase 3; flagged by 03-08 and recorded in
      deferred-items.md. CUST-02 positive criterion is met via the gated
      /me/b2b/prices + wholesaleVisible() path, so the phase goal is not blocked, but
      this is a genuine wholesale-price / PDPA exposure needing a follow-up decision:
      gate/omit the b2b tier in the public catalog, or confirm it is intentionally public.
    severity: warning
human_verification:
  - test: "03-03 web-admin RBAC nav + direct-URL 403"
    expected: "grower/packer see only their menus; out-of-role direct URL is server-403'd (requireRole authority, not just cosmetic nav)"
    why_human: "role-session browser interaction + visual sidebar; server guard proven in code but end-to-end session flow needs a live browser"
  - test: "03-04 crop planning end-to-end (variety params → batch → 1-click mix → harvest calendar)"
    expected: "grower sets variety params, logs a batch showing projected harvest date + expected yield, one click spawns the week's batches from the mix template"
    why_human: "multi-screen admin UI flow; visual confirmation of projected dates/yields"
  - test: "03-05 publish gate + manual-override permanence + harvest log"
    expected: "publish writes sellable qty; a hand-set (override) row survives re-publish; actual harvest logs lot/best-before + shows delta; B2C sees quota − (standing+subscription reserved) from first view"
    why_human: "cross-slice seeded state (standing + subscription) + visual catalog availability after publish"
  - test: "03-06 B2B approval + standing reserve-before-B2C + overflow flag"
    expected: "approving a B2B account reveals wholesale price; a standing order pre-decrements reserved_plants before B2C sees the round; over-forecast demand raises an admin overflow flag (no auto-trim)"
    why_human: "live approval → price-visibility toggle + round-open ordering observed in browser"
  - test: "03-07 subscription generator + idempotency + substitution"
    expected: "round-open auto-creates one box order per active subscription, reserved before B2C; a re-trigger creates no duplicate; a sold-out variety fires a LINE substitution notice; admin can pause/skip/cancel"
    why_human: "pg-boss trigger + LINE push + admin state changes across a live round cut-off"
  - test: "03-08 LIFF subscription/B2B customer flows"
    expected: "customer signs up/manages a subscription, requests B2B (pending → wholesale after approval), sees a standing order + substitution detail — all on mobile/LINE"
    why_human: "LIFF mini-app in the LINE in-app browser on a phone"
  - test: "03-09 packing queue by route + Thai PDF pack/label"
    expected: "packer sees paid orders grouped by round → delivery zone/method; pack/label PDF opens with legible Sarabun Thai (no tofu), print-safe"
    why_human: "must open the real PDF and inspect Thai glyph rendering + print layout"
  - test: "03-10 dashboard cards"
    expected: "dashboard shows today's/this-round sales, unpaid orders, near-sold-out items, next-round yield + the B2B/subscription card with the overflow flag"
    why_human: "visual card layout + live aggregate numbers"
  - test: "03-11 reports charts + CSV export"
    expected: "period/channel/product/round filters update charts with stable channel↔color mapping; best-sellers/AOV/repeat customers correct; Thai CSV opens without mojibake"
    why_human: "visual chart interaction + opening the exported CSV in a spreadsheet"
  - test: "03-12 settings secret-safety + canned LINE chatbot"
    expected: "editing haircut %/hold window takes effect with no redeploy and no payee/slip-key ever in the form/response; LINE keywords เมนูรอบนี้/ราคาวันนี้/ของเหลือ return Flex cards + a LIFF deep-link; other text falls back"
    why_human: "must test inside the real LINE OA client + confirm secret absence in the live UI"
---

# Phase 3: Back-office, Crop Planning & B2B/Subscription — Verification Report

**Phase Goal:** The farm runs operations from the back-office — crop plans forecast harvests that auto-feed sellable quantities, B2B quota and standing orders are guaranteed, subscriptions auto-generate, and staff manage packing, dashboards, and reports by role.
**Verified:** 2026-07-11T02:03:03Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal is **structurally and behaviorally achieved in code**. The self-feeding
chain (crop plan → forecast → published sellable quota → standing/subscription reserved
before B2C through the single NFR-02 guard) is implemented as designed, and the full
automated suite is green (**api 298 pass / 0 fail**, web-admin build ✓). What remains is
**10 blocking live-browser/LINE UAT checkpoints** that every Wave-2/3 plan deliberately
deferred to end-of-phase — these are not auto-verifiable, so the phase lands at
`human_needed`, not `passed`.

### Observable Truths (mapped to the 5 ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Variety params + per-round planting mix → auto-create batches + weekly harvest calendar with expected yield | ✓ VERIFIED | `services/crop.ts` + pure `services/forecast.ts` kernel (`projectedHarvestDate`, `forecastPlants`); `routes/crop.ts` grower-gated, expected yield derived on read; views VarietyParams/PlantingMix/PlantingBatches/HarvestCalendar wired via `useCrop`. Tests: `forecast.test.ts` green. |
| 2 | Harvest calendar auto-populates sellable qty (manual override retained) + actual harvest logged with lot/best-before | ✓ VERIFIED | `harvest.publishQuota` UPSERTs `quota_plants` with `setWhere: isManualOverride=false` (override never clobbered, D-03); `logHarvest` = 1 batch = 1 lot via UNIQUE(batch_id), auto lotCode + best-before = harvest+shelfLifeDays, returns delta (shown-only, no auto-tune). Tests: `forecast-publish.test.ts`, `harvest-log.test.ts` green. |
| 3 | B2B sees wholesale pricing + standing order reserved from forecast before B2C; subscriptions auto-generate per round with pause/skip/cancel | ✓ VERIFIED | `b2b.reserveStanding` is a thin loop over the EXISTING guarded `reserve()` (no 2nd counter), called INSIDE `publishQuota`'s tx before any B2C order can run → reserved-before-B2C with no race window; overflow → `quota_overflow_flags` (no auto-trim); `wholesaleVisible()` gates the b2b tier. `subscription.generateForRound` fills by value, reserves via guarded `reserveBox()`, idempotent via UNIQUE(subscription_id, round_id) inserted LAST; `jobs/boss.ts` wires the `subscription-generate` queue/worker, triggered post-commit by `publishQuota`. Tests: `standing-reserve.test.ts`, `b2b-approval.test.ts`, `subscription-fill.test.ts`, `subscription-gen.test.ts` green. |
| 4 | Pack queue grouped by delivery route + Thai pack/label PDF; RBAC limits owner/admin/grower/packer | ✓ VERIFIED | `routes/packing.ts` packer-gated, grouped by round → deliveryZone/method (D-20), `packed_at` state, `Cache-Control: no-store, private` on PDFs (PDPA); `pdf/pack-slip.ts` + `pdf/label-slip.ts` use `PdfPrinter` reading Sarabun TTFs from `api/src/fonts/` (Regular+SemiBold present). RBAC end-to-end: `requireRole` role-scoped across every route (crop/harvest=grower, packing=packer, dashboard/reports/settings/b2b=owner/admin); `web-admin/router.ts` `meta.roles` (CROP/PACK/OWNER_ADMIN). Tests: `packing-queue.test.ts`, `pdf-thai.test.ts` green. |
| 5 | Dashboard (4 cards + B2B/sub) + reports by period/channel/product/round + configurable settings + canned LINE chatbot | ✓ VERIFIED | `routes/dashboard.ts` (staff-gated, 4 criterion cards + B2B/subscription + overflow flag, D-23); `routes/reports.ts` analytics + CSV; `services/settings.ts` + `routes/settings.ts` hot config with allowlist → secret-shaped key = 422 both directions (secrets never in/out); `routes/webhook.ts` canned keyword/postback → Flex + LIFF deep-link, signature preserved, no NLU (D-25). Tests: `dashboard.test.ts`, `reports.test.ts`, `settings.test.ts`, `chatbot-router.test.ts` green. |

**Score:** 5/5 truths verified (0 present-behavior-unverified). All behavior-dependent
invariants — reserve-before-B2C ordering, publish idempotency + manual-override
permanence, subscription-generate idempotency, overflow-flag-no-auto-trim — carry
passing behavioral tests, so they are VERIFIED on behavior, not merely on symbol presence.

### Core Invariant Check (NFR-02 self-feeding chain — the phase's load-bearing seam)

| Property | Verdict | Evidence |
|----------|---------|----------|
| `publishQuota` is the single owner of the round-open sequence | ✓ | `harvest.ts:136` — the only writer of `quota_plants` from draft; comment + code confirm one-shot reserve+trigger on first publish only. |
| No second stock counter; standing/subscription reserve through the ONE guard | ✓ | `reserveStanding` → `reserve()` (reservation.ts UNCHANGED guarded conditional UPDATE); `generateForRound` → `reserveBox()` → `reserve()`. `reserved_plants` moved EXCLUSIVELY by the guard. |
| Standing reserved atomically BEFORE B2C (no race window) | ✓ | `reserveStanding` runs inside the same tx that writes `quota_plants` (`harvest.ts:168-171`); a B2C reader can only ever see `quota − reserved`. |
| Re-publish is idempotent, manual override permanent | ✓ | `firstPublish` gate (no round_stock rows) → reserve+trigger once; UPSERT `setWhere isManualOverride=false` never clobbers a hand-set qty. |
| Subscription generation idempotent under worker retry | ✓ | UNIQUE(subscription_id, round_id) inserted LAST in per-sub tx → 23505 rolls back order+reservation; no in-code pre-check. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/src/services/harvest.ts` | publishQuota + computeDraftQuota + logHarvest | ✓ VERIFIED | Substantive, wired into `routes/harvest.ts` POST /harvest/publish. |
| `api/src/services/b2b.ts` | reserveStanding + wholesaleVisible | ✓ VERIFIED | Thin loop over reserve(); wired into `routes/b2b.ts`. |
| `api/src/services/subscription.ts` | fillBox + generateForRound | ✓ VERIFIED | Wired into `jobs/boss.ts` subscription-generate worker. |
| `api/src/services/reservation.ts` | reserve/release/reserveBox guard | ✓ VERIFIED | UNCHANGED Phase-1 guard reused (no 2nd counter). |
| `api/src/jobs/boss.ts` | subscription-generate queue+worker | ✓ VERIFIED | Queue created + worker attached; triggered by publishQuota post-commit. |
| `api/src/pdf/pack-slip.ts`, `label-slip.ts` + `api/src/fonts/Sarabun-*.ttf` | Thai PDF via embedded Sarabun | ✓ VERIFIED | PdfPrinter reads TTFs from disk; fonts present; `pdf-thai.test.ts` green. |
| `api/src/routes/*` (crop/harvest/b2b/subscriptions/packing/dashboard/reports/settings/webhook) | role-gated feature routes | ✓ VERIFIED | All composed in index.ts; requireRole role-scoped; no stubs. |
| `web-admin/` (13 views + AppShell + DataTable + router + 8 composables) | back-office SPA on typed Eden client | ✓ VERIFIED | All 13 views import typed composables → Eden Treaty `api`; build ✓ (570ms); no placeholder/TODO/WIP in views. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full API suite (includes all Phase-3 invariant tests) | `bun test` | 298 pass / 0 fail, 54 files, 14.5s | ✓ PASS |
| web-admin production build (real deliverable, not just typecheck) | `bun run build` | built in 570ms, Reports/DataTable/session chunks emitted | ✓ PASS |
| Live-browser / LINE UAT (10 checkpoints) | — | requires phone/LINE OA + role sessions | ? SKIP → human |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CROP-01/02/03/06 | variety params, batches, auto harvest date+yield, mix→auto-batches | ✓ SATISFIED | crop.ts + forecast.ts + views (SC1) |
| CROP-04 | harvest calendar → auto sellable qty (override kept) | ✓ SATISFIED | publishQuota (SC2) |
| CROP-05 / INV-10 | actual harvest logging vs forecast + lot/best-before | ✓ SATISFIED | logHarvest 1-batch-1-lot (SC2) |
| CUST-02 | B2B wholesale visibility + credit terms | ✓ SATISFIED (see warning) | wholesaleVisible gate + b2b_status/credit terms; ⚠ public catalog leaks b2b tier (follow-up) |
| CUST-05 | B2B standing order + forecast quota reserved before B2C | ✓ SATISFIED | reserveStanding inside publishQuota tx (SC3) |
| SALE-03 | subscription box: auto-generate, pause/skip/cancel | ✓ SATISFIED | generateForRound + boss worker (SC3) |
| ORD-03 | pack queue by route + printable slips | ✓ SATISFIED | packing.ts + pack/label PDF (SC4) |
| ADM-02 | role-based access | ✓ SATISFIED | requireRole + router meta.roles (SC4) |
| ADM-01 | dashboard | ✓ SATISFIED | dashboard.ts (SC5) |
| MKT-04 | sales reports by period/channel/product/round + CSV | ✓ SATISFIED | reports.ts (SC5) |
| ADM-03 | configurable system settings (secret-safe) | ✓ SATISFIED | settings.ts 422 gate (SC5) |
| MKT-02 | canned LINE chatbot menu/stock + routes to LIFF | ✓ SATISFIED | webhook.ts canned map (SC5) |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `api/src/routes/catalog.ts` (110-111, 269) | b2b wholesale tier returned to all callers ungated | ⚠️ Warning | Potential wholesale-price / PDPA exposure. Pre-existing, out-of-Phase-3 scope, documented in deferred-items.md. CUST-02 met via gated /me/b2b/prices → not a goal blocker; needs a follow-up gate/confirm decision. |

No debt markers (TBD/FIXME/XXX), no stub returns, no placeholder views detected in
Phase-3 modified files.

### Human Verification Required (10 blocking UAT checkpoints — deferred by every slice)

Each Wave-2/3 plan carries a `gate="blocking"` `checkpoint:human-verify` that was
deferred to end-of-phase; these exercise live browser / LINE-client / real-PDF behavior
that grep and unit tests cannot see. See the `human_verification` frontmatter block for
the full test/expected/why-human detail for 03-03 through 03-12. Summary:

1. **03-03** — web-admin RBAC nav + direct-URL 403 (role sessions)
2. **03-04** — crop planning end-to-end (params → batch → 1-click mix → calendar)
3. **03-05** — publish gate + manual-override permanence + harvest log
4. **03-06** — B2B approval + standing reserve-before-B2C + overflow flag
5. **03-07** — subscription generator + idempotency + substitution notice
6. **03-08** — LIFF subscription/B2B customer flows (mobile/LINE)
7. **03-09** — packing queue by route + Thai (Sarabun) PDF legibility
8. **03-10** — dashboard cards + B2B/subscription card
9. **03-11** — reports charts (stable channel colors) + Thai CSV export
10. **03-12** — settings secret-absence + canned LINE chatbot in the LINE client

### Gaps Summary

No FAILED truths, no missing/stub artifacts, no broken key links — the phase goal is
achieved in code with full automated coverage (298/0 + build). Two items carry forward:

- **1 warning (follow-up, not a blocker):** the public `GET /catalog` leaks the b2b
  wholesale tier to unauthenticated callers. Pre-existing and out-of-scope for Phase 3
  (CUST-02's positive requirement is served by the gated `/me/b2b/prices`), but it is a
  real wholesale-price / PDPA exposure that needs a decision — gate/omit the b2b tier in
  the public catalog, or explicitly confirm it is intended to be public.
- **10 blocking live-UAT checkpoints** must be exercised by a human before the phase is
  signed off. These are behavioral surfaces (browser role-gating, LINE Flex/deep-link,
  real Thai PDF glyphs, mobile LIFF) that are not auto-verifiable.

Because automated verification is fully green but blocking human items remain, the phase
status is **human_needed** (not `passed`).

---

_Verified: 2026-07-11T02:03:03Z_
_Verifier: Claude (gsd-verifier)_
