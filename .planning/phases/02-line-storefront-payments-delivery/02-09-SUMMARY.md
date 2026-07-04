---
phase: 02-line-storefront-payments-delivery
plan: 09
subsystem: line-storefront
tags: [me-orders, reorder, order-history, member-gate, reprice, vue, elysia, eden]
status: complete

# Dependency graph
requires:
  - phase: 02-01
    provides: orders/customers/order_lines schema + migration 0003, roundStock reserve counter
  - phase: 02-02
    provides: POST /auth/line customer session (line_user_id upsert), issueSession/verifySession, LIFF SPA router (frozen /orders + /orders/:id paths), Eden treaty<App> client
  - phase: 02-04
    provides: POST /orders checkout (member path, single-round order, frozen price snapshot on order_lines)
  - phase: 02-05
    provides: web cart store (useCart, ids+qty-only lines), EmptyState SFC, bun-test vue SFC loader
provides:
  - "GET /me/orders — member-only order history (status + summary), scoped by session customerId (never another customer's orders)"
  - "GET /me/orders/:id — one order (status + lines + delivery), 404 if not the caller's (IDOR-safe); the 02-07 Flex deep-link target"
  - "POST /me/orders/:id/reorder — proposed cart re-priced at the current open round (dated-today wins), per-item sold-out/absent flags; does NOT place an order (D-20)"
  - "web OrderHistoryView (/orders): guest login gate + member list + สั่งซ้ำ reorder + empty/error"
  - "web OrderDetailView (/orders/:id): live status + line summary + delivery"
  - "web/src/lib/reorder.ts (applyReorderToCart) + lib/order-status.ts (Thai status badges)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Member guard via beforeHandle: a per-request .derive resolves the session (HS256), the guard rejects non-customer/guest (no line_user_id) 403 and missing/invalid token 401; handlers then trust session.sub as the member customerId"
    - "Reorder reconstructs the pack by (varietyId, snapshot unitLabel) — sale units are variety-stable across rounds — then re-resolves price with the SAME dated-today-wins rule as orders.ts/catalog.ts; never reuses the frozen order_lines snapshot"
    - "Reorder→cart glue extracted to lib/reorder.ts so it is unit-testable DOM-free; views inject sessionToken/loader/reorderFn props (no module mock) mirroring the 02-05 CatalogView test"

key-files:
  created:
    - api/src/routes/me-orders.ts
    - web/src/lib/reorder.ts
    - web/src/lib/order-status.ts
  modified:
    - api/src/index.ts
    - api/tests/reorder.test.ts
    - web/src/views/OrderHistoryView.vue
    - web/src/views/OrderDetailView.vue
    - web/tests/order-history.test.ts

key-decisions:
  - "Reorder returns a PROPOSED cart (does not auto-place an order) — the customer confirms in the wizard; fully-available lines are added to cart.lines, flagged (sold-out/absent/no-price/retired-pack) items are surfaced via hasUnavailable but kept out of the cart (D-20)"
  - "Box lines are flagged 'box_review' rather than blind-duplicated — a box's BOM/availability can shift across rounds; variety reorder is the MVP customer loop, box reorder is a later enhancement"
  - "Target round for re-pricing = the original order's round when still open, else any open round that stocks the variety — matches 'currently selected open round' for the single-round-per-order model"
  - "Extracted the reorder→cart mapping + Thai status labels into web/src/lib/* so the logic is unit-testable without a DOM (not in the plan's files list — testability, Rule 3)"

requirements-completed: [CUST-04, LINE-02]

# Metrics
duration: ~6min
completed: 2026-07-04
tasks: 2
files_created: 3
files_modified: 5
tests: "api 184 pass / 0 fail (full suite, +2 reorder); web 12 pass / 0 fail (+6 order-history)"
---

# Phase 2 Plan 09: Member Order History + Reorder Summary

**The member-only customer loop: a logged-in member sees their own order history and re-orders in one tap — the reorder is RE-PRICED at the current open round (dated-today wins) with sold-out/absent items flagged, never a blind duplicate of the old snapshot. Guests are gated to a LINE login. Completes CUST-04 and the member surface of LINE-02.**

## Performance
- **Duration:** ~6 min
- **Started:** 2026-07-04T12:19:51Z
- **Completed:** 2026-07-04T12:25:20Z
- **Tasks:** 2 (both `type=auto`)
- **Files:** 3 created, 5 modified

## Accomplishments

**Task 1 — Member history + reorder API** — commit `c4ad012`
- `api/src/routes/me-orders.ts` (`makeMeOrdersRoutes(db)` DI + default export): three member-gated endpoints.
  - **Member guard (D-19):** a per-request `.derive` verifies the HS256 session; a `beforeHandle` rejects a non-customer session or a customer with no `line_user_id` (guest) with `403`, and a missing/invalid token with `401`. Keyed on `customers.line_user_id` (set by the 02-02 LINE login).
  - `GET /me/orders` — the member's own orders (status + subtotal/fee/total + createdAt), **scoped strictly by the session customerId** (T-02-33 IDOR — never all orders), newest first.
  - `GET /me/orders/:id` — one order (status + lines + delivery snapshot), `404` (not 403) when it is not the caller's order.
  - `POST /me/orders/:id/reorder` — reads the old order's lines, reconstructs each pack by `(varietyId, snapshot unitLabel)`, finds the current open round that stocks the variety (prefers the original round when still open), **RE-PRICES** with the dated-today-wins rule (same as orders.ts/catalog.ts), and returns a proposed cart plus per-item flags (`sold_out` / `absent_this_round` / `no_price` / `pack_unavailable` / `box_review`). Available lines go into `cart.lines`; flagged items are surfaced via `hasUnavailable` but kept out of the cart. It does **not** place an order (T-02-35 / D-20).
