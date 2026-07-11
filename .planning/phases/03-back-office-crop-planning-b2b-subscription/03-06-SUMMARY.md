---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 06
subsystem: b2b
tags: [elysia, drizzle, reservation, b2b, standing-order, overflow, vue, tanstack-query, rbac]

# Dependency graph
requires:
  - phase: 03-01
    provides: "customers.b2b_status/credit_terms/b2b_approved_at columns, standing_orders/standing_order_items/quota_overflow_flags tables, composed b2b.ts stub router"
  - phase: 03-03
    provides: "web-admin scaffold — Eden api client, DataTable.vue, session store, VueQueryPlugin, RBAC router with /b2b-approvals /standing-orders routes + stub views"
  - phase: 01-commerce-core
    provides: "guarded reserve() (oversell-safe atomic decrement), requireRole guard, issueSession, prices table (b2c/b2b tiers)"
provides:
  - "reserveStanding(tx, roundId, items) — thin loop over the EXISTING guarded reserve(); no 2nd counter, no pre-check; overflow inserts a quota_overflow_flags row in-tx, no auto-trim (D-09/D-10). Pure fn 03-05 publishQuota calls at round-open."
  - "wholesaleVisible(db, customerId) — b2b tier gate on b2b_status='approved' (D-08)"
  - "routes/b2b.ts — staff-gated: GET pending, GET customers roster, POST approve/reject, PATCH credit-terms (D-11), GET wholesale price (gated), GET overflow-flags, standing-order CRUD"
  - "web-admin B2BApprovals + StandingOrders views + useB2b.ts TanStack Query composables"
