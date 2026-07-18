---
phase: 04-web-store-marketing-scale
plan: 06
subsystem: marketing
tags: [broadcast, line-multicast, pdpa-consent, chatbot, pg-boss, admin-ui]
requires:
  - "04-01 (schema 0005: broadcasts, customer_tags, consent trail)"
  - "04-02 (composition freeze: inert broadcastsRoutes stub + BroadcastComposer stub)"
provides:
  - "services/broadcast.ts: resolveAudience (consent-filtered) + chunk + runBroadcast"
  - "routes/broadcasts.ts: owner|admin compose/list/audience-count/send(schedule)/cancel"
  - "jobs/boss.ts: broadcast-send queue+worker on the direct workerDb"
  - "webhook.ts: rule-based guided order bot postback state machine"
  - "web-admin BroadcastComposer.vue: PDPA-scoped audience preview + send/schedule"
affects:
  - "api/src/jobs/boss.ts (new queue)"
  - "api/src/routes/webhook.ts (bot state machine after signature block)"
tech-stack:
  added: []
  patterns:
    - "DISTINCT ON (customer_id) … ORDER BY created_at DESC latest-consent filter (Pitfall 3)"
    - "parameterized sql fragments for the segment predicate (reports.ts whereFrag idiom)"
    - "≤500 multicast chunking (Pitfall 7)"
    - "pg-boss queue+worker on DATABASE_URL_DIRECT workerDb (Pitfall 6)"
    - "stateless-per-message postback state machine (step encoded in postback data, no LLM)"
key-files:
  created:
    - api/src/services/broadcast.ts
    - api/tests/broadcast-audience.test.ts
    - api/tests/webhook-bot.test.ts
  modified:
    - api/src/routes/broadcasts.ts
    - api/src/jobs/boss.ts
    - api/src/routes/webhook.ts
    - web-admin/src/views/BroadcastComposer.vue
decisions:
  - "Composer flow = save draft → GET /:id/audience-count → send; the count is ALWAYS routed through resolveAudience so a hand-crafted segment can never bypass the PDPA marketing-consent filter."
  - "Bot flow is stateless: the step lives entirely in the postback data (order_start → order_step=browse → order_step=confirm); terminal step is a LIFF URI deep-link, never money."
  - "broadcast-send worker marks the row sent (idempotency at the route: a sent row is re-send-blocked 409); no singletonKey needed for MVP."
metrics:
  tasks: 3
  files_touched: 8
  tests_added: 2
  duration_min: 30
  completed: 2026-07-18
status: complete
---

# Phase 4 Plan 06: Segmented Marketing Broadcast + Guided Order Bot Summary

Consent-filtered LINE multicast broadcasts (predefined segment or tag, send-now or scheduled) delivered only to marketing-consented, LINE-reachable customers, plus a rule-based (no-LLM) postback order bot that deep-links to LIFF to pay — the webhook signature block untouched.

## What was built

**Task 1 — broadcast service + admin route + queue (MKT-03/LINE-04).**
- `services/broadcast.ts`: `resolveAudience(db, segment)` runs a `DISTINCT ON (customer_id) … ORDER BY cl.created_at DESC` query over the append-only `consent_logs` marketing trail, keeps the LATEST row per customer, and admits only `granted=true` rows with a non-null `line_user_id` (Pitfall 3 / PDPA T-04-18). The segment predicate (`all`/`b2c`/`b2b`/`subscription`/`inactive` + optional tag) is built from parameterized `sql` fragments (never string concat). `chunk()` splits the audience into ≤500-id batches (Pitfall 7). `runBroadcast()` multicasts each batch and marks the row `sent` with the delivered count (network guarded off under `NODE_ENV=test`).
- `routes/broadcasts.ts`: replaced the 04-02 stub with `requireRole("owner","admin")` compose / list / `GET /:id/audience-count` / send(+schedule) / cancel. Send enqueues `boss.send("broadcast-send", {broadcastId}, {startAfter})`; cancel deletes only `draft`/`scheduled` rows (a `sent` campaign is immutable → 409).
- `jobs/boss.ts`: added the `broadcast-send` queue+worker on the DIRECT `workerDb` (Pitfall 6 — never a new pool).

