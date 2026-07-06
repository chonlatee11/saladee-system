---
phase: 02-line-storefront-payments-delivery
plan: 05
subsystem: line-storefront
tags: [liff, vue, catalog, care-content, cart, ssr-test, tailwind-v4]

requires:
  - phase: 02-02
    provides: LIFF SPA shell (router with frozen paths, Eden treaty<App> client, design tokens, view stubs)
  - phase: 02-03
    provides: public GET /catalog care fields (storageTips/washingTips/deliveryClass) surfaced on variety payloads
provides:
  - "CatalogView (/): open-round browse via Eden client — has-items · per-item 'หมดรอบนี้' sold-out badge · 'รอบขายปิดชั่วคราว' empty · error; server-resolved ฿ prices"
  - "VarietyDetailView (/variety/:id): name/desc/photo + storageTips/washingTips care blocks (hidden when null, D-24) + add-to-cart CTA"
  - "CareView (/care): variety care-tips list from the public catalog"
  - "web/src/stores/cart.ts — reactive singleton cart holding server-shaped lines {roundId,varietyId,saleUnitId,qty} + boxLines {boxId,roundId,qty} (ids+qty only, T-02-17), sessionStorage-persisted — the 02-08 checkout hand-off"
  - "reusable SFCs: VarietyCard, QtyStepper (44x44 neutral), EmptyState"
  - "web/tests/vue-loader.ts + bunfig preload — a Bun @vue/compiler-sfc onLoad plugin so bun test can import & SSR-render .vue SFCs"
affects: [02-08, 02-09]

tech-stack:
  added: ["@vue/compiler-sfc@3.5.39 (web devDependency — promoted from transitive Vue dep for the bun-test SFC loader)"]
  patterns:
    - "Async data views: setup awaits an injectable `loader` prop (default = Eden api.catalog.get); the App.vue <Suspense> fallback owns the loading state, the screen owns has-items/sold-out/empty/error"
    - "Component tests run DOM-free via vue/server-renderer + a memory router; the loader is injected by prop (no module mock → no cross-file leakage), mirroring the 02-02 rule"
    - "Money DISPLAY-only on the client: ฿ = Math.round(unitPriceSatang/100) from server values; the cart carries no price/plants field"

key-files:
  created:
    - web/src/components/QtyStepper.vue
    - web/src/components/EmptyState.vue
    - web/src/components/VarietyCard.vue
    - web/src/stores/cart.ts
    - web/tests/catalog-view.test.ts
    - web/tests/vue-loader.ts
    - web/bunfig.toml
  modified:
    - web/src/views/CatalogView.vue
    - web/src/views/VarietyDetailView.vue
    - web/src/views/CareView.vue
    - web/package.json

key-decisions:
  - "Loading state is delivered by the existing App.vue <Suspense> fallback (02-02 shell pattern) because the views await data in async setup; each screen still owns has-items/sold-out/empty/error"
  - "VarietyDetailView reads the public /catalog and selects the variety by id — the api exposes no per-variety detail route, and /catalog already carries the D-24 care fields"
  - "Added a Bun SFC test loader (tests/vue-loader.ts, preloaded via bunfig.toml) so bun test can import .vue; @vue/compiler-sfc pinned as an explicit web devDependency so the preload resolves it (it is a first-party Vue package already in the lockfile, NOT a new external install)"
  - "cart.ts is a lightweight reactive module singleton (no Pinia) to keep the dependency count low (NFR-08); lines match OrderLineBody/BoxLineBody exactly"

requirements-completed: [LINE-02]

metrics:
  duration: ~6min
  completed: 2026-07-04
  tasks: 2
  files_created: 7
  files_modified: 4
  tests: "web suite 6 pass / 0 fail (4 new CatalogView SSR cases + 2 existing eden-types)"

status: complete
---

# Phase 2 Plan 05: LIFF Browse Surface (Catalog · Variety Detail · Care) Summary

**The first customer-facing web slice: the LINE LIFF catalog (`/`), variety detail with D-24 care content (`/variety/:id`), and care list (`/care`) — reading the open round from the Eden-typed public catalog, adding server-shaped packs to a sessionStorage-persisted cart store, and rendering every UI-SPEC state (loading via the shell Suspense, has-items, per-item sold-out, empty, error).** A real customer can now open the Rich Menu "สั่งผักรอบนี้", browse the round, view care tips, and add packs — the browse half of LINE-02 and the D-24 care UI.

## Performance
- **Duration:** ~6 min
- **Completed:** 2026-07-04
- **Tasks:** 2 (both `type=auto`)
- **Files:** 7 created, 4 modified

## Accomplishments

