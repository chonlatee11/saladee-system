---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: line-storefront-payments-delivery
status: executing
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-07-04T12:13:06.209Z"
last_activity: 2026-07-04
last_activity_desc: Phase 02 execution started
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 22
  completed_plans: 20
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-28)

**Core value:** ลูกค้าสั่งผักสลัดผ่าน LINE แล้วจ่ายเงินจบในที่เดียว และจำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ (ไม่ oversell, ไม่เหลือทิ้ง)
**Current focus:** Phase 02 — line-storefront-payments-delivery

## Current Position

Phase: 02 (line-storefront-payments-delivery) — EXECUTING
Plan: 8 of 9
Status: Ready to execute
Last activity: 2026-07-04 — Phase 02 execution started

Progress: [████████░░] 77%

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |

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

## Session Continuity

Last session: 2026-07-04T12:12:58.369Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None
