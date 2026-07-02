---
phase: 01
slug: commerce-core
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(populated during planning / nyquist audit)_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Real-PG test harness reused from Phase 0 (`api/tests/docker-compose.pg.yml`, port 55432)
- [ ] Concurrency proof stub — `Promise.all` racing `app.handle` on `POST /orders` for the last available pack (Success Criterion 2 / PLAT-01)
- [ ] Per-requirement test stubs for INV-01…INV-09, ORD-02, PAY-04 (populated by planner)

*The nyquist auditor / planner fills the concrete file list from the plan task breakdown.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| _(none expected — engine is API-only and fully automatable)_ | | | |

*Target: all Phase 1 behaviors have automated verification (no admin UI to click through).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
