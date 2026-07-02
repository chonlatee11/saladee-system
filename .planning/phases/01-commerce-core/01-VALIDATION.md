---
phase: 01
slug: commerce-core
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-02
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (built-in) |
| **Config file** | `api/tests/docker-compose.pg.yml` (real PostgreSQL 17 container, port 55432) |
| **Quick run command** | `bun test` |
| **Full suite command** | `bun test` (against the live PG test container) |
| **Estimated runtime** | ~30–60 seconds (includes real-PG concurrency races) |

---

## Sampling Rate

- **After every task commit:** Run `bun test`
- **After every plan wave:** Run `bun test` (full)
- **Before `/gsd:verify-work`:** Full suite must be green — including the oversell-race proof
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> `<pg>` = `docker compose -f api/tests/docker-compose.pg.yml up -d` (brings up the real PG17 test container on :55432 before the run).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 [BLOCKING] | 01-01 | 1 | PLAT-01 (schema) | T-01-01 | Reversible commerce migration physically applies (up→down→up clean) | migration | `cd api && bun run db:migrate` | `api/drizzle/0001_commerce.sql`, `.down.sql` | ⬜ pending |
| T2 | 01-01 | 1 | PLAT-01 | T-01-01/02/03/04 | Guarded atomic decrement — N-way race yields exactly one winner, no oversell | real-PG concurrency | `<pg> && cd api && bun test tests/reservation.test.ts tests/migrate.test.ts` | `api/tests/reservation.test.ts`, `migrate.test.ts` | ⬜ pending |
| T3 | 01-01 | 1 | INV-04, ORD-02 | T-01-02 | Ceil-to-baht pricing (integer satang) + legal-only status transitions (shipping→cancelled forbidden) | unit | `cd api && bun test tests/pricing.test.ts tests/order-status.test.ts` | `api/tests/pricing.test.ts`, `order-status.test.ts` | ⬜ pending |
| T1 | 01-02 | 2 | PAY-04, INV-06, SALE-01/02 | T-01-06 | Server-derived frozen price/pack snapshot; cut-off/closed-round rejected | real-PG integration | `<pg> && cd api && bun test tests/order-snapshot.test.ts tests/round-cutoff.test.ts` | `api/tests/order-snapshot.test.ts`, `round-cutoff.test.ts` | ⬜ pending |
| T2 | 01-02 | 2 | PLAT-01 | T-01-05 | End-to-end oversell proof at HTTP boundary (one 201, N-1 409; reserved ≤ quota) | real-PG concurrency | `<pg> && cd api && bun test tests/order-endpoint-race.test.ts` | `api/tests/order-endpoint-race.test.ts` | ⬜ pending |
| T3 | 01-02 | 2 | ORD-02, PLAT-03 | T-01-07/08 | Staff-gated status pipeline; cancel releases stock exactly once (idempotent) | real-PG integration | `<pg> && cd api && bun test tests/cancel-release.test.ts` | `api/tests/cancel-release.test.ts` | ⬜ pending |
| T1 | 01-03 | 3 | PLAT-03, INV-01/03/05 | T-01-11 | Every catalog/round write gated 401/403/2xx; reads + POST /orders open | real-PG integration | `<pg> && cd api && bun test tests/auth-boundary.test.ts` | `api/tests/auth-boundary.test.ts` | ⬜ pending |
| T2 | 01-03 | 3 | INV-02, INV-04 | T-01-12 | Dated price override resolution + auto pack price + retained history | real-PG integration | `<pg> && cd api && bun test tests/prices-resolution.test.ts` | `api/tests/prices-resolution.test.ts` | ⬜ pending |
| T3 | 01-03 | 3 | INV-01, INV-03 | T-01-11 | Admin catalog setup round-trips (variety+pack, round+quota, B2C+B2B prices) | real-PG integration | `<pg> && cd api && bun test tests/catalog-crud.test.ts` | `api/tests/catalog-crud.test.ts` | ⬜ pending |
| T4 | 01-03 | 3 | PLAT-03 | T-01-22/23 | Real staff login: users lookup by email + stored-hash verify + row role; client-supplied hash cannot forge a token | real-PG integration | `<pg> && cd api && bun test tests/staff-login.test.ts` | `api/tests/staff-login.test.ts` | ⬜ pending |
| T1 | 01-04 | 4 | INV-08, SALE-04/01/02 | T-01-15 | Public catalog: availability = quota−reserved, resolved prices, "หมดรอบนี้" label, multi-mode; no PII | real-PG integration | `<pg> && cd api && bun test tests/catalog.test.ts` | `api/tests/catalog.test.ts` | ⬜ pending |
| T2 | 01-04 | 4 | INV-08 | T-01-16 | Data-only back-in-stock record stored + staff-listable; no send/substitution | real-PG integration | `<pg> && cd api && bun test tests/soldout-notify.test.ts` | `api/tests/soldout-notify.test.ts` | ⬜ pending |
| T1 | 01-05 | 5 | INV-07, PAY-04 | T-01-18/19/21 | reserveBox() + box CRUD BOM compile against existing reserve/release (source/build gate; behavior proven in T2) | build/source | `cd api && bunx tsc --noEmit` | `api/src/services/reservation.ts`, `api/src/routes/boxes.ts` | ⬜ pending |
| T2 | 01-05 | 5 | INV-07, PAY-04 | T-01-18/20 | All-or-nothing multi-component decrement (zero net on shortfall) + race + box BOM snapshot | real-PG concurrency | `<pg> && cd api && bun test tests/box-reservation.test.ts tests/box-order.test.ts` | `api/tests/box-reservation.test.ts`, `box-order.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Real-PG test harness reused from Phase 0 (`api/tests/docker-compose.pg.yml`, port 55432) — every real-PG task above brings it up before running
- [x] Concurrency proof stub — `Promise.allSettled` racing `reserve()` (01-01 T2) and `app.handle` on `POST /orders` for the last available pack (01-02 T2 / Success Criterion 2 / PLAT-01), plus the box race (01-05 T2)
- [x] Per-requirement test stubs populated by the planner: INV-01…INV-08 (01-03/01-04/01-05), INV-09 (01-01 schema / 01-02 order), ORD-02 (01-01 T3 / 01-02 T3), PAY-04 (01-02 T1 / 01-05 T2), PLAT-01 (01-01 T2 / 01-02 T2), PLAT-03 (01-02 T3 / 01-03 T1+T4)

*The task→command mapping above is the concrete file list derived from the plan task breakdown.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| _(none — engine is API-only and fully automatable; every task carries an `<automated>` command)_ | | | |

*Target met: all Phase 1 behaviors have automated verification (no admin UI to click through).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (real-PG harness + concurrency proofs mapped)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready — nyquist-compliant; Wave 0 complete.
</content>
