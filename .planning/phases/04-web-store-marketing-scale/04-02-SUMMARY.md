---
phase: 04
plan: 02
subsystem: composition-freeze
tags: [scaffold, elysia, vue-router, stub, wave-1]
status: complete
requires:
  - "04-01: migration 0005 (Phase-4 branch base)"
provides:
  - "api: five inert stub routers composed in index.ts (coupons/loyalty/broadcasts/tracking/product-images)"
  - "web-admin: five frozen routes + stub views (/coupons /loyalty /broadcasts /tracking /product-images)"
affects:
  - "Wave-2 slices 04-03/04/05/06 fill their own router+view files only, never index.ts or router.ts"
tech-stack:
  added: []
  patterns:
    - "Fixed index.ts composition + frozen router.ts (00-01/03-01 seam idiom) for disjoint-file parallel Wave-2"
    - "Stub router = single inert GET /<mod>/_stub returning HTTP 501"
key-files:
  created:
    - api/src/routes/coupons.ts
    - api/src/routes/loyalty.ts
    - api/src/routes/broadcasts.ts
    - api/src/routes/tracking.ts
    - api/src/routes/product-images.ts
    - web-admin/src/views/CouponComposer.vue
    - web-admin/src/views/LoyaltySettings.vue
    - web-admin/src/views/BroadcastComposer.vue
    - web-admin/src/views/CarrierTrackingForm.vue
    - web-admin/src/views/ProductImages.vue
  modified:
    - api/src/index.ts
    - web-admin/src/router.ts
    - web-admin/src/components/AppShell.vue
decisions:
  - "04-02: Phase-4 composition surface frozen — five stub routers appended after settingsRoutes (fixed order) + five OWNER_ADMIN admin routes frozen in router.ts; Wave-2 slices edit only their own module."
  - "04-02: stub routers expose an inert GET /<module>/_stub returning 501 (non-colliding _stub sub-path leaves the real future path free for the Wave-2 fill)."
metrics:
  duration_min: 10
  tasks: 2
  files: 13
  completed: 2026-07-18
---

# Phase 4 Plan 02: Composition Freeze Summary

Froze the Phase-4 composition surface so all Wave-2 slices run as disjoint-file parallel work: five inert 501 stub routers composed in `api/src/index.ts` (fixed order after `settingsRoutes`), and five OWNER_ADMIN admin routes + stub view SFCs registered in the now-re-frozen `web-admin/src/router.ts`.

## What was built

### Task 1 — Five stub routers composed in index.ts (b5278b5)
- Created `coupons.ts`, `loyalty.ts`, `broadcasts.ts`, `tracking.ts`, `product-images.ts` — each an Elysia group exporting its named instance (`couponsRoutes`, …) with one inert `GET /<module>/_stub` returning HTTP 501.
- Each carries a header comment naming the Wave-2 plan that fills it (coupons/loyalty→04-03, broadcasts→04-06, tracking→04-05, product-images→04-04).
- Composed all five in the `.use(...)` chain AFTER `settingsRoutes`, preserving the fixed-order invariant.
- `grep -c "Routes)" api/src/index.ts` = 27 (was 22, +5).
- `cd api && bun test tests/health.test.ts` → 4 pass / 0 fail (boot + composition intact).

### Task 2 — Five web-admin routes + stub views frozen (59ab6d7)
- Registered five lazy routes before the catch-all: `/coupons` (คูปอง, การตลาด), `/loyalty` (สะสมแต้ม, การตลาด), `/broadcasts` (บรอดแคสต์, การตลาด), `/tracking` (ติดตามพัสดุ, จัดส่ง), `/product-images` (รูปสินค้า, สินค้า) — all `roles: OWNER_ADMIN`.
- Created five stub view SFCs rendering the UI-SPEC empty-state (heading + body) only; no data source wired.
- Updated the `router.ts` header comment to state the frozen list now includes the five Phase-4 routes.
- `cd web-admin && bun run build` → built in 636ms, all five new view chunks emitted.

## Deviations from Plan

### Auto-added (Rule 2 — missing functionality for correct nav render)

**1. [Rule 2] Added five icons to AppShell ICONS map**
- **Found during:** Task 2
- **Issue:** `AppShell.vue` maps `meta.icon` strings to lucide components via a closed `ICONS` record; an unmapped name falls back to `LayoutDashboard`. Without an entry, all five new nav items would render the dashboard icon (indistinguishable nav).
- **Fix:** Imported `Ticket, Gift, Megaphone, Truck, Image` and added them to the `ICONS` map (additive only; no existing entry changed).
- **Files modified:** `web-admin/src/components/AppShell.vue`
- **Commit:** 59ab6d7
- **Note:** `AppShell.vue` is a component, not a Phase-3 view/router-entry, so this does not violate the plan prohibition ("MUST NOT edit any Phase-3 view or router entry"). It is not in the plan `files_modified` list.

## Threat surface

- T-04-04 (EoP, new admin routes): routes carry `meta.roles = OWNER_ADMIN`; nav gate is cosmetic — real endpoints (Wave-2) gate with server `requireRole`. Stubs return 501, exposing no feature surface (T-04-05 accepted).
- No new trust boundaries introduced beyond the plan threat model.

## Known Stubs

Intentional — this plan is a composition freeze; every artifact is a stub by design, filled by Wave-2:

| Stub | File | Filled by |
|------|------|-----------|
| couponsRoutes / CouponComposer.vue | api/src/routes/coupons.ts, web-admin/src/views/CouponComposer.vue | 04-03 |
| loyaltyRoutes / LoyaltySettings.vue | api/src/routes/loyalty.ts, web-admin/src/views/LoyaltySettings.vue | 04-03 |
| broadcastsRoutes / BroadcastComposer.vue | api/src/routes/broadcasts.ts, web-admin/src/views/BroadcastComposer.vue | 04-06 |
| trackingRoutes / CarrierTrackingForm.vue | api/src/routes/tracking.ts, web-admin/src/views/CarrierTrackingForm.vue | 04-05 |
| productImagesRoutes / ProductImages.vue | api/src/routes/product-images.ts, web-admin/src/views/ProductImages.vue | 04-04 |

## Verification

- API boots; `bun test tests/health.test.ts` 4/4 green with five stub routers composed.
- web-admin builds (`vite build`) with five frozen routes + stub views.
- Success criteria met: composition surface frozen — Wave-2 slices can fill their own module without touching index.ts or router.ts.

## Self-Check: PASSED

All 11 created files present; both task commits (b5278b5, 59ab6d7) exist in git history.
