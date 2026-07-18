---
phase: 04
slug: web-store-marketing-scale
status: ready
nyquist_compliant: true
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
| **Quick run command** | `cd api && bun test <file>` |
| **Full suite command** | `cd api && bun test` |
| **Estimated runtime** | ~90 seconds full suite (187 pass / 0 fail baseline on develop); ~15 s per single-file run |

Frontend plans (web-admin / web-store / web) verify via `bun run build` (type + compile gate).

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (single-file api test or the app `bun run build`)
- **After every plan wave:** Run `cd api && bun test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green + every app builds
- **Max feedback latency:** 120 seconds (full suite well under this; single-file/build ≤ 30 s)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 04-01-01 | 01 | 0 | MKT-01, CUST-03, MKT-03, LINE-04, DEL-05 | migration/unit | `cd api && bun test tests/migrate.test.ts tests/settings.test.ts` | ⬜ pending |
| 04-01-02 | 01 | 0 | (backbone) | full-suite | `cd api && bun test` | ⬜ pending |
| 04-02-01 | 02 | 1 | MKT-01, CUST-03, MKT-03, LINE-04, DEL-05 | smoke | `cd api && bun test tests/health.test.ts` | ⬜ pending |
| 04-02-02 | 02 | 1 | (route/view freeze) | build | `cd web-admin && bun run build` | ⬜ pending |
| 04-03-01 | 03 | 2 | MKT-01, CUST-03 | unit/race (tdd) | `cd api && bun test tests/coupon.test.ts tests/coupon-race.test.ts tests/loyalty.test.ts` | ⬜ pending |
| 04-03-02 | 03 | 2 | MKT-01, CUST-03 | integration (tdd) | `cd api && bun test tests/checkout-discount.test.ts tests/order-transition.test.ts tests/order-endpoint-race.test.ts` | ⬜ pending |
| 04-03-03 | 03 | 2 | MKT-01, CUST-03 | integration+build | `cd api && bun test tests/coupon.test.ts && cd ../web-admin && bun run build` | ⬜ pending |
| 04-04-01 | 04 | 2 | ORD-05 | integration (tdd) | `cd api && bun test tests/product-images.test.ts tests/catalog.test.ts` | ⬜ pending |
| 04-04-02 | 04 | 2 | ORD-05 | build | `cd web-admin && bun run build` | ⬜ pending |
| 04-05-01 | 05 | 2 | DEL-05 | unit/integration (tdd) | `cd api && bun test tests/tracking.test.ts tests/notify.test.ts` | ⬜ pending |
| 04-05-02 | 05 | 2 | DEL-05 | build | `cd web-admin && bun run build` | ⬜ pending |
| 04-06-01 | 06 | 2 | MKT-03, LINE-04 | integration (tdd) | `cd api && bun test tests/broadcast-audience.test.ts` | ⬜ pending |
| 04-06-02 | 06 | 2 | MKT-03, LINE-04 | integration (tdd) | `cd api && bun test tests/webhook-bot.test.ts tests/webhook.test.ts tests/chatbot-router.test.ts` | ⬜ pending |
| 04-06-03 | 06 | 2 | MKT-03, LINE-04 | build | `cd web-admin && bun run build` | ⬜ pending |
| 04-07-01 | 07 | 2 | CROP-07 | unit (tdd) | `cd api && bun test tests/crop-recommend.test.ts tests/forecast.test.ts` | ⬜ pending |
| 04-07-02 | 07 | 2 | CROP-07 | build | `cd web-admin && bun run build` | ⬜ pending |
| 04-08-01 | 08 | 3 | ORD-05 | build | `cd web-store && bun run build` | ⬜ pending |
| 04-08-02 | 08 | 3 | ORD-05 | build | `cd web-store && bun run build` | ⬜ pending |
| 04-10-01 | 10 | 3 | MKT-01, CUST-03, MKT-03 | integration (tdd) | `cd api && bun test tests/consent-optout.test.ts tests/broadcast-audience.test.ts tests/consent.test.ts` | ⬜ pending |
| 04-10-02 | 10 | 3 | MKT-01, CUST-03, MKT-03 | build | `cd web && bun run build` | ⬜ pending |
| 04-10-03 | 10 | 3 | MKT-03 | build | `cd web && bun run build` | ⬜ pending |
| 04-09-01 | 09 | 4 | ORD-05 | build | `cd web-store && bun run build` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Checkpoints (04-08 pkg-legitimacy, 04-09 hosting decision + web UAT) are manual — see below.*

---

## Wave 0 Requirements

Wave 0 = the migration-0005 backbone (Plan 04-01). It MUST be green before any feature wave (2+) samples, because every feature test resets the schema and would fail teardown drop-order without 0005 registered.

- [ ] Register new migration `0005_phase4` in every self-resetting test harness — **38 files** (lesson from migration 0004 = 38 self-resetting tests; enumerated in 04-PATTERNS.md). MUST precede feature waves.
- [ ] `tests/migrate.test.ts` proves 0005 up → down → up reversible.
- [ ] Test stubs/fixtures for coupon atomic redemption (`coupon-race.test.ts`), loyalty ledger (`loyalty.test.ts`), and the discount → whole-baht QR invariant (`checkout-discount.test.ts`).
- [ ] Full suite `cd api && bun test` green after 0005 registered (0 fail) — sets `wave_0_complete: true`.

`wave_0_complete` flips **true** once Plan 04-01 lands and the full api suite is green with 0005 registered in all 38 files.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `@nuxtjs/seo` package legitimacy | ORD-05 | Supply-chain gate (blocking-human) | Verify the package on npmjs.com before install (04-08 checkpoint) |
| Public web storefront browse → cart → checkout end-to-end | ORD-05 | Cross-app SSR UI + PromptPay | Load web store, add item, checkout as guest, pay via PromptPay QR (04-09 UAT) |
| Nuxt SSR hosting target | ORD-05 | Infra decision (Cloudflare Pages vs VPS) | Owner selects host + real-domain owner (04-09 decision checkpoint) |
| Segmented LINE broadcast delivery | MKT-03 / LINE-04 | Requires live LINE OA + real recipients | Admin sends broadcast to a consented segment; confirm receipt |
| Conversational chatbot takes an order | LINE-04 | Live LINE webhook conversation | Message the OA, complete a rule-based order flow, confirm LIFF deep-link |
| LIFF checkout coupon/points + opt-out + re-consent | MKT-01 / CUST-03 / MKT-03 | Live LIFF + LINE identity | Apply a coupon at LIFF checkout, redeem points as a member, opt out of marketing, confirm re-consent after a version bump |

*All stock-correctness / discount-invariant / consent-filter paths have automated verify (04-03, 04-06, 04-10). Manual items are UI/live-channel confirmations only.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has a test or build gate)
- [x] Wave 0 covers all MISSING references (migration 0005 in 38 files)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready (execution flips `wave_0_complete` after 04-01 lands green)
