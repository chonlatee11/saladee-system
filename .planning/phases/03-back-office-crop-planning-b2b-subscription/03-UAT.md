---
phase: 03-back-office-crop-planning-b2b-subscription
source: 03-VERIFICATION.md
status: testing
generated: 2026-07-11
total_items: 10
passed: 5
issues: 1
fixed: 2
---

# Phase 3 — UAT Checklist (live human verification)

Automated verification passed 5/5 success criteria (api 298 pass / 0 fail, web 30/0 + build, web-admin build ✓). The items below are the **blocking live-browser / LINE / real-PDF checks** every Wave-2/3 plan deferred — they cannot be automated. Complete them, then re-run the verify step until status is `passed`.

**Setup:** start API on :3000, web-admin on :5174, web (LIFF) on :5173. Seed staff accounts (owner / grower / packer), at least one B2B customer, one active subscription, and a round with due planting batches.

| # | Plan | Test | Expected |
|---|------|------|----------|
| 1 | 03-03 | web-admin RBAC nav + direct-URL 403 | grower/packer see only their menus; out-of-role direct URL is server-403'd (not just hidden nav) |
| 2 | 03-04 | crop planning end-to-end | grower sets variety params → logs a batch (shows projected harvest date + expected yield) → 1-click mix spawns the week's batches; repeat click = already-created |
| 3 | 03-05 | publish gate + override permanence + harvest log | publish writes sellable qty; a hand-set override row survives re-publish; harvest logs lot/best-before + delta; B2C sees quota − (standing+subscription reserved) from first view |
| 4 | 03-06 | B2B approval + standing reserve-before-B2C + overflow | approving B2B reveals wholesale price; standing order pre-decrements reserved before B2C; over-forecast raises admin overflow flag (no auto-trim) |
| 5 | 03-07 | subscription generator + idempotency + substitution | round-open auto-creates 1 box order per active subscription (reserved before B2C); re-trigger = no duplicate; sold-out variety fires LINE substitution notice; admin pause/skip/cancel works |
| 6 | 03-08 | LIFF subscription/B2B customer flows | customer signs up/manages subscription; requests B2B (pending → wholesale after approval); sees standing order + substitution detail — all on mobile/LINE |
| 7 | 03-09 | packing queue by route + Thai PDF | packer sees paid orders grouped by round → delivery zone/method; pack/label PDF opens with legible Sarabun Thai (no tofu), print-safe |
| 8 | 03-10 | dashboard cards | shows today's/this-round sales, unpaid orders, near-sold-out, next-round yield + B2B/subscription card with overflow flag; live numbers correct |
| 9 | 03-11 | reports charts + CSV | period/channel/product/round filters update charts with stable channel↔color mapping; best-sellers/AOV/repeat correct; Thai CSV opens without mojibake |
| 10 | 03-12 | settings secret-safety + canned chatbot | editing haircut %/hold window takes effect with no redeploy and no payee/slip-key ever in form/response; LINE keywords เมนูรอบนี้/ราคาวันนี้/ของเหลือ → Flex + LIFF deep-link; other text → fallback |

## Follow-up decision (warning, not phase-blocking)

- **`api/src/routes/catalog.ts` (lines 110-111, 269)** returns the b2b (wholesale) tier price to **all** callers ungated — a potential wholesale-price / PDPA exposure. Pre-existing (not caused by Phase 3), flagged by 03-08 in `deferred-items.md`. CUST-02 is met via the gated `/me/b2b/prices` path, so the phase goal is not blocked. **Decision needed:** gate/omit the b2b tier in the public catalog, or confirm it is intentionally public.

## Live run results (2026-07-11, API :3001 / web-admin :5174 / web :5173, dev-seed applied)

### 1. RBAC nav + direct-URL 403 — **pass**

### 2. Crop planning end-to-end — **pass** (after fix)
reported: "variety param + add batch ทำได้; batch view เคย crash (error boundary), 1-click mix + repeat กดได้"
- Root cause was the date .slice crash (see Gaps); FIXED + re-verified in-browser: batch table renders all 8 rows with correct dates, no error boundary.

### 3. Publish gate + override + harvest log — **pass** (after fix)
reported: "1.publish ทำได้ 2.override survive re-publish ทำได้ 3.harvest-log เคย crash"
- Publish ✓ · override survives re-publish ✓ (round_stock override row kept) · B2C availability = quota − reserved ✓ (catalog: กรีนโอ๊ค 35 = 55−20)
- Harvest-log modal crash was the same date .slice bug — FIXED + re-verified in-browser (modal opens: 'ปลูก 2026-07-13 · คาด 90 ต้น').

