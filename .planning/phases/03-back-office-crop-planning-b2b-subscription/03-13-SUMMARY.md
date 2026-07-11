---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 13
subsystem: api
tags: [catalog, b2b, wholesale, gate, session, jose, elysia, uat-gap-closure]

# Dependency graph
requires:
  - phase: 03-06
    provides: "wholesaleVisible(db, customerId) — the single D-08 / T-03-21 wholesale-visibility rule (b2bStatus === 'approved'); the .derive bearer+verifySession session-resolution pattern in b2b.ts"
  - phase: 01-commerce-core
    provides: "public catalog surface (makeCatalogRoutes DI, roundEntry price shaping, box priceForTier)"
  - phase: 00-05
    provides: "jose HS256 issueSession/verifySession + Session type (auth.plugin.ts)"
provides:
  - "GET /catalog and GET /catalog/rounds/:id gate the b2b (wholesale) tier: prices.b2b and box priceSatang.b2b are null unless the caller presents an approved-B2B customer bearer session"
  - "Optional-session .derive on the catalog routes — invalid/forged token resolves to session=null (fail-closed), never a 401 (catalog stays OPEN, D-03)"
  - "Regression tests pinning the gate: anonymous/pending/forged → null, approved → resolved wholesale payload, on both endpoints"
affects: [03-verification, 03-ship, web-liff-catalog-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional-auth public endpoint: .derive resolves session|null from a bearer token but never gates — visibility widens only after wholesaleVisible() passes (fail-closed on every failure path)"
    - "Response-shape-preserving redaction: gated fields are nulled, never removed, so Eden Treaty consumers keep compiling"

key-files:
  created: []
  modified:
    - api/src/routes/catalog.ts
    - api/tests/catalog.test.ts
    - .planning/phases/03-back-office-crop-planning-b2b-subscription/deferred-items.md

key-decisions:
  - "Reused wholesaleVisible() from services/b2b.ts as the ONE visibility rule (D-08 / T-03-21) — no second copy of the approval check; catalog and /me/b2b/prices can never disagree"
  - "showB2b requires session.role === 'customer' — staff tokens read wholesale via the staff /prices routes, not the public catalog"
  - "b2b keys stay present as null (both were already nullable in the response shape) so the LIFF/Eden Treaty contract is unchanged"

patterns-established:
  - "Gate test quartet: anonymous → null, approved session → payload, pending session → null, forged token → 200 + null (fail-closed, endpoint stays open)"

requirements-completed: [CUST-02]

coverage:
  - id: T-03-13-01
    description: "Information disclosure: wholesale tier nulled on both catalog endpoints unless wholesaleVisible(session.sub)"
    requirement: "CUST-02"
    verification:
      - kind: integration
        ref: "api/tests/catalog.test.ts#b2b (wholesale) tier gate — 03-13, D-08 / T-03-21 / CUST-02"
  - id: T-03-13-02
    description: "Spoofing: forged/invalid bearer token resolves session=null → b2b stays hidden, response stays 200 (fail-closed, catalog OPEN per D-03)"
    requirement: "CUST-02"
    verification:
      - kind: integration
        ref: "api/tests/catalog.test.ts#invalid/forged bearer token fails closed — b2b null (T-03-13-02)"

# Metrics
duration: 4min
completed: 2026-07-11
status: complete
---

# Phase 03 Plan 13: Catalog B2B Price Gate (UAT Gap #4) Summary

**One-liner:** Public catalog now nulls the wholesale (b2b) tier for anonymous/pending callers via the existing wholesaleVisible() rule — only approved-B2B customer bearer sessions see it, on both GET /catalog and GET /catalog/rounds/:id, with the response shape unchanged.

## What was built

### Task 1 — b2b tier gate in the public catalog (`f873a71`)

- `api/src/routes/catalog.ts`:
  - Module-local `bearer(headers)` helper (mirrors the private one in `b2b.ts`).
  - `.derive` resolves `session: Session | null` per request — missing token → null, `verifySession` throw → null. The catalog stays OPEN (D-03); the session is optional context, never a 401 gate.
  - `showB2bFor(session)` computed once per request in each GET handler: `session !== null && session.role === "customer" && await wholesaleVisible(database, session.sub)`. Staff tokens and anonymous callers get `false`.
  - `roundEntry(..., showB2b)` — when false, `prices.b2b` is `null`; box mapping — when false, `priceSatang.b2b` is `null`. Keys remain present (both already nullable) so Eden Treaty consumers do not break.
  - File-header comment updated to state the gate (D-08 / T-03-21).
- `api/tests/catalog.test.ts`:
  - Existing anonymous b2b assertion flipped to expect `null`.
  - New gate describe: anonymous → null on every round entry (b2c stays public), approved session → `pricePerKgSatang === KG_B2B`, pending session → null, forged token → 200 + null (fail-closed), and `/catalog/rounds/:id` anonymous+approved pair.

### Task 2 — deferred item resolved (`d89ce51`)

- `.planning/phases/.../deferred-items.md`: the "catalog GET / exposes b2b tier price unconditionally" bullet struck through with a "Resolved: 2026-07-11 by plan 03-13" sub-line referencing the 03-UAT.md user decision. The vue-tsc bullet is untouched.

## Verification

- `cd api && bun test tests/catalog.test.ts tests/b2b-approval.test.ts` — 21 pass / 0 fail (approved-B2B `/me/b2b/prices` flow unbroken, `b2b-approval.test.ts` untouched).
- `cd api && bun test` — full suite 303 pass / 0 fail across 54 files.
- `grep -c "wholesaleVisible" api/src/routes/catalog.ts` = 2; `grep -c "verifySession"` = 2; `grep -c "b2b:"` = 3 (keys nulled, not removed).
- Biome check clean on both changed files.

## Deviations from Plan

None - plan executed exactly as written. (One additive test beyond the plan's minimum: the forged-token fail-closed case, directly pinning threat T-03-13-02.)

## Threat model dispositions

| Threat | Disposition | Where |
|--------|-------------|-------|
| T-03-13-01 info disclosure | mitigated | b2b nulled unless `wholesaleVisible(session.sub)` — same rule as `/me/b2b/prices` |
| T-03-13-02 spoofing | mitigated | jose `verifySession()`; any invalid token → session=null → b2b hidden (fail-closed) |
| T-03-13-03 DoS (extra DB read) | accepted | single indexed PK lookup, only when a customer bearer token is present; anonymous hot path unchanged |

## Commits

- `f873a71` feat(03-13): gate catalog b2b tier behind approved-B2B session (CUST-02)
- `d89ce51` docs(03-13): mark catalog b2b-exposure deferred item resolved

## Self-Check: PASSED
