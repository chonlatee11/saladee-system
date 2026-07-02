---
phase: 0
slug: foundation-platform
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (built-in — no dependency) |
| **Config file** | none — Bun test needs no config; tests live in `api/tests/*.test.ts` |
| **Quick run command** | `cd api && bun test <touched-file>` |
| **Full suite command** | `bun test` (root — runs all workspace tests) |
| **Estimated runtime** | ~15–30 seconds (unit); integration tests add ephemeral Docker PG spin-up ~5–10s |

---

## Sampling Rate

- **After every task commit:** Run `cd api && bun test <the-file-you-touched>`
- **After every plan wave:** Run `bun test` (full API suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (unit); integration tests requiring Docker PG may extend to ~60s

---

## Per-Task Verification Map

> Task IDs are assigned during planning (step 8). Rows map phase requirements/criteria to their proving test; the planner MUST attach each test file to a concrete task and update the Task ID column.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | Criterion 1 / PLAT-02 | — | Boot aborts with a clear message listing the missing env var | unit | `cd api && bun test tests/env.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 1 | — | `/health` returns 200 when process is up | integration | `cd api && bun test tests/health.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 1 / NFR-01 | — | `/health/ready` returns 200 when DB up, 503 when DB down | integration | `cd api && bun test tests/health.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 2 / PLAT-02 | — | migrate up → down → up applies cleanly (reversible) | integration (Docker PG) | `cd api && bun test tests/migrate.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 3 / PLAT-02 | T-priv-bucket | presigned PUT upload then GET download round-trips; bucket stays private | integration (R2 / S3-compat) | `cd api && bun test tests/storage.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 4 / D-06 | T-sig-forge | valid `x-line-signature` → echo 200; invalid/absent → 401 (raw-body HMAC) | unit | `cd api && bun test tests/webhook.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | Criterion 4 / PLAT-03 / D-08 | T-weak-hash | `Bun.password` hash→verify round-trip; jose ES/HS sign→verify; LINE idToken (ES256) verify | unit | `cd api && bun test tests/auth.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `api/tests/env.test.ts` — boot env-validation stub (Criterion 1 / PLAT-02)
- [ ] `api/tests/health.test.ts` — liveness + readiness stubs (Criterion 1)
- [ ] `api/tests/migrate.test.ts` — up/down/up against Docker PG (Criterion 2)
- [ ] `api/tests/storage.test.ts` — R2 presign round-trip (Criterion 3)
- [ ] `api/tests/webhook.test.ts` — signature valid/invalid + echo (Criterion 4 / D-06)
- [ ] `api/tests/auth.test.ts` — Bun.password + jose + LINE idToken (D-08 / PLAT-03)
- [ ] Docker Compose (or a test helper) to spin an ephemeral PostgreSQL 17 for migrate/health-ready tests
- [ ] Framework install: none — Bun test is built-in.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| API responds over HTTPS on the production VPS (health 200) | Criterion 1 | Requires live Hetzner VPS + Caddy TLS + DNS — cannot be exercised in CI without the provisioned box | After deploy, `curl -sSf https://<domain>/health` returns 200; TLS cert valid (Let's Encrypt via Caddy) |
| Real bank/LINE webhook delivery reaches `/webhook` and echoes | Criterion 4 / D-06 | Requires a real LINE Messaging channel + public HTTPS endpoint registered in LINE console | Send a message to the LINE OA; confirm echo reply arrives; confirm invalid-signature POST is rejected 401 |
| Neon pooled vs direct connection behaves under load | NFR-01 | Requires provisioned Neon project + pooler endpoint | Runtime uses `-pooler` string with `prepare: false`; migrations use direct string — verify both connect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
