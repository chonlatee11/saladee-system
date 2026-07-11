---
phase: 03-back-office-crop-planning-b2b-subscription
verified: 2026-07-11T12:26:59Z
status: human_needed
score: 8/12 gap-closure must-haves verified (phase-goal 5/5 ROADMAP SCs hold — regression green)
behavior_unverified: 4
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed:
    - "gap #4 (catalog b2b price leak) — GET /catalog + /catalog/rounds/:id now null the b2b tier unless approved-B2B session (03-13, behaviorally test-pinned)"
    - "gap #1 (LIFF subscription/B2B unreachable) — in-LIFF catalog quick-links to /subscription + /b2b, test-pinned (03-14 Task 2)"
    - "gap #2 (selected package too subtle) — ring-2 ring-accent + ✓ badge, test-pinned (03-14 Task 3)"
    - "gap #3 (standing basket raw UUID) — reactive customerLabel/basketLabel join, typecheck+build green (03-15)"
    - "prior warning (catalog b2b wholesale exposure) — RESOLVED by 03-13; deferred-items.md struck through"
  gaps_remaining: []
  regressions: []
gaps: []
behavior_unverified_items:
  - truth: "A LINE customer can reach subscription sign-up from a Rich Menu สมาชิกกล่องผัก button that deep-links {liff}/subscription"
    test: "Operator regenerates the 6-cell 2500×1686 rich-menu PNG, then runs: cd api && LIFF_ID=<id> LINE_CHANNEL_ACCESS_TOKEN=<tok> bun run scripts/provision-rich-menu.ts ./rich-menu.png; open the LINE OA and tap the new bottom-left button"
    expected: "The 6-button menu publishes idempotently; the สมาชิกกล่องผัก cell opens {liff}/subscription in the LIFF"
    why_human: "Live re-provision against LINE requires channel credentials + a new menu image; Claude updated the script (compiles, 6 bounds tile the canvas) but cannot execute it or observe the LINE client"
  - truth: "Standing-orders basket column shows human-readable variety names (e.g. กรีนโอ๊ค ×20) after the varieties query resolves — never a frozen UUID prefix"
    test: "Open web-admin → Standing Orders with the dev seed; watch the ตะกร้าประจำรอบ column"
    expected: "Rows show variety names (กรีนโอ๊ค ×20, เรดโอ๊ค ×10) and customer names; any transient id-prefix updates in place once the lookup queries arrive"
    why_human: "Reactive re-render on async TanStack-Query resolution; web-admin has no automated StandingOrders test — code is the correct reactive join but the resolution behavior is not test-exercised (plan defers to UAT walk)"
  - truth: "The standing-orders customer column shows the customer name once the customers query resolves"
    test: "Same view; watch the ลูกค้า column"
    expected: "Customer names render (not id.slice fallback) after data loads"
    why_human: "Same async-resolution reactivity, no automated test"
  - truth: "Name resolution is reactive: rows rendered before the lookup lists finish loading update in place when they arrive"
    test: "Reload Standing Orders on a cold cache and observe cells during the load"
    expected: "Any id-prefix placeholder is replaced by the real name in place (no frozen prefix, no manual refresh)"
    why_human: "State transition on query settle; not covered by any test"
