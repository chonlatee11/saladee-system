---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 14
subsystem: web-liff, line-oa
tags: [rich-menu, liff, subscription, b2b, catalog, selected-state, ui-spec, uat-gap-closure]

# Dependency graph
requires:
  - phase: 03-08
    provides: "SubscriptionSignup.vue / B2bAccount.vue views + /subscription, /subscription/manage, /b2b routes in web/src/router.ts"
  - phase: 02-08
    provides: "DeliveryMethodTiles.vue — the APPROVED accent ring-2 + ✓ badge selected pattern (02-UI-SPEC reserved accent use #2)"
  - phase: 02-02
    provides: "Rich Menu provisioning script (provision-rich-menu.ts, idempotent delete-by-name + image pipeline) and the frozen LIFF route table"
provides:
  - "6-area Rich Menu definition: new bottom-left สมาชิกกล่องผัก → {liff}/subscription; bottom row now 3 cells (subscription / contact / care)"
  - "Catalog member quick-links row (/subscription + /b2b) rendered in EVERY screen state — the always-reachable in-LIFF entry points for SALE-03 + CUST-02"
  - "Unmistakable selected state on subscription signup: package tile ring-2 ring-accent + filled ✓ badge; frequency tile ring + font-semibold"
affects: [03-verification, 03-uat-rerun, operator-rich-menu-reprovision]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Entry-point rows live OUTSIDE the v-if state chain so they render in errored/empty/has-items alike (the catalog at / is the LIFF root + wildcard fallback — links there are always reachable)"
    - "Selected-tile treatment is copied from DeliveryMethodTiles verbatim (ring-2 ring-accent + fixed-footprint ✓ badge) — one approved pattern, no second variant"

key-files:
  created: []
  modified:
    - api/scripts/provision-rich-menu.ts
    - web/src/views/CatalogView.vue
    - web/src/views/SubscriptionSignup.vue
    - web/tests/catalog-view.test.ts
    - web/tests/subscription-view.test.ts

key-decisions:
  - "/b2b gets NO Rich Menu cell (niche audience) — the in-LIFF catalog quick-link covers CUST-02; noted in a comment beside the areas array"
  - "Quick-links use neutral ink+border styling, NOT accent — 02-UI-SPEC reserves the accent for the single primary action per screen (the sticky checkout CTA owns it on the catalog)"
  - "Frequency pills get ring + weight only (no ✓ badge) — the narrow flex-1 pills would crowd; plan named this the required minimum"
  - "Selected-state test preselects via the REAL module-singleton store (selectPackage) inside try/finally with clear() — no module mocking, no cross-test leak"

patterns-established:
  - "UAT discoverability gap closure = Rich Menu deep-link (operator re-provision) + in-app link (immediate, no image needed) covering the same route"

requirements-completed: [SALE-03, CUST-02]

coverage:
  - id: T-03-14-01
    description: "Information disclosure: channel access token stays env-only (env.LINE_CHANNEL_ACCESS_TOKEN), never a literal, never logged — task touched only request.areas + docblock"
    requirement: "SALE-03"
    verification:
      - kind: inspection
        ref: "api/scripts/provision-rich-menu.ts — client/blob construction unchanged (T-02-07 handling preserved)"
  - id: T-03-14-02
    description: "Elevation of privilege (accepted): /b2b link visible to all LIFF users only navigates; B2bAccount.vue + /me/b2b/* stay session-gated server-side (03-06/03-08)"
    requirement: "CUST-02"
    verification:
      - kind: integration
        ref: "api/tests/catalog.test.ts + api/tests/b2b-approval.test.ts (03-13 gate quartet, unchanged)"

user-setup:
  - "Operator: produce a NEW 6-cell 2500×1686 rich-menu image (top: สั่งผักรอบนี้ / ราคาผักรอบนี้ / ติดตามออเดอร์; bottom: สมาชิกกล่องผัก / ติดต่อร้าน / ความรู้เรื่องผัก) then run: cd api && LIFF_ID=<id> bun run scripts/provision-rich-menu.ts ./rich-menu.png — script re-provisions idempotently"

# Metrics
duration: 8min
completed: 2026-07-11
status: complete
---

# Phase 03 Plan 14: LIFF Subscription/B2B Entry Points + Selected-State (UAT Gaps #1/#2) Summary