- **CatalogView (`/`, LINE-02):** async setup fetches the open round via the Eden `api.catalog.get()` client; renders a `VarietyCard` per variety with the server-resolved b2c ฿ price, a per-item `หมดรอบนี้` sold-out badge (destructive) for depleted rounds, the `รอบขายปิดชั่วคราว` no-open-round empty state, and the generic error state. Adding a pack calls the cart store.
- **VarietyDetailView (`/variety/:id`):** shows name/description/photo plus `storageTips` / `washingTips` care blocks, each **hidden when its field is null** (D-24); add-to-cart CTA (accent — the single primary action on this screen); error/not-found state. Reads `/catalog` and selects by id (no per-variety api route exists).
- **CareView (`/care`):** lists the round's varieties (those with care content) and their storage/washing tips from the public catalog.
- **cart.ts store:** a reactive module singleton holding `lines {roundId,varietyId,saleUnitId,qty}` and `boxLines {boxId,roundId,qty}` — the exact shapes `POST /orders` expects, **ids + qty only, never money** (T-02-17). `add/addBox/remove/removeBox/updateQty/clear` + a derived `lineCount`; sessionStorage-persisted so the 02-08 wizard survives navigation.
- **Reusable SFCs:** `QtyStepper` (full 44×44 hit areas, neutral ink/border — accent reserved), `EmptyState` (heading + body + action slot), `VarietyCard`.
- **DOM-free component test:** `web/tests/vue-loader.ts` registers a Bun `onLoad` plugin that compiles `.vue` SFCs with `@vue/compiler-sfc`; `catalog-view.test.ts` server-renders CatalogView (via `vue/server-renderer` + a memory router) with a mocked loader and asserts has-items, the sold-out badge, the empty state, and the error state.

## Task Commits
1. **Task 1 — Catalog + variety-detail views, reusable SFCs, cart store, SSR test** — `9c8ce47` (feat)
2. **Task 2 — Care list view** — `5b298f2` (feat)

## Verification
- `cd web && bun run build` → exits 0 (CatalogView/VarietyDetailView/QtyStepper chunks emitted).
- `cd web && bun test` → 6 pass / 0 fail (4 new CatalogView SSR cases + 2 existing eden-types).
- Acceptance greps: `หมดรอบนี้`=2 and `รอบขายปิดชั่วคราว`=2 in CatalogView.vue; `storageTips|washingTips`=7 in VarietyDetailView.vue; `saleUnitId|boxId`=4 in cart.ts; CareView imports the Eden client.

## Threat mitigations applied
- **T-02-17 (client cart carrying price/plants):** `cart.ts` stores ids + qty only; all money is display-only on the client and re-resolved server-side at `POST /orders`.
- **T-02-18 (XSS via care/description text in the LINE WebView):** all server-supplied text (name, description, storageTips, washingTips) is rendered via Vue text interpolation (auto-escaped); no `v-html` anywhere.

## Deviations from Plan

**1. [Rule 3 — Blocking] `cart.ts` created in Task 1 (plan assigned it to Task 2)**
- **Why:** `CatalogView` and `VarietyDetailView` import the cart store, so Task 1's `bun run build` acceptance could not pass without it.
- **Effect:** `cart.ts` landed in the Task 1 commit (`9c8ce47`); the Task 2 commit (`5b298f2`) then added only `CareView`. No scope change — both plan files exist and match the api line shapes.

**2. [Rule 3 — Blocking] Bun SFC test loader + `@vue/compiler-sfc` devDependency**
- **Issue:** `bun test` has no Vue plugin (unlike the Vite build), so `import CatalogView from "*.vue"` first resolved to an invalid component ("Invalid route component").
- **Fix:** Added `web/tests/vue-loader.ts` (a Bun `onLoad` hook compiling SFCs with `@vue/compiler-sfc`) and `web/bunfig.toml` (`[test] preload`). Promoted `@vue/compiler-sfc@3.5.39` from a transitive Vue dep to an explicit `web` devDependency so the preload can resolve it. **This is not a package-manager install of a new external package** — `@vue/compiler-sfc` is a first-party Vue package already present in the lockfile; it was pinned to the exact Vue version.
- **Files:** web/tests/vue-loader.ts, web/bunfig.toml, web/package.json, bun.lock — commit `9c8ce47`.

**3. [Note] Loading-state ownership**
- Async views await data in `setup`, so the loading state is delivered by the existing `App.vue <Suspense>` fallback (`กำลังโหลด…`, the 02-02 shell pattern for every route) rather than an in-screen skeleton. Each screen still owns has-items / sold-out / empty / error itself. `App.vue` was intentionally not modified (frozen by 02-02).

**4. [Note] Test directory**
- Placed the test at `web/tests/catalog-view.test.ts` (repo convention, consistent with 02-02/02-03) though the plan's verify string said `test/`. Ran as `bun test tests/catalog-view.test.ts`.

**Total deviations:** 4 (2 blocking, 2 notes). No architectural changes, no scope creep.

## Known Stubs
None in the delivered browse slice — all three views render live catalog data through the Eden client.

## Deferred Items
- **Box (mixed-box) browsing in the catalog UI.** The public `/catalog` returns a `boxes[]` surface and `cart.ts` already supports `addBox`/`boxLines`, but this slice renders single-variety packs only (the plan's browse scope). Rendering boxes in `CatalogView` is a straightforward follow-up (store + api already support it) — deferred to a later enhancement/checkout slice.
- **Sarabun woff2 binaries** (carried over from 02-02) — `web/public/fonts/sarabun-{400,600}.woff2` are still absent; the system-font fallback renders and the build stays green. Operator asset, not this plan.

## Self-Check: PASSED
- FOUND: web/src/components/{QtyStepper,EmptyState,VarietyCard}.vue
- FOUND: web/src/stores/cart.ts
- FOUND: web/src/views/{CatalogView,VarietyDetailView,CareView}.vue
- FOUND: web/tests/{catalog-view.test.ts,vue-loader.ts}, web/bunfig.toml
- FOUND commits: 9c8ce47 (task 1), 5b298f2 (task 2)
- VERIFIED: web build exit 0; web test 6 pass / 0 fail

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