human_verification:
  - test: "Operator rich-menu re-provision + on-device check (03-14 user_setup, gap #1)"
    expected: "New 6-cell menu image produced; provision-rich-menu.ts run with real LIFF_ID + channel token; the สมาชิกกล่องผัก button appears in LINE and deep-links {liff}/subscription"
    why_human: "Uncompletable by Claude — needs LINE channel credentials, a new menu image, and observation of the live LINE client"
  - test: "LIFF discoverability re-walk on device (03-14 Task 2, gap #1 test 6)"
    expected: "Opening the LIFF catalog at / shows tappable quick-links to /subscription (สมาชิกกล่องผัก) and /b2b (ลูกค้าขายส่ง) in every state — reachable without a hand-built deep link"
    why_human: "Code + view-test verified (href assertions pass), but the original gap was found live on mobile; confirm on the real LINE in-app browser"
  - test: "Subscription selected-state obvious on mobile (03-14 Task 3, gap #2 test 6)"
    expected: "The chosen package tile shows an accent ring + filled ✓ badge and the chosen frequency an accent ring — unmistakable on a phone"
    why_human: "Mechanism is test-pinned (ring-accent + ✓ + single aria-pressed), but 'obvious on mobile' is a visual judgment the user reported live"
  - test: "Standing-orders readable names re-walk (03-15, gap #3 test 4)"
    expected: "web-admin Standing Orders basket + customer columns show names, not UUID prefixes, and update in place as data loads"
    why_human: "Reactive async-resolution render with no automated web-admin test"
---

# Phase 3: Back-office, Crop Planning & B2B/Subscription — Verification Report (gap-closure re-verify)

**Phase Goal:** The farm runs operations from the back-office — crop plans forecast harvests that auto-feed sellable quantities, B2B quota and standing orders are guaranteed, subscriptions auto-generate, and staff manage packing, dashboards, and reports by role.
**Verified:** 2026-07-11T12:26:59Z
**Status:** human_needed
**Re-verification:** Yes — after UAT gap closure (plans 03-13, 03-14, 03-15)

## Goal Achievement

The phase goal was already verified in code and **live-walked 10/10 in the 03-UAT.md run**.
This re-verification confirms the four UAT gaps found during that walk are now closed:

- **gap #4** (catalog leaks wholesale b2b price) → **03-13**, closed and *behaviorally test-pinned*.
- **gap #1** (LIFF /subscription + /b2b unreachable) → **03-14**, in-app catalog links closed and test-pinned; a Rich Menu button was added in the script but its LIVE publication is an operator step.
- **gap #2** (selected package too subtle) → **03-14**, ring + ✓ badge, test-pinned.
- **gap #3** (standing basket raw UUID) → **03-15**, reactive name join; typecheck+build green, no automated test (deferred to UAT walk).

Two earlier UAT gaps (`web-admin date.ts` fmtDate crash, `App.vue` error-boundary reset)
were already fixed and re-verified in the UAT walk itself; they are not re-litigated here.

The prior verification's single **warning** (public catalog wholesale exposure) is now
**RESOLVED** by 03-13 and struck through in `deferred-items.md`.

### ROADMAP Success Criteria (phase goal) — regression check

All 5 ROADMAP SCs from the initial verification remain VERIFIED. The gap-closure run touched
only catalog price shaping, two LIFF views, the rich-menu script, and one web-admin view; the
full automated suites are green with **no regressions**.

| Suite | Result |
|-------|--------|
| api `bun test` (full) | 303 pass / 0 fail, 54 files, 15.4s |
| web `bun test` (full) | 33 pass / 0 fail, 7 files |
| web build (`vite build`) | ✓ built 523ms |
| web-admin `vue-tsc --noEmit` + build | ✓ typecheck clean, built 584ms |

### Gap-closure Observable Truths