**One-liner:** Rich Menu grows to 6 buttons (new สมาชิกกล่องผัก → /subscription), the catalog gains always-visible quick-links to /subscription and /b2b, and the signup's chosen package/frequency now carries the approved accent ring + ✓ badge — closing UAT gap #1 (major, test 6: SALE-03/CUST-02 unreachable) and gap #2 (minor: selection too subtle).

## What was built

### Task 1 — Rich Menu → 6 areas with a subscription deep-link (`fb217dd`)

- `api/scripts/provision-rich-menu.ts`:
  - `request.areas` restructured 5 → 6. Top row unchanged (สั่งผักรอบนี้ → liffBase x0 w833, ราคาผักรอบนี้ → /prices x833 w834, ติดตามออเดอร์ → /orders x1667 w833).
  - Bottom row becomes THREE cells at y843 h843: **สมาชิกกล่องผัก → `${liffBase}/subscription`** (x0 w833), ติดต่อร้าน → /contact (x833 w834), ความรู้เรื่องผัก → /care (x1667 w833). All six tile the 2500×1686 canvas with no overlap.
  - Comment beside the areas array records the deliberate /b2b omission (in-LIFF link covers it).
  - Header docblock updated: 6-button 3-top + 3-bottom grid; re-running needs a NEW 6-cell image. MENU_NAME, idempotent delete-by-name loop, resize/compress pipeline, and setDefaultRichMenu untouched.

### Task 2 — Catalog member quick-links (`96a29c7`)

- `web/src/views/CatalogView.vue`: a `<nav aria-label="ลิงก์สมาชิก">` row directly under the h1 and BEFORE the errored/empty/list branches — two flex-1 RouterLinks (`/subscription` สมาชิกกล่องผัก, `/b2b` ลูกค้าขายส่ง (B2B)), neutral `rounded-lg border border-border bg-white text-ink text-[15px] min-h-[44px]` styling per the 02-UI-SPEC accent reservation. Script comment cites UAT gap test 6 / SALE-03 / CUST-02.
- `web/tests/catalog-view.test.ts`: test router gains /subscription + /b2b routes; two new tests pin `href="/subscription"` + `href="/b2b"` in both the has-items and empty states (6 pass).

### Task 3 — Signup selected-state strengthening (`b47b30d`)

- `web/src/views/SubscriptionSignup.vue`:
  - Package tile selected class → `border-accent ring-2 ring-accent bg-accent/5`; header row gains a fixed-footprint 20px rounded-full ✓ badge (`border-accent bg-accent text-white` when selected, `border-border bg-white text-transparent` otherwise — layout never shifts), replicating DeliveryMethodTiles exactly. `aria-pressed` bindings kept.
  - Frequency tile selected class → `border-accent ring-2 ring-accent bg-accent/5 text-ink font-semibold`; no badge on the narrow pills.
- `web/tests/subscription-view.test.ts`: new test preselects package M via the real singleton store (try/finally + `clear()`), asserts `ring-accent`, the ✓ glyph, and exactly one `aria-pressed="true"` (8 pass).

## Verification

- `cd api && bun build scripts/provision-rich-menu.ts --target=bun` — exits 0; non-comment `bounds:` count = 6; `liffBase}/subscription` / `/contact` / `/care` each ≥ 1.
- `cd web && bun test tests/catalog-view.test.ts` — 6 pass / 0 fail (new href assertions included).
- `cd web && bun test tests/subscription-view.test.ts` — 8 pass / 0 fail; `grep -c "ring-accent"` = 2, `grep -c "✓"` = 3.
- `cd web && bun test` — full suite 33 pass / 0 fail across 7 files.
- `cd web && bun run build` — vite production build green.
- Live Rich Menu re-provisioning is an operator step (user_setup) verified during the UAT re-run.

## Deviations from Plan

None - plan executed exactly as written.

## Threat model dispositions

| Threat | Disposition | Where |
|--------|-------------|-------|
| T-03-14-01 info disclosure | mitigated | token still read only from `env.LINE_CHANNEL_ACCESS_TOKEN`; task changed areas + docblock only |
| T-03-14-02 elevation of privilege | accepted | /b2b link only navigates; server-side session gates (03-06/03-08, 03-13 catalog gate) unchanged |

## Commits

- `fb217dd` feat(03-14): extend Rich Menu to 6 areas with subscription deep-link
- `96a29c7` feat(03-14): add member quick-links (/subscription + /b2b) to catalog
- `b47b30d` feat(03-14): strengthen selected package/frequency state on signup

## Self-Check: PASSED
