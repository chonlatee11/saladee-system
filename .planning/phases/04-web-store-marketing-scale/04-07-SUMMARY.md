---
phase: 04-web-store-marketing-scale
plan: 07
subsystem: crop-planning
tags: [CROP-07, demand-recommendation, forecast-inverse, planting-mix]
requires:
  - "forecast.ts forecastPlants (survival-haircut authority, 03-04)"
  - "reports.ts whereFrag parameterized-sql idiom (03-11)"
  - "back_in_stock_requests table (INV-08, 03-xx)"
  - "planting-mix templates + editor (CROP-06, 03-04)"
provides:
  - "plantsToMeetDemand pure inverse kernel (ceil survival haircut)"
  - "computeDemandRecommendation trailing-demand aggregate"
  - "GET /crop/planting-recommendation (owner|admin|grower)"
  - "PlantingRecommendationCard prefill in PlantingMix.vue"
affects:
  - api/src/routes/crop.ts
  - web-admin/src/views/PlantingMix.vue
tech-stack:
  added: []
  patterns:
    - "Inverse-forecast kernel reuses forecast.ts survival authority (never a new yield formula)"
    - "Trailing-demand aggregate = realised sales (SOLD_STATUSES) + unmet demand (back-in-stock), parameterized sql only"
    - "Recommendation prefills a NEW recipe editor — admin overrides + confirms before save (D-25)"
key-files:
  created:
    - api/src/services/crop-recommend.ts
    - api/tests/crop-recommend.test.ts
  modified:
    - api/src/routes/crop.ts
    - web-admin/src/views/PlantingMix.vue
    - web-admin/src/composables/useCrop.ts
decisions:
  - "N-round trailing window (DEFAULT_N_ROUNDS=4) configurable via ?nRounds query (D-23)"
  - "Unmet-demand heuristic DEFAULT_PLANTS_PER_REQUEST=2 (one pack-equivalent), configurable (A6/D-23)"
  - "no-data flag when availableRounds < nRounds → drives the 'ข้อมูลดีมานด์ยังไม่พอ' UI state"
metrics:
  duration: ~5 min
  completed: 2026-07-18
  tasks: 2
  files: 5
status: complete
---

# Phase 4 Plan 7: Demand-Driven Planting Recommendation Summary

Demand-driven per-variety planting recommendation (CROP-07): trailing realised sales PLUS unmet demand (back-in-stock requests) run through the inverse of the Phase-3 forecast kernel, surfaced on-demand as a role-gated endpoint and a card that prefills the existing planting-mix editor with full admin override.

## What was built

**Task 1 — kernel + aggregate + endpoint (TDD, RED→GREEN):**
- `crop-recommend.ts`:
  - `plantsToMeetDemand(demandPlants, survivalPct) = ceil(demandPlants * 100 / survivalPct)` — the arithmetic inverse of `forecast.ts` `forecastPlants` (floor haircut). Pure, DB-free. Rounds UP so a round never plants too few after the survival haircut; guards demand≤0→0 and non-positive survival→clamp to 1 (finite).
  - `computeDemandRecommendation(db, { nRounds, plantsPerRequest })` — a parameterized `sql` CTE aggregate (reports.ts `whereFrag` idiom, never string-concat, T-04-23): `recent_rounds` = last N rounds with realised sales; `sales` = Σ `order_lines.plants_decremented` on `SOLD_STATUSES` orders per variety; `unmet` = `back_in_stock_requests` per variety × `plantsPerRequest`. Trailing average over `roundsConsidered`, then `plantsToMeetDemand` per variety survival %. Returns `{ noData, nRounds, roundsConsidered, items[] }`.
- `crop.ts`: `GET /crop/planting-recommendation` (`requireRole owner|admin|grower`, T-04-24) with an optional bounded `nRounds` query. No `index.ts` change — the route rides the existing `cropRoutes` composition, so the Eden `App` type picked it up automatically.
- `crop-recommend.test.ts`: kernel round-trip vs `forecastPlants`; integration proving realised sales round-trip the haircut, back-in-stock ADDS to demand (stockout never undercounts), cancelled orders excluded, and the no-data flag below the N-round threshold; plus route RBAC (401/403/200 + no-data shape).

**Task 2 — PlantingRecommendationCard prefill:**
- `usePlantingRecommendation` composable (Eden `GET /crop/planting-recommendation`).
- Card in `PlantingMix.vue` renders per-variety recommended counts (with demand + survival context) and loading/error/no-data states (`ข้อมูลดีมานด์ยังไม่พอ` + `ต้องมีประวัติการขายอย่างน้อย {N} รอบ`). The `ใช้ค่านี้เติมในแผนปลูก` CTA (accent-only) prefills a NEW recipe editor with the recommended counts — editable, never auto-committed (D-25). Copy verbatim from UI-SPEC.

## Verification

- `cd api && bun test tests/crop-recommend.test.ts tests/forecast.test.ts` → 18 pass / 0 fail.
- `cd api && bun test tests/crop.test.ts` → 6 pass (existing crop routes unbroken; kernel reused, not modified).
- `cd web-admin && bun run build` → built (Eden type-safe against the new endpoint).
- Biome clean on all changed files; `tsc --noEmit` clean for the touched files.

## Deviations from Plan

None — plan executed as written. The endpoint was added to the existing `cropRoutes` chain (no `index.ts` edit), matching the frozen composition surface.

## Threat mitigations honoured

- **T-04-23** (SQL injection in demand aggregate): all filters are Drizzle parameterized `sql` fragments / bound arrays — no string concat.
- **T-04-24** (non-staff reading demand analytics): `requireRole owner|admin|grower` on the endpoint (401/403 tested).
- **T-04-25** (recommendation silently overwriting the mix): card prefills a new editor only; admin edits + confirms before save (D-25).

## Self-Check: PASSED
- api/src/services/crop-recommend.ts — FOUND
- api/tests/crop-recommend.test.ts — FOUND
- Commit ffa1df6 (test RED) — FOUND
- Commit 7ef4745 (feat kernel+endpoint) — FOUND
- Commit 6caa452 (feat card) — FOUND