### 4. B2B approval + standing reserve + overflow — **pass** (with minor display issue)
- Approve B2B reveals wholesale price ✓
- Standing reserve-before-B2C ✓ (verified: กรีนโอ๊ค/เรดโอ๊ค reserved 20 pre-B2C; catalog availability = quota − reserved)
- Overflow no-auto-trim ✓ (simulated demand 999 > quota 55 → overflow flag shortfall=999 source=b2b unresolved, reserved stayed 0 — no clamp)
- Minor: standing basket shows variety UUID prefix instead of name (see gap below)

### 5. Subscription generator + idempotency + substitution — **pass**
- Round-open auto-created exactly 1 box order per active subscription (subscription_orders=1, no duplicate on re-trigger) ✓
- pause/skip/cancel via UI ✓
- Substitution notice ✓ (simulated: sold-out variety → box filled from available + notify() fired with {lineUserId, box, totalSatang}; real LINE push needs live creds but trigger+payload path confirmed)

## Gaps

- truth: "Standing-order basket shows human-readable variety names, not raw ids"
  status: failed
  reason: "User reported: basket shows '6fb95842 ×20, 00de7524 ×20' — unreadable variety UUID prefixes"
  severity: minor
  test: 4
  root_cause: "web-admin/src/views/StandingOrders.vue varietyName() (line 70-71) falls back to id.slice(0,8) when varietyList lookup misses; the varieties list is not resolving these ids at render (data present, name lookup fails). Data itself is correct."
  artifacts:
    - path: "web-admin/src/views/StandingOrders.vue"
      issue: "varietyName fallback to UUID prefix (line 70-71); verify useVarieties populates before basketSummary renders"
  missing:
    - "Ensure the variety list is loaded/joined so standing baskets show names, not id.slice(0,8)"
  debug_session: ""

- truth: "Crop/harvest back-office views render date columns (plant date, projected harvest, harvested-at, best-before) without throwing"
  status: fixed
  fix: "Added web-admin/src/lib/date.ts fmtDate(Date|string|number) and routed PlantingBatches.vue + HarvestLog.vue (lines 54/59/183) through it. Verified in-browser: batch table renders all dates; harvest-log modal opens with 'ปลูก 2026-07-13'. typecheck green."
  reason: "CONFIRMED console error: 'b.plantDate.slice is not a function' at HarvestLog.vue:183 — reproduced by clicking บันทึกการเก็บเกี่ยว as owner"
  severity: major
  test: 2, 3
  root_cause: "Eden Treaty deserializes the API's timestamptz fields into runtime Date objects (NOT ISO strings), but the crop/harvest views call String.prototype.slice(0,10) on them. PlantingBatches.vue fmtDate() and HarvestLog.vue treat the values as strings — the code comment even asserts 'they arrive as ISO strings', which is false. Every server-sourced date .slice throws. Server data is clean (curl returns valid ISO); the mismatch is purely client-side Eden Date vs string-slice."
  artifacts:
    - path: "web-admin/src/views/HarvestLog.vue"
      issue: "lines 54 (harvestedAt), 59 (bestBefore), 183 (plantDate) call .slice on Eden Date objects"
    - path: "web-admin/src/views/PlantingBatches.vue"
      issue: "fmtDate = iso => iso.slice(0,10) (line 38) applied to server Date fields at 42/46/95"
  missing:
    - "Add a robust date formatter that accepts Date | string | number and coerces before slicing; use it for every server-sourced date in the crop/harvest views"
  debug_session: ""

- truth: "A render error in one back-office view is contained and recovers on navigation (no whole-app poisoning)"
  status: fixed
  fix: "web-admin/src/App.vue now watch(route.path) resets failed=false on navigation, so a caught error no longer persists across routes until a hard refresh."
  reason: "User reported: one view's error boundary persists across every other tab until a hard refresh"
  severity: major
  test: 2, 3
  root_cause: "web-admin/src/App.vue onErrorCaptured sets failed=true but never resets it on route change, so a single caught error permanently blanks the AppShell for all routes until a hard reload."
  artifacts:
    - path: "web-admin/src/App.vue"
      issue: "onErrorCaptured never clears failed on navigation (lines 14-18)"
  missing:
    - "Reset failed=false on route change (watch useRoute path) so client-side navigation recovers the shell"
  debug_session: ""

## How to verify

Run `/gsd-verify-work 03` and walk each item conversationally, or test manually and mark this file. Phase 03 is **not marked complete** until UAT passes.
