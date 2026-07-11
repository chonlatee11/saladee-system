---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 04
subsystem: crop-planning
tags: [elysia, drizzle, forecast, crop, vue, tanstack-query, rbac, grower]

# Dependency graph
requires:
  - phase: 03-01
    provides: "planting_batches / planting_mix_templates / planting_mix_items tables + varieties yield columns (daysToHarvest/survivalPct/harvestWindowDays/shelfLifeDays) + composed crop.ts stub router"
  - phase: 03-03
    provides: "web-admin scaffold — Eden api client, DataTable.vue, session store, VueQueryPlugin, RBAC router with /variety-params /planting-mix /planting-batches routes + stub views"
  - phase: 01-commerce-core
    provides: "requireRole guard, issueSession, varieties table + public GET /varieties"
provides:
  - "forecast.ts PURE fns — projectedHarvestDate / forecastPlants (floor haircut D-02) / bestBefore (D-05); the compute kernel 03-05 publishQuota reuses"
  - "crop.ts service — createBatchesFromMix(tx, templateId, plantDate): all-or-nothing spawn + idempotent already-created guard (D-06)"
  - "crop.ts routes (grower-gated) — PUT variety params, planting-batch CRUD with server-computed harvest date + expected plants, mix-template CRUD, POST create-batches"
  - "web-admin crop views — VarietyParams / PlantingBatches / PlantingMix + useCrop.ts TanStack Query composables"
affects: [03-05-forecast-publish, 03-06-harvest-log]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure forecast kernel (no DB handle) so 03-05 publish reuses it + it unit-tests without a pool"
    - "Computed fields (harvest date / expected plants) derived on READ from variety params — never stored, so a param edit re-projects every batch"
    - "Mix→batch idempotency via (plantDate, template variety-set) overlap because planting_batches carries no template FK (frozen schema)"
    - "web-admin views fill 03-03 stub SFCs only — router.ts / DataTable / session frozen (conflict-free parallel slice)"

key-files:
  created:
    - api/src/services/forecast.ts
    - api/src/services/crop.ts
    - api/tests/forecast.test.ts
    - api/tests/crop.test.ts
    - web-admin/src/composables/useCrop.ts
  modified:
    - api/src/routes/crop.ts
    - web-admin/src/views/VarietyParams.vue
    - web-admin/src/views/PlantingBatches.vue
    - web-admin/src/views/PlantingMix.vue

key-decisions:
  - "forecast.ts uses UTC date arithmetic (getUTCDate/setUTCDate) so projected/best-before dates are timezone-stable across hosts/CI (deterministic tests)"
  - "planting-batch DELETE is a HARD delete (schema frozen — no active column on planting_batches); FK from harvest_logs surfaces as 409, batches otherwise only feed forecast compute"
  - "Mix create-batches idempotency detected by (plantDate + variety overlap) not a template FK (planting_batches has no templateId column in the frozen 03-01 schema)"
  - "Computed harvest date + expected plants are derived on read via forecast.ts, not persisted columns"

requirements-completed: [CROP-01, CROP-02, CROP-03, CROP-06, ADM-02]

