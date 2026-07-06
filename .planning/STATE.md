---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 3
current_phase_name: Back-office, Crop Planning & B2B/Subscription
status: verifying
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-07-06T16:28:29.116Z"
last_activity: 2026-07-06
last_activity_desc: Phase 02 complete, transitioned to Phase 3
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 22
  completed_plans: 22
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-28)

**Core value:** ลูกค้าสั่งผักสลัดผ่าน LINE แล้วจ่ายเงินจบในที่เดียว และจำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ (ไม่ oversell, ไม่เหลือทิ้ง)
**Current focus:** Phase 02 — line-storefront-payments-delivery

## Current Position

Phase: 3 — Back-office, Crop Planning & B2B/Subscription
Plan: Not started
Status: Phase complete — ready for verification
Last activity: 2026-07-06 — Phase 02 complete, transitioned to Phase 3
Note: CR-01/CR-02 code-review test-gaps CLOSED — added regression tests api/tests/verified-slip-park.test.ts (verified slip parked as awaiting_review + 202 when order cancelled mid-verify) and api/tests/created-hold-sweep.test.ts (created-path holdExpiresAt set + swept). api bun test 187 pass / 0 fail.

Progress: [████████░░] 77%

## Performance Metrics

**Velocity:**

- Total plans completed: 14
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 9 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 00 P01 | 8 | 3 tasks | 25 files |
| Phase 00 P08 | 20 | 3 tasks | 5 files |
| Phase 02 P01 | 15 | 3 tasks | 41 files |
| Phase 02 P02 | 11min | 3 tasks | 20 files |
| Phase 02 P03 | 25m | 2 tasks | 7 files |
| Phase 02 P04 | 30min | 3 tasks | 11 files |
| Phase 02 P05 | 6min | 2 tasks | 11 files |
| Phase 02 P06 | ~35m | 2 tasks | 9 files |
| Phase 02 P07 | 20m | 2 tasks | 6 files |
| Phase 02 P09 | 6min | 2 tasks | 8 files |
| Phase 02 P08 | 25m | 2 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Modular monolith, single Elysia/Bun + PostgreSQL on one always-on VPS (NFR-08); no serverless (cold starts break webhook/reaper).
- [Roadmap]: Reservation core (guarded atomic decrement) is the defining risk — built and load-tested in Phase 1 with a `quota`/`reserved` split so B2B quota + subscriptions plug in without rewrite.
- [Roadmap]: Slip-verification API (PAY-02) and price-at-order-time snapshot pulled into early phases; PDPA/security are v1, not deferred.
- [Roadmap]: Phase 1 ships MANUAL sellable qty; crop-planning auto-feed (CROP-04) replaces it in Phase 3 with manual override kept permanently.
- [Phase ?]: [00-01] Interface-first stub seams (db/storage/line/auth plugins + webhook/files/auth route stubs) with a FIXED index.ts composition order let wave-2 slices fill their own module only, never editing index.ts — enables parallel disjoint-file execution.
- [Phase ?]: [00-01] .env.test committed at both repo root and api/ so 'cd api && bun test' boot-validates from the api cwd (Bun loads env from cwd); real .env stays gitignored.
- [Phase ?]: [02-01] pg-boss runs on DATABASE_URL_DIRECT and starts only under import.meta.main so bun test never spins a worker.
- [Phase ?]: [02-01] applyTransition() is the single guarded transition path reused by staff PATCH, slip-verify (02-06), and hold-expiry (02-07) — cannot re-break the concurrent-cancel oversell fix.
- [Phase ?]: 02-03: delivery fee is a committed TypeBox-validated config file (zone×method flat rate); DB zones deferred to Phase 3
- [Phase ?]: 02-03: /delivery/quote is public + display-only; checkout 02-04 recomputes+snapshots the fee (never trusts client)
- [Phase ?]: 02-04: LINE checkout — delivery+consent optional; awaiting_payment/QR/hold/consent activate only with a delivery choice (preserves Phase-1 created-status oversell tests)
- [Phase ?]: 02-04: PromptPay CRC produced by promptpay-qr and independently re-derived in the golden-vector test; never hand-rolled
- [Phase ?]: 02-06: DB partial UNIQUE index is the sole system-wide slip dedup arbiter; 23505 unwrapped from DrizzleQueryError.cause → 409 duplicate_slip
- [Phase ?]: 02-06: SlipVerifier seam (env-selected) keeps SlipOK swappable; ambiguous/quota/5xx/network → 'unavailable' → admin manual-confirm (money-safe)
- [Phase 02]: 02-09 reorder returns a proposed cart (does not auto-place); re-prices at the current open round and flags sold-out/absent items (D-20)
- [Phase 02]: 02-09 member-only /me/orders guard keyed on customers.line_user_id; guests 403, missing token 401 (D-19)

### Pending Todos

None yet.

### Blockers/Concerns

Flagged during research for deeper planning:

- Phase 2 (payments): concrete slip-verification provider (EasySlip/SlipOK/KBank/RDCW) + budget needs a spike before commit.
- Phase 3 (crop): per-variety yield params are SRS placeholders; confidence-haircut + harvest-confirmation gate policy needs domain modeling.
- Phase 3 (B2B/subscription): quota-overflow policy and pause/skip cut-off semantics are business decisions to encode.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — all optional enhancements completed 2026-07-02)* | | | |

**Phase 0 host is LIVE + fully wired:**

- API: DigitalOcean droplet `146.190.100.171` (SGP1), Docker (api + caddy), HTTPS `https://146.190.100.171.sslip.io`. All 4 success criteria verified live.
- Web: Cloudflare Pages `https://saladee-web.pages.dev` (Eden Treaty client → live API).
- CI: push to `develop` auto-deploys API (SSH → docker compose) and web (→ Pages). `NODE_ENV=production` on the droplet. GitHub secrets set: `VPS_HOST/VPS_USER/VPS_SSH_KEY`, `CLOUDFLARE_API_TOKEN/ACCOUNT_ID`; var `VITE_API_URL`. Droplet is a git clone (read-only deploy key).
- Remaining optional only: swap sslip.io for a real domain if/when desired.

## Quick Tasks Completed

| Date | Task | Slug | Status |
|------|------|------|--------|
| 2026-07-06 | Fix Phase-2 LIFF UI blockers (max-w-md 16px collision, missing checkout CTA, remove missing Sarabun @font-face) | 260706-swg-fix-phase-2-liff-ui-blockers-max-w-md-16 | complete ✓ |
| 2026-07-06 | Add Slip2Go slip-verification adapter (new default, replaces SlipOK) | 260706-tbn-add-slip2go-slip-verification-adapter-an | complete ✓ |
| 2026-07-06 | Loading spinner + full-screen busy overlay across the LIFF | 260706-ut1-add-loading-spinner-full-screen-busy-ove | complete ✓ |
| 2026-07-06 | Wire LINE member order linkage (order.customer_id + recipient snapshot) — closes Phase-2 UAT-4 | 260706-vr5-wire-line-member-order-linkage-customeri | complete ✓ |

## Session Continuity

Last session: 2026-07-04T12:43:39.048Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None
