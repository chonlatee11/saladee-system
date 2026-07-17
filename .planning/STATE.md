---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: web-store-marketing-scale
status: executing
stopped_at: Phase 04 UI-SPEC approved
last_updated: "2026-07-17T16:17:58.834Z"
last_activity: 2026-07-17
last_activity_desc: Phase 04 execution started
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 47
  completed_plans: 38
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-28)

**Core value:** ลูกค้าสั่งผักสลัดผ่าน LINE แล้วจ่ายเงินจบในที่เดียว และจำนวนที่เปิดขายตรงกับผลผลิตจริงเสมอ (ไม่ oversell, ไม่เหลือทิ้ง)
**Current focus:** Phase 04 — web-store-marketing-scale

## Current Position

Phase: 04 (web-store-marketing-scale) — EXECUTING
Plan: 2 of 10
Status: Ready to execute
Last activity: 2026-07-17 — Phase 04 execution started
Note: Decision-coverage gate (13a) reported 21/28 — OVERRIDE (known false-negative, [[decision-coverage-gate-false-negative]]): the 7 "uncovered" decisions (D-03/05/09/10/16/22/24) ARE implemented in plan must_haves/truths as prose but not tagged with literal `D-NN:` tokens; plan-checker goal-backward confirmed D-01..D-28 all have implementing tasks. Verify-phase should re-check these are honored in code.

Progress: [████████░░] 77%

## Performance Metrics

**Velocity:**

- Total plans completed: 29
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 9 | - | - |
| 03 | 15 | - | - |

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
| Phase 03 P01 | 45 min | 3 tasks | 42 files |
| Phase 03 P02 | 18min | 2 tasks | 7 files |
| Phase 03 P03 | 30min | 2 tasks | 25 files |
| Phase 03 P04 | 35min | 3 tasks | 9 files |
| Phase 03 P06 | ~40min | 2 tasks | 7 files |
| Phase 03 P10 | 22min | 2 tasks | 4 files |
| Phase 03 P11 | 35min | 3 tasks | 5 files |
| Phase 03 P12 | 20min | 2 tasks | 8 files |
| Phase 03 P05 | ~45min | 3 tasks | 7 files |
| Phase 03 P08 | ~40min | 3 tasks | 12 files |
| Phase 03 P13 | 4min | 2 tasks | 3 files |
| Phase 03 P15 | 3min | 1 tasks | 1 files |
| Phase 03 P14 | 8min | 3 tasks | 5 files |
| Phase 04 P01 | 20 | 2 tasks | 44 files |

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
- [Phase 03]: [03-01] New varieties yield columns (days_to_harvest/survival_pct/shelf_life_days) are notNull WITH DB defaults (30/90/7), mirroring the deliveryClass additive idiom — notNull-no-default breaks ADD COLUMN on populated tables + existing insert sites; defaults keep migration prod-safe and let the CROP-01 slice enforce real values at the route layer
- [Phase 03]: [03-01] Every self-resetting test file (26) + migrate.test.ts now register 0004 in their down/up sequences — 0004 child tables FK into varieties/customers/rounds/orders; teardown must drop 0004 first or 0001 down fails — keeps the 204-test regression gate green
- [Phase 03]: 03-02: pdfmake 0.3.x server API — PdfPrinter(fonts, virtualfs, urlResolver, localAccessPolicy) + async createPdfKitDocument; A1 Thai-PDF spike PASSES on Bun, no vfs fallback needed
- [Phase ?]: 03-04: forecast.ts pure UTC-date kernel (projected harvest / floored yield haircut D-02 / best-before D-05), reused by 03-05 publish
- [Phase ?]: 03-04: planting-batch hard-delete (no active column in frozen schema); mix idempotency by plantDate+variety overlap (no template FK)
- [Phase 03]: Subscription generator idempotency = DB UNIQUE(subscription,round) as last insert in per-sub own-tx (23505 rolls back order+reserve); subscription-generate trigger owned by 03-05 publishQuota, queue+worker defined in 03-07 — Retry-safe without a second counter; reuses reserveBox reserve-before-B2C path (Pitfall 1/2)
- [Phase ?]: Settings hot surface = 4 allow-listed keys; secrets stay in env.ts, never in settings table/API (T-03-31)
- [Phase ?]: PUT /settings validates raw body via Value.Check (closed schema), not Elysia body schema which strips unknown props — secret-shaped key rejected 422
- [Phase ?]: Canned LINE chatbot: keyword/postback -> Flex + LIFF deep-link; webhook signature block unchanged (D-25/Pitfall 1)
- [Phase ?]: publishQuota single-owns the round-open sequence: reserveStanding in the quota-write tx (atomic reserve-before-B2C) + subscription-generate once post-commit, one-shot per round — Guarantees CUST-05 reserve-before-B2C with no race window and no double-reserve on re-publish
- [Phase 03]: 03-08 customer LIFF: package value is server authority (S/M/L code only); /me/* endpoints reuse me-orders member gate + 03-06 wholesaleVisible — Close T-03-20 money tamper + T-03-21 wholesale leak on the customer surface without new auth
- [Phase ?]: 03-13: public catalog b2b tier gated via the ONE wholesaleVisible() rule (D-08/T-03-21) — optional-session .derive, fail-closed on invalid tokens, b2b keys nulled not removed (Eden shape unchanged)
- [Phase 03]: Standing-orders table: display labels joined into DisplayRow row data (not accessorFn closures) because TanStack Table memoizes accessor results per row
- [Phase 03]: 03-14: /b2b gets no Rich Menu cell (niche) — in-LIFF catalog quick-link covers CUST-02; catalog quick-links stay neutral (accent reserved for the sticky checkout CTA)
- [Phase 03]: 03-14: selected package/frequency reuses the DeliveryMethodTiles ring-2 ring-accent + fixed-footprint check badge verbatim — one approved selected pattern, no second variant
- [Phase ?]: 04-01: migration 0005 additive; reservation guard untouched

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
| 2026-07-17 | Fix WR-01: Cache-Control private + Vary Authorization on catalog (prevents shared-cache b2b wholesale leak) | 260717-wr1-catalog-cache-control-vary-authorization | complete ✓ |
| 2026-07-17 | Fix IN-03: fail-closed showB2bFor so a DB hiccup keeps catalog open (no 500) | 260717-in3-catalog-showb2bfor-fail-closed | complete ✓ |
| 2026-07-17 | Fix WR-02: key standing-order rows by stable _key not index (splice-delete state bug) | 260717-wr2-standing-orders-stable-row-key | complete ✓ |

## Session Continuity

Last session: 2026-07-17T16:17:41.708Z
Stopped at: Phase 04 UI-SPEC approved
Resume file: .planning/phases/04-web-store-marketing-scale/04-UI-SPEC.md
