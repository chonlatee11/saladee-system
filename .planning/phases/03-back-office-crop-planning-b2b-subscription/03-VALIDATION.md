---
phase: 3
slug: back-office-crop-planning-b2b-subscription
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (built-in) |
| **Config file** | none — Bun test needs no config |
| **Quick run command** | `bun test <file>` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~{N} seconds (populated by planner) |

---

## Sampling Rate

- **After every task commit:** Run `bun test <file>`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | — | {expected secure behavior or "N/A"} | unit | `bun test <file>` | ❌ W0 | ⬜ pending |

*Populated by planner from PLAN.md tasks. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Forecast service unit-test stubs (CROP-01..06) — pure/testable
- [ ] pdfmake Thai-font render spike (A1) — highest risk
- [ ] Subscription generator idempotency test (UNIQUE(subscription,round))

*Refined by planner against final task breakdown.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| {behavior} | REQ-{XX} | {reason} | {steps} |

*Populated by planner.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