**Task 2 — guided order bot (LINE-04, TDD).** Extended `webhook.ts` STRICTLY after `validateSignature` into a rule-based (D-19, no LLM) postback state machine: `order_start → order_step=browse → order_step=confirm`; non-terminal steps reply with a Flex postback button that advances the flow, the terminal step replies with a URI button deep-linking to LIFF to pay (D-20). The bot emits no price/amount. Unknown input still falls through to the existing canned reply. The raw-bytes/signature block is byte-identical.

**Task 3 — BroadcastComposer.vue.** Replaced the stub with a segment picker (selected-tile ring-accent), message composer (text + promo link), a save-draft → `GET /:id/audience-count` preview showing `ส่งถึง {n} คน (เฉพาะผู้ยินยอมรับข่าวสารการตลาด)` and the PDPA empty state when zero, send-now / schedule (one accent CTA), and cancel-scheduled via the shared destructive-confirm dialog.

## Verification

- `broadcast-audience.test.ts` (4) — withdrawn customer excluded (latest-row filter), no-`line_user_id` excluded, re-grant re-included, chunking splits 1001 → [500,500,1]. GREEN.
- `webhook-bot.test.ts` (8) — each postback step transitions correctly, terminal deep-links to LIFF, bot emits no `฿`/`บาท`, unknown → canned fallback, bad/absent signature → 401. GREEN.
- `webhook.test.ts` + `chatbot-router.test.ts` — still green (signature + canned intact).
- `web-admin` `bun run build` — passes; `BroadcastComposer.vue` compiled and type-clean.
- Full api suite: **356 pass / 0 fail across 62 files** (confirms the `boss.ts` import edit caused no regression).

## Deviations from Plan

None affecting behavior. Notes:
- Task 1 committed the test + implementation together (single `feat` commit); Task 2 followed an explicit RED (`test`) → GREEN (`feat`) split. The plan is `type: execute` (task-level `tdd="true"`), so a per-task RED/GREEN commit split is not mandated at the plan level.

## Deferred Issues (out of scope)

- `web-admin` `vue-tsc` (`bun run typecheck`) fails **pre-existing** on `CouponComposer.vue:86` (Eden `Record<string, unknown>` body), shipped that way in 04-03. Not the Task-3 gate (`vite build` passes). BroadcastComposer.vue was written with a typed body literal so it does NOT repeat the issue. Logged in `deferred-items.md`.

## Threat coverage (from plan threat_model)

- T-04-18 (PDPA broadcast to non-consented) — resolveAudience latest-consent + non-null line_user_id; `broadcast-audience.test.ts`. Mitigated.
- T-04-19 (webhook signature bypass) — raw-bytes block untouched; `webhook-bot.test.ts` bad-signature regression. Mitigated.
- T-04-20 (non-admin sending) — `requireRole("owner","admin")` on every broadcast route. Mitigated.
- T-04-21 (worker on pooled endpoint) — worker on `DATABASE_URL_DIRECT` workerDb. Mitigated.
- T-04-22 (multicast cap exceeded) — ≤500 chunking. Mitigated (reverify cap in LINE docs before very large sends — A1).

## Commits

- `42d1f23` feat(04-06): consent-filtered LINE broadcast service + admin route + queue (Task 1)
- `74b4db7` test(04-06): add failing test for guided order bot postback state machine (Task 2 RED)
- `9122f15` feat(04-06): guided order bot postback state machine deep-links to LIFF (Task 2 GREEN)
- `abb8ead` feat(04-06): BroadcastComposer admin view with PDPA-scoped audience preview (Task 3)

## Known Stubs

None — all three surfaces are fully wired (service→route→queue; bot; composer→api).

## Self-Check: PASSED

All 6 created/modified key files exist on disk; all 4 commits present in git history.