affects: [03-05-forecast-publish, 03-08-liff-b2b, 03-07-subscriptions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "reserveStanding is a THIN loop over reserve() — priority-before-B2C is order-of-execution ONLY, never a second counter or SELECT-available pre-check (Pitfall 1/TOCTOU)"
    - "Overflow is all-or-nothing: reserve() false → nothing reserved (no auto-trim) → quota_overflow_flags(shortfall = full requested, source b2b) inserted in the caller's tx; system never auto-decides (D-10)"
    - "b2b.ts route mirrors prices.ts/varieties.ts DI factory (makeB2bRoutes(db)); staff = requireRole('owner','admin') per-route beforeHandle"
    - "web-admin views fill 03-03 stub SFCs only — router.ts / DataTable / session frozen (conflict-free parallel slice)"

key-files:
  created:
    - api/src/services/b2b.ts
    - api/tests/standing-reserve.test.ts
    - api/tests/b2b-approval.test.ts
    - web-admin/src/composables/useB2b.ts
  modified:
    - api/src/routes/b2b.ts
    - web-admin/src/views/B2BApprovals.vue
    - web-admin/src/views/StandingOrders.vue

key-decisions:
  - "reserveStanding reuses reserve() UNCHANGED — the guarded UPDATE is the sole oversell authority; standing 'priority' is purely order-of-execution (T-03-13)"
  - "Overflow shortfall records the FULL requested plants (reserve() is all-or-nothing → 0 reserved, no auto-trim); matches RESEARCH Pattern 2 canonical snippet (D-10)"
  - "No round-open reserve endpoint in b2b.ts — 03-05 publishQuota is the single owner of the open sequence; this plan only ships the pure reserveStanding fn + standing CRUD (avoids double-reserve/ambiguous trigger)"
  - "wholesale tier price gated behind wholesaleVisible() (b2b_status='approved'); pending/rejected/B2C → 403, so wholesale never leaks (T-03-14)"

patterns-established:
  - "Standing-order reservation flows the same reserved_plants counter B2C/box orders use — proven by standing-reserve.test (60 reserved → B2C sees 40)"
  - "quota_overflow_flags is a passive admin signal: inserted in-tx, surfaced read-only via GET /b2b/overflow-flags (destructive severity in UI), never auto-resolved"

requirements-completed: [CUST-02, CUST-05, ADM-02]

# Coverage metadata
coverage:
  - id: D1
    description: "reserveStanding reserves before B2C via the existing guarded reserve() (60 of 100 → B2C sees 40); exceeding forecast reserves nothing (no auto-trim) + inserts a quota_overflow_flags(shortfall, source b2b) in-tx (CUST-05 / D-09 / D-10 / T-03-13)"
    requirement: "CUST-05"
    verification:
      - kind: integration
        ref: "tests/standing-reserve.test.ts — reserved-before-B2C, overflow flag, multi-item in one tx (3 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "B2B approval (pending→approve sets approved+b2bApprovedAt; reject; credit-terms D-11) + wholesale-price visibility gate (approved→b2b price, pending→403, T-03-14) + every b2b endpoint staff-only (401/403/200, T-03-15)"
    requirement: "CUST-02"
    verification:
      - kind: integration
        ref: "tests/b2b-approval.test.ts — approval, tier gate, RBAC, roster, overflow read, standing CRUD (10 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "web-admin B2BApprovals (roster + status badges + approve/reject-confirm + empty) and StandingOrders (table + overflow panel destructive severity + create/edit basket + cancel-confirm + empty) typecheck + build; states/copy per UI-SPEC"
    requirement: "ADM-02"
    verification:
      - kind: automated_ui
        ref: "cd web-admin && bunx vue-tsc --noEmit && bun run build"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end live B2B flow: login admin → approve a B2B account → wholesale price visible → set a standing order → reserved before B2C (catalog shows less) → over-forecast standing shows a red overflow flag + warning"
    requirement: "CUST-05"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify (gate=blocking) — web-admin :5174 + API :3000 per plan how-to-verify"
        status: unknown
    human_judgment: true
    rationale: "Live cross-origin admin session, the browser approval/standing flow, and the round-open reservation (round-open trigger is owned by 03-05 publishQuota — not exercisable in this slice in isolation) need a human in the loop. Automated tests prove reserveStanding + approval + tier gate at the unit/API level; the live UI round-trip and the 03-05-driven round-open reservation are unverified here."

# Metrics
duration: ~40min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 06: B2B Approval + Wholesale Gate + reserveStanding Summary

**B2B account approval + wholesale-price visibility gate + `reserveStanding()` — a thin loop over the EXISTING guarded `reserve()` (no second counter, no TOCTOU pre-check) that reserves standing baskets before B2C and flags over-forecast overflow in-tx (D-08/09/10), plus staff-gated b2b routes and two web-admin views — 12 new tests green, full API suite 233 pass, web-admin vue-tsc + build green.**

## Performance
- **Duration:** ~40 min
- **Completed:** 2026-07-07T16:31Z
- **Tasks:** 2 auto tasks done; Task 3 = human-verify checkpoint (deferred, gate=blocking)
- **Files created:** 4 · **Files modified:** 3

## Accomplishments
- `api/src/services/b2b.ts` — `reserveStanding(tx, roundId, items)` loops the UNCHANGED guarded `reserve()`; on false it inserts `quota_overflow_flags(shortfall = full requested, source "b2b")` in the caller's tx and does NOT auto-trim (D-10). Deliberately no 2nd counter and no `SELECT available` pre-check (Pitfall 1 / T-03-13). Plus `wholesaleVisible()` gating the b2b tier on `b2b_status='approved'` (D-08).
- `routes/b2b.ts` — filled the 03-01 stub, all `requireRole("owner","admin")`: GET pending, GET customers roster, POST approve (sets `b2bApprovedAt`)/reject, PATCH credit-terms (D-11 free text, no limit blocking), GET wholesale price (403 unless approved), GET overflow-flags (unresolved, joined variety name), standing-order CRUD (create/list/patch/soft-cancel). No round-open reserve endpoint — 03-05 publishQuota owns that trigger.
- web-admin: `useB2b.ts` TanStack Query composables (Eden + session Bearer, mutations invalidate) and two views — `B2BApprovals.vue` (roster DataTable + pending/approved/rejected status badges + accent "อนุมัติบัญชี B2B" + destructive reject-confirm + empty) and `StandingOrders.vue` (standing DataTable + red overflow panel with the D-10 warning copy + create/edit basket modal + destructive cancel-confirm + empty). All Thai copy per UI-SPEC; one primary accent per view.

## Task Commits
1. **Task 1 (RED): failing standing-reserve + b2b-approval tests** — `fc8bdd8` (test)
2. **Task 1 (GREEN): b2b service (reserveStanding + wholesale gate) + staff-gated routes** — `b25f891` (feat)
3. **Task 1 deviation: GET /b2b/overflow-flags read** — `8ffcacb` (feat)
4. **Task 1 deviation: GET /b2b/customers roster** — `89dc9ac` (feat)
5. **Task 2: web-admin B2BApprovals + StandingOrders + useB2b** — `ef6ad17` (feat)
6. **Task 3: end-to-end B2B flow** — checkpoint:human-verify (gate=blocking), deferred

## Files Created/Modified
- `api/src/services/b2b.ts` — reserveStanding + wholesaleVisible.
- `api/src/routes/b2b.ts` — staff-gated B2B approval/wholesale/standing endpoints (filled stub).
- `api/tests/standing-reserve.test.ts` — reserved-before-B2C, overflow flag, multi-item tx.
- `api/tests/b2b-approval.test.ts` — approval, tier gate, RBAC, roster, overflow read, standing CRUD.
- `web-admin/src/composables/useB2b.ts` — TanStack Query B2B layer.
- `web-admin/src/views/B2BApprovals.vue` / `StandingOrders.vue` — filled B2B screens.

## Decisions Made
- **reserveStanding reuses reserve() UNCHANGED** — standing "priority" is order-of-execution only; the guarded UPDATE remains the sole oversell authority (T-03-13).
- **Overflow shortfall = full requested plants** — reserve() is all-or-nothing so 0 is reserved (no auto-trim); matches the RESEARCH Pattern 2 canonical snippet (D-10).
- **No round-open reserve endpoint here** — 03-05 publishQuota is the single owner of the open sequence and calls reserveStanding inside its tx (avoids double-reserve/ambiguous trigger).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added GET /b2b/overflow-flags read endpoint**
- **Found during:** Task 2 (StandingOrders view)
- **Issue:** UI-SPEC requires StandingOrders to surface overflow flags at destructive severity, but the plan's route list had no read endpoint for `quota_overflow_flags` — the view could not display them.
- **Fix:** Added a staff-gated `GET /b2b/overflow-flags` returning unresolved flags joined with the variety name. Read-only; the system still never auto-resolves (D-10).
- **Files modified:** api/src/routes/b2b.ts, api/tests/b2b-approval.test.ts
- **Verification:** test asserts an unresolved flag + variety name is returned; full suite green.
- **Committed in:** `8ffcacb`

**2. [Rule 2 - Missing Critical] Added GET /b2b/customers roster endpoint**
- **Found during:** Task 2 (both views)
- **Issue:** B2BApprovals needs the approved/rejected states (positive badge per UI-SPEC), and StandingOrders needs an approved-customer picker to create a basket on behalf of an account — neither is possible from `GET /b2b/pending` (pending-only). Standing-order CRUD is otherwise unusable (no first record).
- **Fix:** Added a staff-gated `GET /b2b/customers` returning the full B2B roster (`b2b_status IS NOT NULL`); powers approvals status badges and the approved-customer picker. Mirrors the 03-04 Rule-2 pattern (make the CRUD view usable using in-scope endpoints).
- **Files modified:** api/src/routes/b2b.ts, api/tests/b2b-approval.test.ts
- **Verification:** test confirms roster includes B2B accounts and excludes plain B2C (null status); full suite green.
- **Committed in:** `89dc9ac`

---

**Total deviations:** 2 auto-fixed (2 missing-critical). No scope creep — both are read/roster endpoints needed for the plan's own UI-SPEC states; the reservation guard, schema, and index.ts are untouched.

## Issues Encountered
None blocking. The shared test PG (:55432) was already up from prior plans; the new tests self-reset (0004 down first, up last) and leave the full Phase-3 shape applied, keeping sibling tests green (233 pass / 0 fail).

## Threat Surface
- **T-03-13 (Tampering — oversell via priority counter):** mitigated — reserveStanding calls only `reserve()`; no 2nd counter, no SELECT-available pre-check; proven by standing-reserve.test (reserved-before-B2C + overflow, reserved never exceeds quota).
- **T-03-14 (Info disclosure — b2b price leak):** mitigated — wholesale price gated behind `wholesaleVisible()` (approved-only); pending → 403 asserted.
- **T-03-15 (Elevation — b2b endpoints):** mitigated — every route `requireRole("owner","admin")`; no-token 401 / customer 403 asserted.
- No new security surface beyond the plan's threat register (the two added GET endpoints are staff-gated reads).

## User Setup Required
None for the code. The Task-3 checkpoint needs a running API (:3000) and web-admin dev (:5174) with a seeded admin account + at least one B2B applicant.

## Next Phase Readiness
- **reserveStanding is ready for 03-05** — publishQuota calls `reserveStanding(tx, roundId, items)` inside the round-open tx (single owner of the open sequence); the pure fn + overflow flag are done and unit/API-proven.
- Schema untouched; reservation guard untouched (`reserve()` unchanged).
- `wholesaleVisible()` is exported for 03-08 (LIFF B2B wholesale-price view) to reuse the same approval gate.
- **PENDING human verification (Task 3, gate=blocking):** run `cd web-admin && bun run dev` (:5174) with API up, log in as admin, approve a B2B account, confirm wholesale price becomes visible, set a standing order, and set an over-forecast standing to see the red overflow flag + warning. Note the live round-open reservation (reserved-before-B2C in the catalog) depends on 03-05 publishQuota — in isolation it is proven by standing-reserve.test. Automated tests + typecheck + build are green.

## Self-Check: PASSED

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
