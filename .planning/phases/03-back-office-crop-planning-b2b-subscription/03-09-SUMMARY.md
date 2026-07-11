---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 09
subsystem: api
tags: [packing, pdfmake, sarabun, thai-pdf, tanstack-query, eden, rbac, vue]

# Dependency graph
requires:
  - phase: 03-01
    provides: packing.ts route stub + orders.packed_at + delivery snapshot columns
  - phase: 03-02
    provides: renderPackSlip/renderLabelSlip (pdfmake + Sarabun PdfPrinter spike, A1)
  - phase: 03-03
    provides: web-admin shell, router (packing route pre-registered), DataTable, session store, Eden api client
provides:
  - Packer-gated pack queue grouped by round -> route (deliveryMethod/deliveryZone, single indexed query, D-20)
  - Per-order mark-packed (orders.packed_at) endpoint
  - Thai (Sarabun) pack-slip + label-slip PDF endpoints (application/pdf, D-21)
  - web-admin Packing queue view + usePacking TanStack composables (Bearer-fetch PDF openers)
affects: [reports, ship, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nested group render (round -> route) frames per-route DataTables instead of one flat grid"
    - "Packer-gated PDFs fetched with Bearer -> Blob -> object URL (never a bare <a href> — auth header cannot ride a tab navigation)"
    - "Triple-slash /// <reference> pins an ambient .d.ts to its module so cross-package (vue-tsc) consumers load it"

key-files:
  created:
    - web-admin/src/composables/usePacking.ts
  modified:
    - web-admin/src/views/Packing.vue
    - api/src/pdf/pack-slip.ts
    - api/src/routes/packing.ts
    - api/tests/packing-queue.test.ts

key-decisions:
  - "Header 'พิมพ์ใบแพ็ค (PDF)' is the single filled accent per page (UI-SPEC); mark-packed is bordered, label-print a muted link"
  - "Pack slip is per-round (matches the queue filter); label slip is per-order"

patterns-established:
  - "Round selector above the queue drives an enabled-gated TanStack query"
  - "Mark-packed mutation invalidates ['packing','queue'] so the pack badge flips"

requirements-completed: [ORD-03, ADM-02]

coverage:
  - id: D1
    description: "Pack queue groups paid orders by round -> deliveryZone/method, excludes non-paid, ordered by (round_id, delivery_zone)"
    requirement: "ORD-03"
    verification:
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#GET /packing/queue groups paid orders by round → deliveryZone"
        status: pass
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#queue excludes non-paid orders"
        status: pass
    human_judgment: false
  - id: D2
    description: "PATCH /packing/:orderId/packed sets orders.packed_at; unknown order -> 404"
    requirement: "ORD-03"
    verification:
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#PATCH /packing/:orderId/packed sets packed_at"
        status: pass
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#PATCH unknown order → 404"
        status: pass
    human_judgment: false
  - id: D3
    description: "pack-slip.pdf + label-slip.pdf return application/pdf with a %PDF- Buffer"
    requirement: "ORD-03"
    verification:
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#GET /packing/pack-slip.pdf returns application/pdf + %PDF"
        status: pass
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#GET /packing/label-slip.pdf returns application/pdf + %PDF"
        status: pass
    human_judgment: false
  - id: D4
    description: "RBAC gate: owner/admin/packer pass; grower/customer 403; no token 401 (D-19 / T-03-23)"
    requirement: "ADM-02"
    verification:
      - kind: integration
        ref: "api/tests/packing-queue.test.ts#owner/admin/packer pass; grower/customer 403; no token 401"
        status: pass
    human_judgment: false
  - id: D5
    description: "web-admin Packing queue view: grouped round->route, pack badges, mark-packed action, pack/label PDF triggers, empty/error states"
    requirement: "ORD-03"
    verification:
      - kind: automated_ui
        ref: "web-admin: bunx vue-tsc --noEmit (exit 0) + bun run build (Packing chunk emitted)"
        status: pass
    human_judgment: true
    rationale: "Task 3 is a blocking checkpoint:human-verify — live-browser check that the Thai (Sarabun) PDF renders without tofu, queue grouping reads correctly, and mark-packed flips the badge is deferred to a human."

# Metrics
duration: 18min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 09: Packing Queue + Thai PDF Slips Summary

**Packer-gated pack queue grouped by round → delivery route, per-order mark-packed, and Thai (Sarabun) pack/label PDF downloads — API (Elysia + pdfmake) plus the web-admin Packing view wired via Eden + TanStack Query.**

## Performance

- **Duration:** ~18 min (resume-and-finish session)
- **Completed:** 2026-07-11
- **Tasks:** 2 executed this session (Task 1 API pre-committed by prior executor) + 1 deferred checkpoint
- **Files modified:** 3 (this session) / 5 (whole plan)

## Accomplishments
- Implemented `web-admin/src/views/Packing.vue`: round selector, paid orders grouped round → route, per-order รอแพ็ค/แพ็คแล้ว badge, "ทำเครื่องหมายว่าแพ็คแล้ว" action, "พิมพ์ใบแพ็ค (PDF)" (per round) + "ป้ายส่ง (PDF)" (per order), nothing-to-pack empty + error states (UI-SPEC copy).
- Finalized `web-admin/src/composables/usePacking.ts` (reviewed against the committed API contract — endpoints and shapes match; no changes needed).
- Fixed a cross-package typecheck regression: web-admin vue-tsc could not resolve pdfmake's untyped server entrypoints once `packing.ts` pulled `pack-slip.ts` into the Eden `App` graph.
- Full api `bun test` green (253 pass / 0 fail), including the 8-test packing-queue suite; web-admin vue-tsc exit 0 and production build succeeds.

## Task Commits

1. **Task 1 (RED): failing packing-queue test** - `8d15468` (test) — pre-committed by prior executor
2. **Task 1 (GREEN): packing.ts route + Thai pack/label PDF + mark-packed** - `fa079a1` (feat) — pre-committed by prior executor
3. **Task 2: web-admin packing queue view + usePacking composable** - `42a6a24` (feat)
4. **Rule 3 fix: pin pdfmake ambient decl to pack-slip** - `6ab2dbf` (fix)

## Files Created/Modified
- `web-admin/src/views/Packing.vue` - Packing queue view (grouped round→route, mark-packed, PDF triggers, states)
- `web-admin/src/composables/usePacking.ts` - TanStack queue query + mark-packed mutation + Bearer-fetch PDF openers
- `api/src/pdf/pack-slip.ts` - added triple-slash reference to the pdfmake ambient declaration
- `api/src/routes/packing.ts` - packer-gated queue/mark-packed/PDF endpoints (pre-committed)
- `api/tests/packing-queue.test.ts` - 8-test packing suite (pre-committed)

## Decisions Made
- Single filled accent per page = header "พิมพ์ใบแพ็ค (PDF)"; mark-packed bordered, label-print muted link (UI-SPEC one-primary rule).
- Router already pre-registered the `/packing` route (03-03 froze router.ts), so no router edit — view SFC only, as designed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pdfmake server-entrypoint types unresolved in web-admin vue-tsc**
- **Found during:** Task 2 (web-admin typecheck)
- **Issue:** `packing.ts` (03-09) is the first route to import `pack-slip.ts`'s builders, pulling that module into web-admin's Eden `App` type graph. web-admin's vue-tsc then type-checked `pack-slip.ts` transitively and reported `Cannot find module 'pdfmake/src/printer' | '/virtual-fs' | '/URLResolver'` — the ambient `api/src/pdf/pdfmake-printer.d.ts` (03-02) sits outside web-admin's tsconfig program, so it was never loaded.
- **Fix:** Added `/// <reference path="./pdfmake-printer.d.ts" />` to `pack-slip.ts` so the ambient module declarations travel WITH the file to every consumer's program (api tsc and web-admin vue-tsc alike).
- **Files modified:** api/src/pdf/pack-slip.ts
- **Verification:** `bunx vue-tsc --noEmit` exit 0; `bun run build` succeeds; full api `bun test` 253 pass / 0 fail (api behavior unchanged).
- **Committed in:** `6ab2dbf`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy Task 2's typecheck gate. One-line, type-only change; no runtime/scope impact.

## Issues Encountered
- The uncommitted `usePacking.ts` left by the prior executor was reviewed line-by-line against the committed `api/src/routes/packing.ts` — endpoint paths (`api.packing.queue.get`, `api.packing({orderId}).packed.patch`), the round selector query (`api.rounds.get`), and the Bearer-fetch PDF openers all match the server contract. No fix required.

## Deferred Verification (blocking checkpoint)
Task 3 (`checkpoint:human-verify`, gate=blocking) was NOT completed. Automated parts are green (build + full test suite). The live-browser checks remain for a human:
1. Login as packer/admin → "คิวแพ็ค" shows paid orders grouped by round → zone/method.
2. "พิมพ์ใบแพ็ค / ป้ายส่ง (PDF)" opens a Thai PDF that reads correctly (Sarabun, no tofu), print-safe.
3. "ทำเครื่องหมายว่าแพ็คแล้ว" flips the order's badge.
Resume signal: type "approved" or report the problem.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ORD-03 packing slice delivered end-to-end (pending human PDF sign-off).
- Reports (03-1x) and ship can consume the packing surface; the deferred human-verify should be cleared during phase UAT.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*


## Self-Check: PASSED