| # | Plan / Gap | Truth | Status | Evidence |
|---|-----------|-------|--------|----------|
| 1 | 03-13 / #4 | Anonymous `GET /catalog` → every `prices.b2b`/`priceSatang.b2b` is null | ✓ VERIFIED | `catalog.ts:125,310` gate on `showB2b`; `catalog.test.ts` "anonymous caller gets prices.b2b === null" passes |
| 2 | 03-13 / #4 | `GET /catalog/rounds/:id` applies the same gate | ✓ VERIFIED | `catalog.ts:336-388` threads `showB2b` into `roundEntry`; test "…applies the same gate" passes |
| 3 | 03-13 / #4 | Approved-B2B customer session sees the wholesale tier | ✓ VERIFIED | `showB2bFor` = role==customer && `wholesaleVisible`; test "approved-B2B customer session sees the resolved wholesale tier" passes |
| 4 | 03-13 / #4 | Pending/rejected/B2C/forged → b2b null (fail-closed) | ✓ VERIFIED | `.derive` verifySession→null on throw; tests "pending…null", "forged…fails closed" pass |
| 5 | 03-13 / #4 | `/me/b2b/prices` untouched, still serves gated wholesale | ✓ VERIFIED | `b2b-approval.test.ts` unchanged; 21 pass across catalog+b2b-approval |
| 6 | 03-14 / #1 | Rich Menu สมาชิกกล่องผัก button deep-links {liff}/subscription | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Script has 6 bounds tiling 2500×1686 (0/833/1667 ×843/843), `${liffBase}/subscription` present, compiles — but LIVE publish is an operator step (user_setup) |
| 7 | 03-14 / #1 | Customer reaches /subscription AND /b2b from in-LIFF catalog links | ✓ VERIFIED | `CatalogView.vue:58` `<nav>` OUTSIDE the v-if chain; `catalog-view.test.ts` href="/subscription"+"/b2b" pass |
| 8 | 03-14 / #2 | Selected package obvious: accent ring + ✓ badge | ✓ VERIFIED | `SubscriptionSignup.vue:178-195` ring-2 ring-accent + fixed-footprint ✓; `subscription-view.test.ts` pins ring-accent + ✓ + single aria-pressed |
| 9 | 03-14 / #2 | Selected frequency carries the same ring treatment | ✓ VERIFIED | `SubscriptionSignup.vue:213-214` ring-2 ring-accent + font-semibold; grep ring-accent=2 |
| 10 | 03-15 / #3 | Standing basket column shows variety names, not UUID | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `StandingOrders.vue:86-97` basketLabel joined into reactive `rows`, column `accessorKey:"basketLabel"` — correct reactive fix, but no web-admin test exercises async resolution |
| 11 | 03-15 / #3 | Customer column shows the customer name | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `customerLabel` join + `accessorKey:"customerLabel"`; same untested async-resolution reactivity |
| 12 | 03-15 / #3 | Name resolution reactive: rows update in place when lookups arrive | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | computed reads `varieties.value`/`customers.value` → new row array invalidates TanStack per-row cache; state-transition behavior, no test |