# Coverage metadata
coverage:
  - id: D1
    description: "forecast pure fns compute projected harvest date / floored forecast plants (D-02) / best-before (D-05)"
    requirement: "CROP-03"
    verification:
      - kind: unit
        ref: "tests/forecast.test.ts — projectedHarvestDate(2026-07-06,45)=2026-08-20; forecastPlants(201,90)=180; bestBefore +shelf"
        status: pass
    human_judgment: false
  - id: D2
    description: "PUT variety params persists (CROP-01); POST planting-batch returns computed harvest date + expected plants (CROP-02/03); invalid body → 422"
    requirement: "CROP-01"
    verification:
      - kind: integration
        ref: "tests/crop.test.ts — PUT params round-trip + batch computed fields + survivalPct 150 → 422"
        status: pass
    human_judgment: false
  - id: D3
    description: "mix template → one-click create-batches spawns one batch per item all-or-nothing; re-run idempotent (already-created, no dup) (CROP-06 / D-06)"
    requirement: "CROP-06"
    verification:
      - kind: integration
        ref: "tests/crop.test.ts — create-batches spawns 2, re-run alreadyCreated=true, DB has exactly 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "crop routes grower-gated: no token → 401, customer → 403, grower/admin/owner → pass (ADM-02 / D-19 / T-03-07)"
    requirement: "ADM-02"
    verification:
      - kind: integration
        ref: "tests/crop.test.ts — RBAC gate 401/403/pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "web-admin crop views (variety params form, planting-batches table + modals, planting-mix recipe + one-click spawn) typecheck + build; states per UI-SPEC"
    requirement: "CROP-02"
    verification:
      - kind: automated_ui
        ref: "cd web-admin && bunx vue-tsc --noEmit && bun run build"
        status: pass
    human_judgment: false
  - id: D6
    description: "End-to-end crop planning: login grower → set params → create mix ~200/6 → one-click spawn → see harvest/yield → re-click already-created"
    requirement: "CROP-06"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify (gate=blocking) — web-admin :5174 + API :3000, per plan how-to-verify"
        status: unknown
    human_judgment: true
    rationale: "Live login + cross-origin grower session + one-click spawn round-trip against a running API needs a human in the loop; automated tests + typecheck + build cover the units and the API contract but not the live UI flow."

# Metrics
duration: ~35min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 04: Crop CRUD + Forecast Summary

**Grower-gated crop planning end-to-end — a pure forecast kernel (projected harvest date / floored yield haircut / best-before), an all-or-nothing mix→batch spawn with idempotent re-click, filled crop.ts routes, and three web-admin views (variety params, planting batches, planting mix) — API suite 222 pass / 0 fail, web-admin vue-tsc + build green.**

## Performance
- **Duration:** ~35 min
- **Completed:** 2026-07-07
- **Tasks:** 2 auto tasks done; Task 3 = human-verify checkpoint (deferred, gate=blocking)
- **Files created:** 5 · **Files modified:** 4

## Accomplishments
- `forecast.ts` — three PURE, DB-free, deterministic fns (`projectedHarvestDate`, `forecastPlants` floor haircut D-02, `bestBefore` D-05) with UTC date arithmetic; exported for 03-05 publish reuse and unit-tested.
- `crop.ts` service — `createBatchesFromMix(tx, templateId, plantDate)` spawns one batch per recipe item inside a transaction (all-or-nothing, mirrors varieties.ts) and no-ops with `alreadyCreated` on a re-click for the same week.
- `routes/crop.ts` — filled the 03-01 stub: PUT variety params, planting-batch CRUD (GET/POST/PATCH/DELETE) returning server-computed harvest date + expected plants, mix-template CRUD, and `POST /crop/mix-templates/:id/create-batches`. Every route `requireRole("owner","admin","grower")`; TypeBox per-route validation (uuid/Integer≥0/survival 0–100).
- web-admin: `useCrop.ts` TanStack Query composables (Eden + session Bearer, mutations invalidate keys) and three views — `VarietyParams.vue` (single-column 640 form + saved/validation), `PlantingBatches.vue` (DataTable + add/edit modals + destructive delete-confirm + empty), `PlantingMix.vue` (recipe cards + create/edit recipe + one-click `สร้างแบตช์จากสูตรปลูก` + already-created notice + empty). All Thai copy per UI-SPEC.

## Task Commits
1. **Task 1: forecast pure fns + crop service + grower-gated routes + tests** — `e0cbe0c` (feat)
2. **Task 2: web-admin crop views + useCrop composables** — `69ef0fb` (feat)
3. **Task 3: end-to-end crop planning** — checkpoint:human-verify (gate=blocking), deferred

## Files Created/Modified
- `api/src/services/forecast.ts` — pure forecast kernel (3 fns).
- `api/src/services/crop.ts` — mix→batch spawn + idempotency.
- `api/src/routes/crop.ts` — grower-gated crop CRUD (filled stub).
- `api/tests/forecast.test.ts` — CROP-03 pure compute (3 describe blocks).
- `api/tests/crop.test.ts` — route integration + mix idempotency + RBAC 401/403/pass.
- `web-admin/src/composables/useCrop.ts` — TanStack Query crop layer.
- `web-admin/src/views/{VarietyParams,PlantingBatches,PlantingMix}.vue` — filled crop screens.

