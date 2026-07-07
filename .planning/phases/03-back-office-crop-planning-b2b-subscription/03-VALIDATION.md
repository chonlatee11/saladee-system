---
phase: 3
slug: back-office-crop-planning-b2b-subscription
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-07
refined: 2026-07-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Refined against the final 12-plan breakdown (03-01 … 03-12).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (built-in) — API; `vue-tsc --noEmit` / `vite build` — frontend typecheck/build |
| **Config file** | none |
| **Quick run command** | `cd api && bun test <file>` · `cd web-admin && bunx vue-tsc --noEmit` |
| **Full suite command** | `cd api && bun test` |
| **Estimated runtime** | API suite ~30–60s (≥187 baseline + new) |

---

## Sampling Rate

- **After every task commit:** `bun test <file>` (backend) หรือ `vue-tsc --noEmit` / `vite build` (frontend)
- **After every plan wave:** `cd api && bun test` เต็ม
- **Before `/gsd-verify-work`:** Full suite เขียว
- **Max feedback latency:** ~60s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | INV-10,CROP-*,SALE-03,CUST-02/05 | T-03-01/02 | additive schema, guard untouched | typecheck | `cd api && bunx tsc --noEmit` | ✅ | ⬜ |
| 03-01-02 | 01 | 1 | ADM-03 | T-03-01/03 | reversible migration; CORS narrow | migrate | `cd api && bun run db:migrate && bun run db:down 0004_phase3 && bun run db:migrate` | ✅ | ⬜ |
| 03-01-03 | 01 | 1 | — | T-03-02 | no oversell regression | regression | `cd api && bun test` | ✅ | ⬜ |
| 03-02-01 | 02 | 1 | ORD-03 | T-03-04 | PdfPrinter on-disk TTF | typecheck | `cd api && bunx tsc --noEmit` | ✅ | ⬜ |
| 03-02-02 | 02 | 1 | ORD-03 | T-03-04 | Thai PDF buffer renders (A1) | smoke | `cd api && bun test tests/pdf-thai.test.ts` | ❌ W0 | ⬜ |
| 03-03-01 | 03 | 1 | ADM-02 | T-03-05/06 | staff-only session | build | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-03-02 | 03 | 1 | ADM-02 | T-03-05 | RBAC nav gating | build | `cd web-admin && bun run build` | ✅ | ⬜ |
| 03-03-03 | 03 | 1 | ADM-02 | T-03-05 | direct-URL 403 | human | checkpoint:human-verify | — | ⬜ |
| 03-04-01 | 04 | 2 | CROP-01/02/03/06 | T-03-07/08/09 | grower guard; tx spawn | unit+integration | `cd api && bun test tests/forecast.test.ts tests/crop.test.ts` | ❌ W0 | ⬜ |
| 03-04-02 | 04 | 2 | CROP-01/02/06 | — | — | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-04-03 | 04 | 2 | CROP-* | — | — | human | checkpoint:human-verify | — | ⬜ |
| 03-05-01 | 05 | 3 | CROP-04/05,INV-10 | T-03-10/11/12 | publish quota-only; override kept | integration | `cd api && bun test tests/forecast-publish.test.ts tests/harvest-log.test.ts` | ❌ W0 | ⬜ |
| 03-05-02 | 05 | 3 | CROP-04/05 | — | — | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-05-03 | 05 | 3 | CROP-04/05,INV-10 | T-03-10 | — | human | checkpoint:human-verify | — | ⬜ |
| 03-06-01 | 06 | 2 | CUST-02/05 | T-03-13/14/15 | reserve() reuse; tier gate | integration | `cd api && bun test tests/standing-reserve.test.ts tests/b2b-approval.test.ts` | ❌ W0 | ⬜ |
| 03-06-02 | 06 | 2 | CUST-02/05 | — | overflow surfaced | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-06-03 | 06 | 2 | CUST-05 | T-03-13 | reserve-before-B2C | human | checkpoint:human-verify | — | ⬜ |
| 03-07-01 | 07 | 2 | SALE-03 | T-03-16/17/18/19 | idempotent gen; reserveBox reuse | integration | `cd api && bun test tests/subscription-fill.test.ts tests/subscription-gen.test.ts` | ❌ W0 | ⬜ |
| 03-07-02 | 07 | 2 | SALE-03 | — | — | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-07-03 | 07 | 2 | SALE-03 | T-03-16 | — | human | checkpoint:human-verify | — | ⬜ |
| 03-08-01 | 08 | 3 | SALE-03 | T-03-20/22 | ownership+cut-off server | typecheck | `cd web && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-08-02 | 08 | 3 | CUST-02/05 | T-03-21 | b2b gate | build | `cd web && bun run build` | ✅ | ⬜ |
| 03-08-03 | 08 | 3 | SALE-03,CUST-02/05 | T-03-21 | — | human | checkpoint:human-verify | — | ⬜ |
| 03-09-01 | 09 | 2 | ORD-03 | T-03-23/24/25 | packer guard; PDPA PDF | integration | `cd api && bun test tests/packing-queue.test.ts` | ❌ W0 | ⬜ |
| 03-09-02 | 09 | 2 | ORD-03 | — | — | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-09-03 | 09 | 2 | ORD-03 | T-03-25 | Thai PDF legible | human | checkpoint:human-verify | — | ⬜ |
| 03-10-01 | 10 | 2 | ADM-01 | T-03-26/27 | staff guard; param sql | integration | `cd api && bun test tests/dashboard.test.ts` | ❌ W0 | ⬜ |
| 03-10-02 | 10 | 2 | ADM-01 | — | — | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-10-03 | 10 | 2 | ADM-01 | — | — | human | checkpoint:human-verify | — | ⬜ |
| 03-11-01 | 11 | 2 | MKT-04 | T-03-28/29 | staff guard; param sql | integration | `cd api && bun test tests/reports.test.ts` | ❌ W0 | ⬜ |
| 03-11-02 | 11 | 2 | MKT-04 | T-03-30 | papaparse CSV escape | build | `cd web-admin && bun run build` | ✅ | ⬜ |
| 03-11-03 | 11 | 2 | MKT-04 | T-03-30 | — | human | checkpoint:human-verify | — | ⬜ |
| 03-12-01 | 12 | 2 | ADM-03,MKT-02 | T-03-31/32/33/34 | secret-absent; sig preserved | integration | `cd api && bun test tests/settings.test.ts tests/chatbot-router.test.ts` | ❌ W0 | ⬜ |
| 03-12-02 | 12 | 2 | ADM-03 | T-03-31 | secrets not in UI | typecheck | `cd web-admin && bunx vue-tsc --noEmit` | ✅ | ⬜ |
| 03-12-03 | 12 | 2 | ADM-03,MKT-02 | T-03-32 | — | human | checkpoint:human-verify | — | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. "File Exists ❌ W0" = test to be created by that plan's Task 1 (RED→GREEN within the slice).*

---

## Wave 0 Requirements

The single cross-cutting Wave-0 risk gate is the **pdfmake Thai-font spike (03-02, A1)** — it must be green before 03-09 (packing PDF) runs. All other new tests are created and made green **inside their own slice's Task 1** (RED→GREEN), so no separate Wave-0 stub plan is needed.

- [ ] `api/tests/pdf-thai.test.ts` — D-21/A1 pdfmake+Bun spike (03-02, Wave 1) — **highest risk, blocks 03-09**
- [ ] `api/tests/forecast.test.ts` — CROP-03 pure compute (03-04 Task 1)
- [ ] `api/tests/forecast-publish.test.ts` — CROP-04 publish + manual-override kept (03-05 Task 1)
- [ ] `api/tests/harvest-log.test.ts` — CROP-05/INV-10 lot/best-before/delta (03-05 Task 1)
- [ ] `api/tests/standing-reserve.test.ts` — CUST-05 reserve-before-B2C + overflow (03-06 Task 1)
- [ ] `api/tests/subscription-gen.test.ts` — SALE-03 idempotency UNIQUE(subscription,round) (03-07 Task 1)
- [ ] `api/tests/packing-queue.test.ts` — ORD-03 grouping by route (03-09 Task 1)
- [ ] `api/tests/chatbot-router.test.ts` — MKT-02 keyword→Flex+deep-link, signature preserved (03-12 Task 1)
- [ ] web-admin has no component-test infra: rely on `vue-tsc`/`vite build` automated gate + per-slice human-verify checkpoints + end-of-phase `/gsd-verify-work` UAT.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| web-admin sidebar RBAC nav (grower/packer เห็นเมนูต่างกัน) | ADM-02 | visual + role-session interaction | 03-03 checkpoint steps |
| Thai PDF pack/label legible + print-safe | ORD-03/D-21 | ต้องเปิดไฟล์จริงดู glyph | 03-09 checkpoint step 2 |
| Chart channel↔color mapping คงที่ + CSV ไทยไม่เพี้ยน | MKT-04/D-24 | visual + open CSV | 03-11 checkpoint |
| Chatbot Flex + deep-link ใน LINE client | MKT-02/D-25 | ต้องทดสอบใน LINE จริง | 03-12 checkpoint step 2 |
| LIFF subscription/B2B mobile flows | SALE-03/CUST-02/05 | LIFF ในมือถือ/LINE | 03-08 checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a human-verify checkpoint (frontend visual)
- [x] Sampling continuity: ไม่มี 3 tasks ติดกันที่ไม่มี automated verify (ทุก slice: backend bun test + frontend vue-tsc/build; checkpoint เป็น task ที่ 3 เท่านั้น)
- [x] Wave 0 covers the single cross-cutting risk (pdf-thai spike); slice tests created in-slice
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** refined by planner — ready for execution
