---
phase: 04
slug: web-store-marketing-scale
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test |
| **Config file** | none — Bun built-in runner (api/) |
| **Quick run command** | `cd api && bun test` |
| **Full suite command** | `cd api && bun test` |
| **Estimated runtime** | ~{N} seconds (planner to fill from existing suite) |

---

## Sampling Rate

- **After every task commit:** Run `cd api && bun test`
- **After every plan wave:** Run `cd api && bun test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | — | — | migration 0005 registered in all self-resetting tests | unit | `cd api && bun test` | ❌ W0 | ⬜ pending |

*Planner fills the full map from PLAN.md tasks. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Register new migration `0005` in every self-resetting test harness (lesson from migration 0004 = 26 files) — MUST precede feature waves
- [ ] Test stubs/fixtures for coupon atomic redemption, loyalty ledger, discount→QR invariant

*Planner refines from RESEARCH.md Validation Architecture + Pitfall 4.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Public web storefront browse → cart → checkout end-to-end | ORD-05 | Cross-app SSR UI flow | Load web store, add item, checkout as guest, pay via PromptPay QR |
| Segmented LINE broadcast delivery | MKT-03 / LINE-04 | Requires live LINE OA + real recipients | Admin sends broadcast to a consented segment; confirm receipt |
| Conversational chatbot takes an order | MKT-01 | Live LINE webhook conversation | Message the OA, complete a rule-based order flow |

*Planner refines. All stock-correctness / discount-invariant paths MUST have automated verify.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
