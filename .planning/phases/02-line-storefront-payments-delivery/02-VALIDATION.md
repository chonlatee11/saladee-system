---
phase: 2
slug: line-storefront-payments-delivery
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: RESEARCH `## Validation Architecture` + the `<automated>` verify commands across the 9 PLAN.md files.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (built-in runner — `bun test`, per CLAUDE.md; Phase-1 already runs 118 tests) |
| **Config file** | none — `.env.test` at repo root + `api/` (Phase-0 pattern); no separate test config |
| **Quick run command** | `cd api && bun test <file>` (single new test file for the task) |
| **Full suite command** | `cd api && bun test` (+ `cd web && bun test` for Eden-typed views) |
| **Estimated runtime** | ~30 seconds (api full suite incl. the 118 Phase-1 tests); single-file ~1–3 s |

---

## Sampling Rate

- **After every task commit:** Run `cd api && bun test <file>` (or `cd web && bun test <file>` for web views) — the single new test file for that task.
- **After every plan wave:** Run `cd api && bun test` (full api suite, must stay green including the 118 Phase-1 tests) and `cd web && bun test` for waves that touch web.
- **Before `/gsd-verify-work`:** Full api + web suites green, PLUS a manual real-bank-app QR scan and one real slip through SlipOK.
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PAY-03 | T-02-03 / T-02-04 | trans_ref UNIQUE index + env-only secrets created by migration 0003 | integration | `cd api && bunx tsc --noEmit && test -f drizzle/0003_payments_delivery_consent.sql && grep -q "payments_trans_ref_idx" src/db/schema.ts` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | PAY-03 | T-02-01 | applyTransition row-locks + releases stock only on cancelled; onlyIfHold guard | integration | `cd api && bun test test/orders*.test.ts test/reservation*.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | PAY-03 | T-02-02 | migration up→down→up clean; pg-boss on DIRECT url, no worker under test | integration | `cd api && bun run db:migrate && bun run db:down && bun run db:migrate && bunx tsc --noEmit && bun test` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | LINE-02 | T-02-05 / T-02-06 | forged/expired idToken → 401; login mints customer session only | integration | `cd api && bun test test/auth-line.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | LINE-02 | — | LIFF SPA shell builds; Eden treaty types compile | build | `cd web && bun run build && bun test` | ✅ | ⬜ pending |
| 02-02-03 | 02 | 2 | LINE-01 | T-02-07 | Rich Menu script idempotent; channel token env-only | build | `cd api && bunx tsc --noEmit scripts/provision-rich-menu.ts && grep -c 'setDefaultRichMenu' scripts/provision-rich-menu.ts` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 2 | DEL-01, DEL-02, DEL-03 | T-02-09 / T-02-10 | fee server-computed; freshness intersection; very_fresh → self/cold | unit | `cd api && bun test test/delivery.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 2 | DEL-04 | T-02-11 | GET /delivery/quote display-only; care writes stay staff-gated | integration | `cd api && bunx tsc --noEmit && bun test test/delivery.test.ts test/catalog*.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 3 | PAY-01 | T-02-16 | PromptPay payload correct CRC-16 for a golden payee+amount vector | unit | `cd api && bun test test/promptpay.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-02 | 04 | 3 | ORD-01, PAY-03, DEL-04 | T-02-12 / T-02-13 / T-02-14 | server re-computes fee + QR total; awaiting_payment; hold idempotent | integration | `cd api && bunx tsc --noEmit && bun test test/orders*.test.ts test/hold-idempotent.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-03 | 04 | 3 | PLAT-04 | T-02-15 | usage + marketing consent logged as two rows with policy version | integration | `cd api && bun test test/consent.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 3 | LINE-02 | T-02-18 | care/description rendered via escaped interpolation (no v-html) | build | `cd web && bun run build && bun test test/catalog-view.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-02 | 05 | 3 | LINE-02 | T-02-17 | cart stores ids + qty only; server re-resolves price/plants | build | `cd web && bun run build` | ✅ | ⬜ pending |
| 02-06-01 | 06 | 4 | PAY-02 | T-02-19 / T-02-23 | SlipOK adapter maps clean/rejected; wrong-amount/payee/not-a-slip | unit | `cd api && bun test test/slip-verify.test.ts` | ❌ W0 | ⬜ pending |
| 02-06-02 | 06 | 4 | PAY-02, PLAT-04 | T-02-20 / T-02-21 / T-02-22 | transRef UNIQUE dup rejection; private server-assigned key + signed URL | integration | `cd api && bunx tsc --noEmit && bun test test/slip-dedup.test.ts test/slip-verify.test.ts` | ❌ W0 | ⬜ pending |
| 02-07-01 | 07 | 4 | PAY-03 | T-02-25 / T-02-26 | expiry cancels only {created, awaiting_payment}; sweep self-heals stranded stock | integration | `cd api && bun test test/hold-expiry.test.ts` | ❌ W0 | ⬜ pending |
| 02-07-02 | 07 | 4 | ORD-04, LINE-03 | T-02-27 / T-02-28 | Flex push to order's own line_user_id only; webhook raw-body preserved | integration | `cd api && bunx tsc --noEmit && bun test test/notify.test.ts test/webhook*.test.ts` | ❌ W0 | ⬜ pending |
| 02-08-01 | 08 | 5 | LINE-02, DEL-04, PLAT-04 | T-02-30 / T-02-31 | wizard shows server fee/total only; usage-consent gate | build | `cd web && bun run build && bun test test/checkout-wizard.test.ts` | ❌ W0 | ⬜ pending |
| 02-08-02 | 08 | 5 | LINE-02 | T-02-32 | QR re-fetch idempotent (UI read-only) | build | `cd web && bun run build` | ✅ | ⬜ pending |
| 02-09-01 | 09 | 4 | CUST-04 | T-02-33 / T-02-34 / T-02-35 | /me/orders scoped by session customerId; reorder re-prices current round | integration | `cd api && bunx tsc --noEmit && bun test test/reorder.test.ts` | ❌ W0 | ⬜ pending |
| 02-09-02 | 09 | 4 | LINE-02 | — | member list + guest gate; deep-link order detail | build | `cd web && bun run build && bun test test/order-history.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. "File Exists" ❌ W0 = the test file is a Wave-0 scaffold created by 02-01 Task 3 and starts red until its owning task turns it green.*

---

## Wave 0 Requirements

10 failing/placeholder test files scaffolded by **02-01 Task 3** (`api/test/`), matching the RESEARCH Validation Architecture:

- [ ] `api/test/promptpay.test.ts` — golden CRC vector (PAY-01)
- [ ] `api/test/slip-verify.test.ts` — adapter response mapping (PAY-02)
- [ ] `api/test/slip-dedup.test.ts` — transRef UNIQUE dedup (PAY-02)
- [ ] `api/test/hold-expiry.test.ts` — pg-boss release + no-op on paid (PAY-03)
- [ ] `api/test/hold-idempotent.test.ts` — re-show QR adds no second timer (PAY-03)
- [ ] `api/test/delivery.test.ts` — fee/freshness matrix (DEL-01..04)
- [ ] `api/test/notify.test.ts` — milestone push members-only (ORD-04)
- [ ] `api/test/auth-line.test.ts` — idToken verify accept/reject (LINE-02)
- [ ] `api/test/reorder.test.ts` — re-price at current round (CUST-04)
- [ ] `api/test/consent.test.ts` — usage + marketing rows (PLAT-04)
- [ ] `applyTransition()` extracted (02-01 Task 2) + covered by the existing Phase-1 status tests (must keep passing)
- [ ] pg-boss test setup: Docker Postgres with the `pgboss` schema; `startAfter: 0` for fast tests

Web test scaffolds (`web/tests/`) created by their owning plans: `catalog-view.test.ts` (02-05), `checkout-wizard.test.ts` (02-08), `order-history.test.ts` (02-09).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LIFF app id + webhook URL + Rich Menu provisioned in the LINE console | LINE-01 / LINE-02 | Console-only artifacts; no CLI/API to create the LIFF app id | 02-02 Task 4 checkpoint: create LIFF app under the Login channel whose id = LINE_LOGIN_CHANNEL_ID (aud must match — Pitfall 4), set webhook URL, run the Rich Menu script with a 2500x1686 PNG |
| SlipOK branch + linked receiving bank account provisioned | PAY-02 | External vendor signup; branch/account linkage is dashboard-only | 02-06 `user_setup`: create a SlipOK branch and link the shop's receiving account (enables log:true payee + duplicate checks). Non-blocking — admin manual-confirm (D-04) is the working fallback |
| Real PromptPay QR scannable by a bank app | PAY-01 | Only a real banking app proves the EMVCo payload scans and pre-fills the amount | Phase gate: generate a checkout QR, scan with a real bank app, confirm payee + amount pre-fill |
| One real slip verifies end-to-end through SlipOK | PAY-02 | Confirms the D-02 payee-masking assumption (RESEARCH A2/Open-Q1) against a live response | Phase gate: pay a test order, upload the real slip, confirm clean → paid transition (or admin-confirm fallback if masking blocks strict payee) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