- Mounted `meOrdersRoutes` in `index.ts` via `.use(...)` (appended after `paymentsRoutes`; composition order preserved).
- `api/tests/reorder.test.ts`: (1) reorder re-prices A at a dated-today ฿75 override (differing from the frozen ฿50 snapshot) and flags B as `sold_out` (depleted round), keeping B out of the proposed cart; (2) history is scoped to the member, a guest (no `line_user_id`) is `403`, and a missing token is `401`.

**Task 2 — Order history + detail views** — commit `074381c`
- `web/src/views/OrderHistoryView.vue` (`/orders`): a guest (no session token) sees the **login gate** ("เข้าสู่ระบบเพื่อดูประวัติ" + "เข้าสู่ระบบด้วย LINE"); a member sees their orders with status badges and a per-order **"สั่งซ้ำ"** action. Empty → "ยังไม่มีคำสั่งซื้อ" + "สั่งผักรอบนี้"; error state; async data owned by the App.vue `<Suspense>` fallback. Reorder calls `POST /me/orders/:id/reorder`, loads the re-priced cart via `applyReorderToCart`, surfaces the D-20 warning, and routes to `/checkout`.
- `web/src/views/OrderDetailView.vue` (`/orders/:id`): the 02-07 Flex deep-link target — live status badge + line summary + subtotal/fee/total + recipient; guest-gate / not-found / error states.
- `web/src/lib/reorder.ts` (`applyReorderToCart` + `REORDER_UNAVAILABLE_MESSAGE`) and `web/src/lib/order-status.ts` (Thai status labels + badge classes) — extracted so the cart hand-off is unit-testable DOM-free.
- `web/tests/order-history.test.ts`: guest gate, member list + reorder CTA, empty, error (SSR), plus the reorder→cart hand-off (loads the proposed cart + surfaces the unavailable flag).

## Verification
- `cd api && bunx tsc --noEmit` → clean; `bun test tests/reorder.test.ts` → 2 pass / 0 fail; full api suite → **184 pass / 0 fail** (was 162 after 02-04; no regressions).
- `cd web && bun run build` → exits 0 (OrderHistoryView + OrderDetailView chunks emitted); `bun test tests/order-history.test.ts` → 6 pass; full web suite → **12 pass / 0 fail**.
- Acceptance greps: `/me/orders`≥1 and `reorder`≥1 and `line_user_id|lineUserId`≥1 in me-orders.ts; `เข้าสู่ระบบเพื่อดูประวัติ`=1, `ยังไม่มีคำสั่งซื้อ`=1, `สั่งซ้ำ`=3 in OrderHistoryView.vue.

## Threat mitigations applied
- **T-02-33 (IDOR — reading another customer's history):** every `/me/orders` query is scoped by the session `customerId`; `GET /me/orders/:id` returns `404` when the order is not theirs.
- **T-02-34 (guest accessing member-only surface):** the member guard rejects sessions without a `line_user_id` (403) and missing/invalid tokens (401).
- **T-02-35 (reorder charging the stale price):** reorder re-resolves the price at the current open round (dated-today-wins) and never replays the frozen `order_lines` snapshot; the snapshot is returned only as `oldUnitPriceSatang` for display.

## Deviations from Plan

**1. [Rule 3 — Testability] Extracted reorder→cart glue + status labels to web/src/lib/***
- **Why:** the plan's files list is OrderHistoryView/OrderDetailView + the test. To unit-test "reorder loads the cart and surfaces an unavailable flag" DOM-free (no click in SSR), the cart hand-off was extracted to `web/src/lib/reorder.ts` (`applyReorderToCart`) and the Thai status badges to `web/src/lib/order-status.ts`. The views import both.
- **Effect:** the acceptance test asserts the real code path; no behavior change. Both files are small pure modules.
- **Commit:** 074381c

**2. [Note] Test path convention (api/tests, web/tests)**
- Filled the existing Wave-0/02-02 scaffolds at `api/tests/reorder.test.ts` and `web/tests/order-history.test.ts` (repo convention), though the plan text wrote `api/test/` and `web/tests/`.

**Total deviations:** 1 testability extraction + 1 path note. No architectural changes, no scope creep.

## Known Stubs
None. All three endpoints run against the real schema; both views render live data through the Eden client (loaders injected only in tests).

## Deferred Items
- **Box (mixed-box) reorder.** Box lines are flagged `box_review` rather than re-added — a box's BOM/availability can shift across rounds. Variety reorder is the MVP customer loop; box reorder (re-validate BOM + re-price components at the current round) is a straightforward follow-up when box browse/checkout lands.
- **Payment-state detail on OrderDetailView.** The detail view surfaces the order `status` (which encodes awaiting_payment/paid/…); a richer per-payment breakdown (slip/verify state from the `payments` table) can be added when the pay/slip screens (02-08) are wired to the detail deep-link.

## Self-Check: PASSED
- FOUND: api/src/routes/me-orders.ts
- FOUND: web/src/lib/reorder.ts, web/src/lib/order-status.ts
- FOUND: web/src/views/OrderHistoryView.vue, web/src/views/OrderDetailView.vue
- FOUND: api/tests/reorder.test.ts, web/tests/order-history.test.ts
- FOUND commits: c4ad012 (Task 1), 074381c (Task 2)
- VERIFIED: api 184 pass / 0 fail; web build exit 0; web 12 pass / 0 fail

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
