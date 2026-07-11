---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 05
subsystem: crop-planning
tags: [elysia, drizzle, reservation, forecast, harvest, round-open, pg-boss, vue, tanstack-query, tdd]

# Dependency graph
requires:
  - phase: 03-01
    provides: "round_stock.is_manual_override column, harvest_logs table (UNIQUE batch_id), planting_batches, standing_orders/items, composed harvest.ts stub router"
  - phase: 03-04
    provides: "forecast.ts pure kernel (projectedHarvestDate / forecastPlants floor haircut / bestBefore) + planting-batches feeding the draft quota"
  - phase: 03-06
    provides: "reserveStanding(tx, roundId, items) — thin loop over guarded reserve(); overflow flag in-tx"
  - phase: 03-07
    provides: "pg-boss subscription-generate queue+worker (generateForRound); trigger deferred to this plan"
  - phase: 01-commerce-core
    provides: "guarded reserve()/reserveBox() oversell path, requireRole guard, issueSession, round_stock counter + CHECKs"
provides:
  - "computeDraftQuota(db, roundId) — batch→round Σ floor(plantCount × survival%) reusing the 03-04 kernel (D-02/07); pure read, feeds quota_plants only when published"
  - "publishQuota(db, roundId, trigger?) — THE round-open orchestrator (single owner of CUST-05 Success Criterion 3): one tx UPSERTs quota_plants (skips is_manual_override) → reserveStanding in-SAME-tx → post-commit boss.send('subscription-generate'); one-shot per round; re-publish re-syncs non-override quota, never re-reserves/re-triggers"
  - "logHarvest(db, batchId, actuals) — 1 batch = 1 lot; auto lotCode + best-before (harvestDate + shelfLifeDays); returns actual-vs-forecast delta (D-04, shown only)"
  - "routes/harvest.ts — grower-gated GET /harvest/calendar, POST /harvest/publish, PATCH /harvest/quota (manual override kept permanently), GET /harvest/logs (history + delta), POST /harvest/logs"
  - "web-admin HarvestCalendar + HarvestLog views + useHarvest.ts composables"