## Decisions Made
- **UTC date arithmetic** in forecast.ts so derived dates are timezone-stable (CI-deterministic).
- **Computed fields derived on read** (harvest date / expected plants) from variety params via forecast.ts — never persisted, so a param edit re-projects every batch with no data migration.
- **Mix idempotency by (plantDate + variety overlap)** rather than a template FK — `planting_batches` has no `templateId` column in the frozen 03-01 schema.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Plan/Schema conflict] planting-batch DELETE is a hard delete, not soft-delete active=false**
- **Found during:** Task 1 (route implementation)
- **Issue:** The plan's action text says "DELETE planting-batches (soft-delete active=false)", but `planting_batches` in the frozen 03-01 schema has NO `active` column (only id/varietyId/plantDate/plantCount/bed/createdAt), and the plan mandates NOT touching schema.ts (append-only invariant already satisfied).
- **Fix:** Implemented a HARD delete. Batches only feed forecast compute (not orders), so removing an unharvested batch simply drops it from the projected quota. A batch already FK'd by a `harvest_logs` row raises a FK violation, caught and surfaced as `409 batch_has_harvest_log` (delete the lot first). Soft-delete of mix TEMPLATES uses their real `active` column as planned.
- **Files modified:** api/src/routes/crop.ts
- **Verification:** crop.test.ts delete path exercised via DELETE returning `{ deleted: true }`; full suite green.
- **Committed in:** e0cbe0c

**2. [Rule 2 - Missing critical] Added create/add flows the views need to be usable**
- **Found during:** Task 2 (views)
- **Issue:** The plan enumerates the view STATES (list/edit/table/empty) but the screens are unusable without a way to create the first record (a variety param has no batch to compute until one is added; a mix has no recipe until created).
- **Fix:** Added an add-batch modal (PlantingBatches) and a create/edit-recipe modal (PlantingMix) using the POST/PATCH endpoints already in scope — no new endpoints. Matches UI-SPEC states "edit recipe" and "list · edit".
- **Files modified:** web-admin/src/views/PlantingBatches.vue, web-admin/src/views/PlantingMix.vue
- **Verification:** vue-tsc + build green.
- **Committed in:** 69ef0fb

---
**Total deviations:** 2 auto-fixed (1 plan/schema conflict, 1 missing-critical). No scope creep — no new endpoints, schema untouched.

## Issues Encountered
None blocking. The shared test PG (:55432) was already up from prior plans; full suite 222 pass / 0 fail.

## Threat Surface
- **T-03-07 (Elevation — packer/customer on crop endpoints):** mitigated — every crop route carries `requireRole("owner","admin","grower")`; customer/no-token asserted 403/401 in crop.test.ts.
- **T-03-08 (Tampering — mix→batch half spawn):** mitigated — `createBatchesFromMix` runs inside `database.transaction` (all-or-nothing) + idempotent re-click guard.
- **T-03-09 (Input validation):** mitigated — TypeBox per-route (uuid, Integer≥0, survivalPct 0–100); invalid body → 422 (asserted).
- No new security surface beyond the plan's threat register.

## User Setup Required
None for the code. The Task-3 checkpoint needs a running API (:3000) and web-admin dev (:5174) with a seeded grower/admin account.

## Next Phase Readiness
- **forecast.ts is ready for 03-05** — `projectedHarvestDate` + `forecastPlants` are the exact kernel `computeDraftQuota`/publish will sum into `round_stock.quota_plants` (manual-override rows skipped per D-03).
- Schema untouched; reservation guard untouched.
- **PENDING human verification (Task 3, gate=blocking):** run `cd web-admin && bun run dev` (:5174) with API up, log in as grower, set variety params, create a ~200-plant/6-variety mix, click สร้างแบตช์จากสูตรปลูก, confirm harvest date + expected plants, re-click for the already-created notice. Automated tests + typecheck + build are green; the live UI round-trip is the only unverified item.

## Self-Check: PASSED
- Created files present: forecast.ts, crop.ts (service), forecast.test.ts, crop.test.ts, useCrop.ts; modified crop.ts route + 3 views.
- Commits found: e0cbe0c (Task 1), 69ef0fb (Task 2).
- Automated verification green: `bun test` 222/0, `vue-tsc --noEmit` ✓, `bun run build` ✓.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