**Score:** 8/12 gap-closure truths verified, 4 present-behavior-unverified (routed to live re-walk). Phase-goal 5/5 ROADMAP SCs hold under regression.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/src/routes/catalog.ts` | session-aware b2b gate on both GET endpoints | ✓ VERIFIED | `bearer` + `.derive` optional session; `showB2bFor` reuses `wholesaleVisible`; b2b keys nulled not removed (grep b2b:=…, shape preserved) |
| `api/tests/catalog.test.ts` | anonymous/approved/pending/forged + /rounds/:id cases | ✓ VERIFIED | Gate describe block present; 21 pass with b2b-approval |
| `api/scripts/provision-rich-menu.ts` | 6-area menu incl. subscription button | ✓ VERIFIED (code) | 6 bounds tile the canvas; /subscription,/contact,/care all present; compiles. LIVE publish deferred to operator |
| `web/src/views/CatalogView.vue` | member quick-links row (sub + B2B) | ✓ VERIFIED | nav outside v-if chain; both RouterLinks |
| `web/src/views/SubscriptionSignup.vue` | ring + ✓ selected state | ✓ VERIFIED | package + frequency tiles; test-pinned |
| `web-admin/src/views/StandingOrders.vue` | reactive name join | ✓ VERIFIED (structure) | DisplayRow + labels in reactive rows + accessorKey; typecheck+build green; render behavior untested |
| `deferred-items.md` | catalog exposure marked resolved | ✓ VERIFIED | struck through + "Resolved 2026-07-11 by 03-13"; vue-tsc bullet intact |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Catalog b2b gate (anonymous null / approved sees / forged closed) | `bun test tests/catalog.test.ts tests/b2b-approval.test.ts` | 21 pass / 0 fail | ✓ PASS |
| Full API suite (regression) | `bun test` | 303 pass / 0 fail | ✓ PASS |
| LIFF catalog links + signup selected-state | `bun test tests/catalog-view.test.ts tests/subscription-view.test.ts` | 14 pass / 0 fail | ✓ PASS |
| web full suite (regression) | `bun test` | 33 pass / 0 fail | ✓ PASS |
| Rich-menu script compiles | `bun build scripts/provision-rich-menu.ts --target=bun` | 0.54 MB entry, exit 0 | ✓ PASS |
| web-admin typecheck + build | `vue-tsc --noEmit && vite build` | clean + built 584ms | ✓ PASS |
| Standing-orders reactive name render | — | no automated test; live UAT re-walk | ? SKIP → human |
| Rich-menu live publish + LINE-client button | — | operator credentials + device | ? SKIP → human |

### Requirements Coverage (gap-closure scope)

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CUST-02 | B2C/B2B split, B2B sees wholesale price | ✓ SATISFIED | 03-13 catalog gate (behavioral) + 03-14 /b2b entry; REQUIREMENTS.md line 67, Phase 3 Complete |
| CUST-05 | B2B standing order, forecast quota reserved before B2C | ✓ SATISFIED (display) | 03-15 readable basket names on the D-09 staff surface; reserve-before-B2C already verified initially; REQUIREMENTS.md line 70 |
| SALE-03 | Subscription box: auto-generate + pause/skip/cancel | ✓ SATISFIED (discovery) | 03-14 subscription entry points; generator verified initially; REQUIREMENTS.md line 38 |

All 16 phase requirement IDs (INV-10, SALE-03, ORD-03, CUST-02, CUST-05, MKT-02, MKT-04,
ADM-01/02/03, CROP-01..06) were SATISFIED in the initial verification and remain so under
regression. This gap-closure run touched only CUST-02, CUST-05, SALE-03; none are orphaned —
all three appear in the plan frontmatter and in REQUIREMENTS.md (marked Phase 3 / Complete).

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | none | — | No debt markers (TBD/FIXME/XXX), no stub returns, no placeholder views introduced by 03-13/14/15. The `id.slice(0,8)` in StandingOrders is the plan-specified transient fallback while lookups load, not a stub. |

Prior warning (catalog wholesale exposure) is **resolved** — no longer carried.

### Human Verification Required

Status is `human_needed` because of one uncompletable operator step and three
live-UI/async-render behaviors best re-confirmed on the device UAT re-walk:

1. **Operator rich-menu re-provision** — regenerate the 6-cell menu image, run
   `provision-rich-menu.ts` with real LIFF_ID + channel token, confirm the สมาชิกกล่องผัก
   button in the LINE client (code ready; Claude cannot run it).
2. **LIFF discoverability** — on the real LINE in-app browser, confirm the catalog
   quick-links to /subscription and /b2b are visible and tappable (code + test verified;
   re-confirm live since the gap was found on mobile).
3. **Subscription selected-state** — confirm the ring + ✓ makes the chosen package/frequency
   obvious on a phone (mechanism test-pinned; visual judgment).
4. **Standing-orders readable names** — confirm web-admin basket/customer columns render names
   (not UUID prefixes) and update in place as data loads (no automated test).

### Gaps Summary

No FAILED truths, no missing/stub artifacts, no broken links, no regressions. All four UAT
gaps are closed in code: gap #4 is fully behaviorally test-pinned (VERIFIED); gaps #1/#2 have
code + view-test coverage plus one operator-only live step; gap #3 is the structurally-correct
reactive fix but its async render behavior has no web-admin test. Because a genuine operator
action remains and several closures are live-UI/async-render behaviors without automated
coverage, the phase lands at **human_needed** — the automated surface is fully green
(303/0 api, 33/0 web, both builds + web-admin typecheck), so a short device re-walk of the
four items above completes sign-off.

---

_Verified: 2026-07-11T12:26:59Z_
_Verifier: Claude (gsd-verifier)_
