---
phase: 04-web-store-marketing-scale
plan: 09
subsystem: ui
tags: [nuxt, vue, web-store, checkout, promptpay, coupon, loyalty, cloudflare-pages, eden-treaty]

# Dependency graph
requires:
  - phase: 04-08
    provides: Nuxt SSR web-store shell + catalog/product pages + useApi (Eden Treaty) + store @theme tokens
  - phase: 04-03
    provides: server-resolved coupon/points discount composed inside POST /orders (couponCode + redeemPoints contract)
  - phase: 02-08
    provides: LINE checkout wizard + PayView + SlipUploader flow mirrored here
provides:
  - Public guest web-store checkout (cart -> POST /orders -> GET /orders/:id/qr -> POST /orders/:id/slip), reusing existing endpoints unchanged
  - Web-store cart store (identifier-only, sessionStorage-mirrored)
  - CouponField + PointsRedeem web-store components (code/count only, server-resolved money)
  - Cloudflare Pages deploy job for the SSR store (D-29 hosting resolved)
affects: [web-store-marketing, ship, uat, seo-go-live]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Web-store cart is a module-level reactive singleton mirroring web/ cart verbatim (no Pinia); stores ONLY {roundId,varietyId,saleUnitId,qty}/{boxId,roundId,qty} — never money (T-04-29)"
    - "Guest web checkout reuses the SAME POST /orders guest path — no second reservation path (T-04-28); client sends couponCode CODE only, server resolves the discount + QR (04-03)"
    - "Checkout is CSR via routeRule ssr:false; SSR reserved for the crawlable catalog/product pages (SWR)"

key-files:
  created:
    - web-store/stores/cart.ts
    - web-store/pages/checkout.vue
    - web-store/components/CouponField.vue
    - web-store/components/PointsRedeem.vue
    - .github/workflows/deploy-web-store.yml
  modified:
    - web-store/pages/index.vue
    - web-store/pages/p/[id].vue
    - web-store/app.vue
    - web-store/nuxt.config.ts

key-decisions:
  - "Hosting = Cloudflare Pages (cloudflare-pages nitro preset) + a mirrored deploy job (D-29/D-30, resolved by owner 2026-07-17)"
  - "Web store has no LINE login wired yet -> every buyer is a guest: coupon works, points shows the log-in hint, redeemPoints never sent (T-04-31)"
  - "Checkout + pay collapsed into one CSR /checkout page (4 internal steps) — the store has no separate /pay route; slip upload + QR inlined, reusing the same endpoints"

patterns-established:
  - "PointsRedeem owns both the member redeem UI and the guest log-in hint (self-contained for the guest-default store)"
  - "Coupon 'applied' state is optimistic (code only); the real reduction shows as the discounted PromptPay QR amount (server-resolved)"

requirements-completed: [ORD-05]

coverage:
  - id: D1
    description: "Guest completes an oversell-safe web-store purchase end-to-end: cart -> POST /orders (guest path) -> PromptPay QR -> slip upload, reusing existing endpoints (no second reservation path)"
    requirement: "ORD-05"
    verification:
      - kind: automated
        ref: "cd web-store && bun run build (green)"
        status: pass
      - kind: manual_procedural
        ref: "04-09-PLAN.md checkpoint:human-verify — browse->checkout->pay->slip on a real bank app; confirm discounted QR amount + no oversell"
        status: unknown
    human_judgment: true
    rationale: "The end-to-end purchase requires a real bank app to scan/pay the PromptPay QR and a human to confirm the discounted amount and that stock never oversells — not automatable in build."
  - id: D2
    description: "Cart stores ONLY line identifiers + qty — never price/plants/money (T-04-29)"
    verification:
      - kind: other
        ref: "grep -Ei 'price|plants|money|satang' web-store/stores/cart.ts -> only comments, no data keys"
        status: pass
    human_judgment: false
  - id: D3
    description: "CouponField sends couponCode only; an arrival ?code= segment auto-applies (D-14)"
    requirement: "MKT-01"
    verification:
      - kind: other
        ref: "web-store/pages/checkout.vue buildOrderBody sends body.couponCode = code; readArrivalCode() prefills+auto-applies"
        status: pass
      - kind: manual_procedural
        ref: "04-09-PLAN.md UAT step 3 — apply a valid coupon, confirm the discount shows"
        status: unknown
    human_judgment: true
    rationale: "Coupon validity/discount is resolved server-side and only observable as the reduced QR amount — needs a live coupon + human confirmation."
  - id: D4
    description: "PointsRedeem is member-gated; a guest sees the log-in-to-earn hint and redeemPoints is never sent (T-04-31)"
    requirement: "CUST-03"
    verification:
      - kind: other
        ref: "web-store checkout: isMember=false -> PointsRedeem renders the hint; redeemPoints intentionally omitted from the order body"
        status: pass
    human_judgment: false
  - id: D5
    description: "Nuxt SSR hosting resolved to Cloudflare Pages + a mirrored deploy job (D-29/D-30)"
    verification:
      - kind: other
        ref: ".github/workflows/deploy-web-store.yml (pages deploy web-store/dist); nuxt.config nitro preset cloudflare-pages"
        status: pass
    human_judgment: false