affects: [03-08-liff-subscription-b2b, phase-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Round-open orchestration is ONE tx (quota write + reserveStanding) + a SINGLE post-commit trigger — standing reserved before B2C is atomic (transactional priority, no race window), never a 2nd counter (Pitfall 1)"
    - "First-publish detection = round has no round_stock rows yet (quota never set); re-publish (rows exist) re-syncs non-override quota only — one-shot reserve+trigger per round"
    - "Manual override preserved via onConflictDoUpdate setWhere eq(isManualOverride,false) — a hand-set sellable qty is never clobbered by re-publish (D-03 / Pitfall 5)"
    - "publishQuota touches ONLY quota_plants; reserved_plants moves EXCLUSIVELY through the existing guarded reserve()/reserveStanding (T-03-11/T-03-20)"
    - "Injectable PublishTrigger (default = lazy dynamic-import boss.send) keeps pg-boss out of the test import graph while prod fires the real subscription-generate queue"
    - "1 batch = 1 lot via UNIQUE(batch_id): a 23505 on the second insert → LotAlreadyExistsError → route 409 (cause-chain walk for drizzle-wrapped errors)"

key-files:
  created:
    - api/src/services/harvest.ts
    - api/tests/forecast-publish.test.ts
    - api/tests/harvest-log.test.ts
    - web-admin/src/composables/useHarvest.ts
  modified:
    - api/src/routes/harvest.ts
    - web-admin/src/views/HarvestCalendar.vue
    - web-admin/src/views/HarvestLog.vue

key-decisions:
  - "publishQuota is the SINGLE OWNER of the open sequence: reserveStanding runs INSIDE the same tx as the quota write (standing reserved-before-B2C atomically), and boss.send('subscription-generate', {roundId}, {singletonKey: roundId}) fires ONCE AFTER commit — the box fill needs the round's published availability"
  - "First-publish (unpublished→published) detected by the round having zero round_stock rows; reserveStanding + subscription trigger are one-shot on that transition only, so a re-publish never double-reserves or re-triggers"
  - "Draft/round date match is equality on the projected harvest day (MVP per OQ2/A3); a harvest WINDOW range-match is deferred — recorded so a future slice can widen it"
  - "lotCode = `${varietySlug}-${plantDateISO}` (varieties has no code column; a slug of the name is used) — descriptive, uniqueness already guaranteed by UNIQUE(batch_id)"
  - "Manual override upsert (PATCH /harvest/quota) always wins and sets is_manual_override=true; the publish UPSERT uses setWhere to skip those rows — the two write paths coexist so Phase-1 manual entry survives permanently"

patterns-established:
  - "Round-open orchestrator: write quota + priority-reserve in one tx, fire recurring generator post-commit, guard the whole thing one-shot per round"
  - "Reserve-before-B2C proven end-to-end by racing the real reserve() after publish (B2C sees quota − standingReserved), not by mocking the reservation core"

requirements-completed: [CROP-03, CROP-04, CROP-05, INV-10, ADM-02, CUST-05]

# Coverage metadata
coverage:
  - id: D1
    description: "computeDraftQuota sums Σ floor(plantCount × survival%) of batches whose projected harvest date hits the round (D-02/07), excluding non-matching batches"
    requirement: "CROP-03"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#two same-variety batches whose projected date hits the round sum (floor each)"
        status: pass
    human_judgment: false
  - id: D2
    description: "publishQuota round-open orchestrator: writes quota + reserves standing IN ONE tx so B2C sees quota − standingReserved (reserve-before-B2C, no race window); the subscription-generate trigger fires exactly once, AFTER commit"
    requirement: "CUST-05"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#writes quota + reserves standing IN-TX so B2C sees quota − standingReserved; trigger fires post-commit"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-publish is one-shot: re-syncs non-override quota but never re-reserves nor re-triggers (idempotent round-open)"
    requirement: "CROP-04"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#re-publish is one-shot: re-syncs non-override quota but never re-reserves nor re-triggers"
        status: pass
    human_judgment: false
  - id: D4
    description: "Manual sellable-qty override (is_manual_override) is never clobbered by re-publish and persists permanently through the route PATCH → re-publish path (D-03 / Pitfall 5 / T-03-10)"
    requirement: "CROP-04"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#manual-override rows are never clobbered by re-publish; POST publish then PATCH quota override persists across re-publish"
        status: pass
    human_judgment: false
  - id: D5
    description: "publishQuota touches only quota_plants — reserved_plants moves exclusively via the guarded reserve() (no 2nd counter, no quota-reserved pre-check) (T-03-11/T-03-20)"
    requirement: "CUST-05"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#publishQuota touches only quota_plants — reserved_plants moves only via reserve()"
        status: pass
    human_judgment: false
  - id: D6
    description: "logHarvest: 1 batch = 1 lot; auto best-before = harvestedAt + shelfLifeDays, auto lotCode, actual-vs-forecast delta (both signs); a second log of the same batch is rejected (INV-10 / D-04/05)"
    requirement: "INV-10"
    verification:
      - kind: integration
        ref: "api/tests/harvest-log.test.ts#computes best-before…negative delta; positive delta…; a batch can be logged only once (UNIQUE)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Harvest routes grower/admin-gated (no token 401, customer 403, admin 200); POST /harvest/logs 201 then 409 duplicate; GET /harvest/logs history + delta (T-03-12 / CROP-05)"
    requirement: "ADM-02"
    verification:
      - kind: integration
        ref: "api/tests/forecast-publish.test.ts#harvest routes gate; api/tests/harvest-log.test.ts#POST /harvest/logs 201/409/403/401 + GET /harvest/logs history"
        status: pass
    human_judgment: false
  - id: D8
    description: "web-admin HarvestCalendar (round picker + draft/published/manual-override states + publish CTA + override modal) and HarvestLog (log form + auto lot/best-before + delta warning + logged history + empty) typecheck + build"
    requirement: "ADM-02"
    verification:
      - kind: automated_ui
        ref: "cd web-admin && bunx vue-tsc --noEmit && bun run build"
        status: pass
    human_judgment: false
  - id: D9
    description: "End-to-end live flow: admin reviews draft calendar → publishes → B2C catalog shows available = quota − (standing + subscription reserved) from the first view → manual override survives re-publish (reserved not double-counted) → log a harvest shows lot + best-before + delta"
    requirement: "CUST-05"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify (gate=blocking) — web-admin :5174 + API :3000 + seeded standing/subscription per plan how-to-verify"
        status: unknown
    human_judgment: true
    rationale: "The live browser publish → B2C catalog priority + subscription-generate worker firing post-publish + the visual delta/override UX require a running API + web-admin + LINE and a human in the loop. Automated integration tests prove reserve-before-B2C ordering, one-shot idempotency, override persistence, and lot/best-before/delta at the API level; the live end-to-end path is the only unverified item."

# Metrics
duration: ~45min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 05: Harvest Calendar Publish + Round-Open Orchestrator Summary

**`publishQuota` — THE round-open orchestrator that, in ONE transaction, writes each round's forecast sellable quota (skipping manual overrides) and reserves every active standing order through the EXISTING guarded `reserve()` so B2C can only ever see `quota − standingReserved` (reserved-before-B2C, no race window), then fires the `subscription-generate` queue exactly once post-commit — plus one-batch-one-lot harvest logging with auto lot/best-before + actual-vs-forecast delta, filled grower-gated routes, and two web-admin views. 12 new tests, full API suite 292 pass / 0 fail, web-admin vue-tsc + build green.**

## Performance
- **Duration:** ~45 min
- **Completed:** 2026-07-11
- **Tasks:** 2 auto tasks done (Task 1 TDD); Task 3 = human-verify checkpoint (deferred, gate=blocking)
- **Files created:** 4 · **Files modified:** 3

## Accomplishments
- `computeDraftQuota` — sums the 03-04 pure kernel (`forecastPlants` floor haircut) across every planting batch whose `projectedHarvestDate` hits the round's `harvestDate`, per variety. Pure read; the number is only written when an admin publishes (D-03 gate).
- `publishQuota` — the SINGLE OWNER of the open-round sequence (CUST-05 Success Criterion 3). In one `db.transaction`: UPSERTs `round_stock.quota_plants` via `round_stock_round_variety_idx` with `setWhere eq(isManualOverride,false)` (never clobbers a hand-set qty), then — on the FIRST publish only — reserves EVERY active standing order via `reserveStanding(tx, …)` in the SAME tx. AFTER commit it fires `boss.send("subscription-generate", {roundId}, {singletonKey: roundId})` exactly once. One-shot per round: a re-publish re-syncs non-override quota but never re-reserves or re-triggers. Touches ONLY `quota_plants` — `reserved_plants` moves exclusively through the guarded `reserve()` (no 2nd counter, Pitfall 1).
- `logHarvest` — 1 batch = 1 lot (UNIQUE batch_id): auto `lotCode` (`${varietySlug}-${plantDateISO}`) + auto `bestBefore` (harvestedAt + shelfLifeDays via the kernel), returns the actual-vs-forecast `delta` (D-04, shown only — never auto-tunes params). Second log of a batch → `LotAlreadyExistsError` → 409.
- `routes/harvest.ts` — filled the 03-01 stub, all `requireRole("owner","admin","grower")`: GET `/harvest/calendar` (draft/published/manual-override per variety), POST `/harvest/publish` (orchestrator trigger point), PATCH `/harvest/quota` (manual override, permanent), GET `/harvest/logs` (history + delta), POST `/harvest/logs`. Injectable `trigger` keeps pg-boss out of tests; the default instance uses the real `boss.send`.
- web-admin: `useHarvest.ts` (calendar/rounds/logs queries + publish/override/log mutations) and two views — `HarvestCalendar.vue` (round picker, draft warning / published positive / manual-override badges, one primary "เผยแพร่จำนวนขายรอบนี้", "แก้ไขจำนวนขายเอง" modal, publish-blocked copy) and `HarvestLog.vue` (log form with auto lot/best-before notice, delta warning badge with the D-04 copy, logged-history table, empty state). All Thai copy per UI-SPEC; one primary accent per view.

## Task Commits
1. **Task 1 (RED): failing round-open publish + harvest-log tests** — `1164e41` (test)
2. **Task 1 (GREEN): harvest service (publishQuota orchestrator) + routes** — `872ac02` (feat)
3. **Task 2: web-admin harvest calendar + log views (+ Rule-2 GET /harvest/logs)** — `b8c0298` (feat)
4. **Task 3: end-to-end publish gate + override + harvest log** — checkpoint:human-verify (gate=blocking), deferred

_Task 1 followed TDD: RED (`test`) → GREEN (`feat`); no REFACTOR needed._

## Files Created/Modified
- `api/src/services/harvest.ts` (new) — computeDraftQuota + publishQuota (round-open orchestrator) + logHarvest.
- `api/tests/forecast-publish.test.ts` (new) — draft sum, reserve-before-B2C, one-shot re-publish, override persistence, quota-only writes, RBAC.
- `api/tests/harvest-log.test.ts` (new) — lot/best-before/delta, 1-batch-1-lot UNIQUE, route 201/409/403/401, GET history.
- `web-admin/src/composables/useHarvest.ts` (new) — TanStack Query harvest layer.
- `api/src/routes/harvest.ts` — grower-gated harvest calendar/publish/override/logs (filled stub).
- `web-admin/src/views/HarvestCalendar.vue` / `HarvestLog.vue` — filled harvest screens.

## Decisions Made
- **publishQuota = single owner of the open sequence**: reserveStanding inside the quota-write tx (atomic reserve-before-B2C), subscription trigger once post-commit, one-shot per round.
- **First-publish detected by zero round_stock rows**; reserve + trigger only on that transition, so re-publish is a safe re-sync.
- **Date match = equality on the projected harvest day** (MVP, OQ2/A3); harvest-window range match deferred.
- **lotCode = varietySlug-plantDateISO** (no code column; UNIQUE(batch_id) is the real guard).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added grower-gated GET /harvest/logs (history + delta)**
- **Found during:** Task 2 (HarvestLog view)
- **Issue:** UI-SPEC requires the HarvestLog "logged history" state, but the plan's route list had only POST /harvest/logs — the view had no way to read confirmed lots or their delta.
- **Fix:** Added a staff/grower-gated `GET /harvest/logs` joining harvest_logs → planting_batches → varieties and returning each lot with its computed `expectedPlants` + `delta`. Read-only; no auto-tuning. Mirrors the 03-06 read-endpoint pattern (make the view usable with in-scope data).
- **Files modified:** api/src/routes/harvest.ts, api/tests/harvest-log.test.ts
- **Verification:** test asserts the logged row carries variety name + expectedPlants 90 + delta −5, and no-token → 401; full suite green.
- **Committed in:** `b8c0298`

---

**Total deviations:** 1 auto-fixed (1 missing-critical). No scope creep — a read endpoint required by the plan's own UI-SPEC state; the reservation guard, schema, and index.ts are untouched.

## Issues Encountered
None blocking. Biome flags ~17 `noUnusedImports/Variables` warnings on the two `.vue` files — a known Biome-vs-Vue-SFC limitation (it lints only the `<script>` block and cannot see `<template>` usage). The already-shipped `StandingOrders.vue` produces 12 of the same false positives; `vue-tsc --noEmit` + `bun run build` are the authority for Vue files and both pass clean.

## Threat Surface
- **T-03-10 (Tampering — publish clobbers manual override):** mitigated — `onConflictDoUpdate setWhere eq(isManualOverride,false)`; override-kept proven by service + route tests.
- **T-03-11 (Tampering — publish touches reserved/guard):** mitigated — publishQuota writes only `quota_plants`; reservation flows only through `reserve()/reserveStanding` (no import of release, no 2nd counter); full suite green (no oversell regression).
- **T-03-12 (Elevation — harvest endpoints):** mitigated — every route `requireRole("owner","admin","grower")`; 401/403/200 asserted.
- **T-03-20 (B2C races standing before priority):** mitigated — reserveStanding runs INSIDE the quota-write tx so B2C sees the quota only after commit (standing already reserved); subscription-generate fires immediately post-commit; one-shot proven by the re-publish test.
- No new security surface beyond the plan's threat register (the added GET is a grower-gated read).

## User Setup Required
None for the code. The Task-3 checkpoint needs a running API (:3000) + web-admin (:5174), a seeded round with a harvest date + due batches, at least one active standing order (03-06) and one active subscription (03-07) for the round.

## Next Phase Readiness
- **CROP-03/04/05, INV-10, CUST-05 (Success Criterion 3) delivered at the API + admin level.** publishQuota is now the wired round-open trigger for the 03-07 subscription generator (post-publish boss.send).
- Schema untouched; reservation guard untouched (`reserve()`/`reserveBox()` unchanged).
- **PENDING human verification (Task 3, gate=blocking):** with API + web-admin up and a round seeded with due batches + a standing order + an active subscription, log in as admin → review the draft calendar → เผยแพร่จำนวนขายรอบนี้ → confirm the B2C catalog shows `available = quota − (standing + subscription reserved)` from the first view → แก้ไขจำนวนขายเอง then re-publish and confirm the manual value survives and reserved is not double-counted → บันทึกการเก็บเกี่ยว and confirm the auto lot + best-before + delta. Automated tests + typecheck + build are green; the live end-to-end path is the only unverified item.

## Self-Check: PASSED
- All 4 created files present on disk; all 3 modified files updated.
- 3 task commits found in git log: `1164e41` (test), `872ac02` (feat), `b8c0298` (feat).
- Automated verification green: `bun test` 292 pass / 0 fail (12 new), `bunx tsc --noEmit` (api) clean, `bunx vue-tsc --noEmit` + `bun run build` (web-admin) clean, Biome clean on API files (Vue false positives noted).

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*