# Metrics
duration: 30min
completed: 2026-07-18
status: complete
---

# Phase 4 Plan 9: Web Store Guest Checkout Summary

**Guest web-store checkout — cart -> POST /orders -> PromptPay QR -> slip upload reusing the existing order/reservation/payment endpoints unchanged, with server-resolved coupon + guest points hint, deployed to Cloudflare Pages.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-18
- **Tasks:** 1 auto (Task 1) + 1 resolved decision (hosting); 1 blocking human-verify UAT remaining
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- Web-store cart store mirroring web/ verbatim — identifier-only, sessionStorage-mirrored, no money (T-04-29).
- Guest checkout wizard (`checkout.vue`) reusing the EXISTING POST /orders guest path -> GET /orders/:id/qr -> POST /orders/:id/slip; no re-implemented reservation (T-04-28). Coupon + points fields (D-14). Build green.
- CouponField (sends couponCode only; arrival `?code=` auto-applies) + PointsRedeem (member-gated; guest sees the log-in-to-earn hint).
- Wired add-to-cart on the catalog + product pages (deferred from Plan 08) and a header cart link.
- Cloudflare Pages deploy job for the SSR store (D-29 hosting resolved).

## Task Commits

1. **Task 1: Cart store + guest checkout + coupon/points fields** - `96a8000` (feat)
2. **Checkpoint decision resolution: web-store Cloudflare Pages deploy job** - `07d2517` (ci)

## Files Created/Modified
- `web-store/stores/cart.ts` - identifier-only reactive-singleton cart, sessionStorage-mirrored (T-04-29)
- `web-store/pages/checkout.vue` - CSR guest wizard: cart review -> delivery+recipient+consent+coupon/points -> summary -> pay (QR + inline slip upload)
- `web-store/components/CouponField.vue` - coupon code entry (code only; arrival auto-apply)
- `web-store/components/PointsRedeem.vue` - member redeem UI + guest log-in hint
- `web-store/pages/index.vue` - add-to-cart wired to the cart store
- `web-store/pages/p/[id].vue` - add-to-cart wired to the cart store
- `web-store/app.vue` - header cart link with line count
- `web-store/nuxt.config.ts` - `/checkout` routeRule `ssr:false` (CSR)
- `.github/workflows/deploy-web-store.yml` - Cloudflare Pages deploy job (mirrors deploy-web.yml)

## Decisions Made
- Hosting resolved (pre-checkpoint) to Cloudflare Pages + cloudflare-pages nitro preset; added a mirrored deploy job.
- Since the store has no LINE login this plan, every buyer is a guest: coupon functional, points shows the hint, `redeemPoints` never sent.
- Collapsed checkout + pay into a single CSR `/checkout` page (the store has no separate `/pay` route) — same endpoints, QR + slip inlined.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired add-to-cart on the catalog + product pages + header cart link**
- **Found during:** Task 1
- **Issue:** Plan 08 left `onAdd` a no-op ("Cart wiring lands in Plan 09"); without it the cart never fills and the guest UAT (add item -> checkout) is impossible.
- **Fix:** Wired `onAdd` in `index.vue` and `p/[id].vue` to `useCart().add`, and added a header cart link (line count) routing to `/checkout`.
- **Files modified:** web-store/pages/index.vue, web-store/pages/p/[id].vue, web-store/app.vue
- **Verification:** build green; cart line count surfaces in the header
- **Committed in:** 96a8000

**2. [Rule 3 - Blocking] Checkout must be CSR**
- **Found during:** Task 1
- **Issue:** The cart is client sessionStorage state; SSR would render an empty cart and the checkout does live API round-trips.
- **Fix:** Added `routeRules "/checkout": { ssr: false }` (matches the D-29 CSR cart/checkout note).
- **Files modified:** web-store/nuxt.config.ts
- **Verification:** build green (checkout emitted as a client-only route)
- **Committed in:** 96a8000

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both required for a working, testable guest checkout. No scope creep — files stay within the web-store surface + the resolved-decision deploy job.

## Issues Encountered
None — build green on the first verification.

## Known Stubs
None that block the plan goal. The store has no LINE login yet (guest-only), so points redemption is intentionally deferred to a future member-linkage plan; coupon + the guest hint are fully wired.

## User Setup Required
- Set GitHub Actions vars `NUXT_PUBLIC_API_URL` (API origin) and `NUXT_PUBLIC_SITE_URL` (public store URL) for the deploy job.
- SEO go-live (D-06) still needs the real `.com` provisioned (Cloudflare Registrar) — deferred owner item; the store builds/UATs on the Pages preview URL.

## Next Phase Readiness
- Automated implementation complete and build-green.
- **Remaining:** the blocking `checkpoint:human-verify` UAT — a human must browse -> checkout as guest -> apply a coupon -> pay the PromptPay QR with a real bank app -> upload a slip, confirming the discounted amount and no oversell.

## Self-Check: PASSED

All created files present on disk; both task commits (`96a8000`, `07d2517`) in git history.

---
*Phase: 04-web-store-marketing-scale*
*Completed: 2026-07-18*
