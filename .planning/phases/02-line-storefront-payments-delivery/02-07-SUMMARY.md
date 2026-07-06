---
phase: 02-line-storefront-payments-delivery
plan: 07
subsystem: jobs-notifications
tags: [pg-boss, hold-expiry, sweep, applyTransition, line, flex, push, notify, webhook, ord-04, pay-03, line-03]
status: complete

requires:
  - "02-01: shared applyTransition(onlyIfHold) + OrderError; pg-boss boss/startJobs on DATABASE_URL_DIRECT; orders.holdExpiresAt + payments table"
  - "02-04: checkout schedules the hold-expiry timer + snapshots holdExpiresAt (the deadline this sweep reads)"
  - "02-06: slip-verify parks unavailable slips as payments.status='awaiting_review' (the row this expiry no-ops on)"
provides:
  - "expireHold(db, orderId) + sweepExpiredHolds(db) in api/src/jobs/boss.ts — the PAY-03 release half + safety-net"
  - "boss.work('hold-expiry') + boss.schedule('hold-sweep','*/2 * * * *') attached under startJobs()"
  - "buildOrderFlex()/pushOrderUpdate() (api/src/services/notify.ts) — members-only milestone Flex cards"
  - "registerOrderNotifier() seam in order-transition.ts — the single post-transition milestone push, fired once from applyTransition"
affects:
  - "02-08/02-09: any transition through applyTransition now emits a member Flex push automatically (no per-caller wiring)"

tech-stack:
  added: []
  patterns:
    - "Single notifier registry in applyTransition: staff PATCH, slip-verify, and hold-expiry all notify exactly once from one seam — no scattered push calls"
    - "Fire-and-forget post-update notify (captured by value, never awaited into the tx) so a LINE outage can never roll back a committed transition"
    - "NODE_ENV=test guard on the boot-registered live push so importing notify.ts in the suite never hits the LINE API; pushOrderUpdate stays testable via an injected client"
    - "Injected worker db (expireHold(db, …)) so the job is unit-testable against real PG without a running pg-boss worker"
    - "Coarse sweep pre-filter (status=awaiting_payment AND holdExpiresAt<now) + authoritative per-order guarded cancel — self-heals the commit-then-crash window (Pitfall 2)"

key-files:
  created:
    - api/src/services/notify.ts
  modified:
    - api/src/jobs/boss.ts
    - api/src/services/order-transition.ts
    - api/src/routes/webhook.ts
    - api/tests/hold-expiry.test.ts
    - api/tests/notify.test.ts

key-decisions:
  - "The milestone push is wired ONCE inside applyTransition (via a module-level notifier registry), not at each call site. order-transition.ts stays dependency-free of notify.ts; notify.ts registers INTO it, and webhook.ts (already composed in index.ts) side-effect-imports notify.ts to trigger boot registration — no index.ts edit."
  - "applyTransition runs inside the caller's tx and cannot observe commit, so the push is fire-and-forget after the status UPDATE with data captured by value. This is the pragmatic 'post-commit-ish' seam; applyTransition is the terminal DB op in all three call sites, so the rollback-leak surface is effectively nil."
  - "expireHold no-ops when a payments row is awaiting_review/verifying (checked BEFORE the guarded cancel), so an admin manual-confirm is never cancelled out from under (D-04 ↔ D-09). The onlyIfHold gate independently protects paid/packing/shipping orders."
  - "packing AND shipping both map to the single 'กำลังจัดส่ง' card; created/awaiting_payment map to no milestone (zero pushes)."

requirements-completed: [PAY-03, ORD-04, LINE-03]

metrics:
  duration: ~20m
  completed: 2026-07-04
  tasks: 2
  files_created: 1
  files_modified: 5
  tests: "182 pass / 2 todo / 0 fail (full suite, was 173/6 after 02-06); +hold-expiry 4, +notify 5"
---

# Phase 2 Plan 7: Hold-Expiry Release + Milestone Flex Notifications Summary

Closed the back half of the payment lifecycle: an unpaid QR hold now self-heals its reserved stock on expiry (guarding paid orders AND slip-under-review orders, plus a 2-minute safety-net sweep), and every order milestone pushes exactly one Thai Flex card to members — wired once into the shared `applyTransition()` seam. Covers the release half of PAY-03, ORD-04, and LINE-03.

## What was built

**Task 1 — Hold-expiry worker + safety-net sweep** — commit `4dd8149`
- `api/src/jobs/boss.ts`: `expireHold(db, orderId)` runs in one transaction — it first NO-OPs when a `payments` row is `awaiting_review`/`verifying` (D-04 ↔ D-09, a human confirm is pending), then delegates to the shared `applyTransition(tx, orderId, "cancelled", { onlyIfHold: true })` which only cancels a `{created, awaiting_payment}` order and releases its reserved plants in the same tx (a paid/packing/shipping order is a safe no-op — Pitfall 1 / T-02-25). `sweepExpiredHolds(db)` is the authoritative self-heal (Pitfall 2 / T-02-26): it cancels every `awaiting_payment` order whose `holdExpiresAt` is already past, each in its own tx, via the same guarded path — closing the commit-then-crash window where the per-order timer was never scheduled. `startJobs()` now attaches `boss.work("hold-expiry")` and `boss.schedule("hold-sweep", "*/2 * * * *")` + its worker, all under the existing `import.meta.main` guard (a lazily-constructed worker db on `DATABASE_URL_DIRECT`).
- `api/tests/hold-expiry.test.ts`: raced against real PostgreSQL 17 — (a) an `awaiting_payment` hold is cancelled and its plants released exactly, (b) a `paid` order is a NO-OP (stock unchanged, still paid), (c) an `awaiting_review` order is skipped (still `awaiting_payment`, stock held), (d) the sweep self-heals a stranded past-deadline hold.

**Task 2 — Milestone Flex notifications wired into applyTransition + webhook extend** — commit `48d22fe`
- `api/src/services/notify.ts` (NEW): `buildOrderFlex(order, milestone)` builds a Flex bubble (order-summary body + a footer uri button "ดูคำสั่งซื้อ" deep-linking to `https://liff.line.me/<LIFF_ID>/orders/{orderId}`); `pushOrderUpdate(line, order, milestone)` pushes ONLY when the customer has a `line_user_id` (guests skipped silently, D-23 / T-02-28). Thai milestone copy for paid / shipping / done / cancelled matches 02-UI-SPEC. The module constructs its own `MessagingApiClient` from env (mirroring `line.plugin.ts`) and registers the single notifier into `order-transition.ts`; the live push is guarded off under `NODE_ENV=test`.
- `api/src/services/order-transition.ts`: added the `registerOrderNotifier()` registry, the `OrderNotifyData`/`Milestone` types, and the status→milestone map (`paid→paid`, `packing/shipping→shipping`, `done→done`, `cancelled→cancelled`; `created`/`awaiting_payment` → none). After the status UPDATE, `applyTransition` reads the recipient + amounts under the same tx and fires the notifier fire-and-forget — so staff PATCH, slip-verify (02-06), and hold-expiry (Task 1) all notify exactly once from this single seam (ORD-04).
- `api/src/routes/webhook.ts`: side-effect `import "../services/notify"` so the notifier registers at boot without editing `index.ts`; the raw-body-first signature validation is untouched and the route still has NO body schema (LINE-03 / Phase-0 Pitfall 1).
- `api/tests/notify.test.ts`: a member gets exactly one Flex push (arg `to` = the line_user_id, message type `flex`); a guest gets zero; `buildOrderFlex` carries the `/orders/{id}` deep-link button; and wired through `applyTransition`, a milestone transition (`awaiting_payment→paid`) pushes once while a non-milestone (`created→awaiting_payment`) pushes nothing. The line client is mocked.

## Verification
- `bunx tsc --noEmit` → clean.
- `bun test tests/hold-expiry.test.ts tests/notify.test.ts tests/webhook.test.ts` → all green.
- Full suite `bun test` → **182 pass / 2 todo / 0 fail** (was 173/6 after 02-06) — the hold-expiry + notify scaffolds are now green, zero regressions across the Phase-1 order/oversell tests. The 2 remaining todos are later-plan scaffolds (auth-line, reorder).
- Acceptance greps: `onlyIfHold`≥1 and `hold-sweep|holdExpiresAt`≥1 in boss.ts; `pushMessage`≥1, `line_user_id|lineUserId`≥1, `flex`≥1 in notify.ts; webhook.ts still has no body schema.

## Threat mitigations applied
- **T-02-25 (expiry cancels a just-paid order → releases sold stock):** `applyTransition` onlyIfHold gates `{created, awaiting_payment}` under a row lock; the paid-no-op test proves stock is untouched.
- **T-02-26 (stranded reserved stock when the timer never ran):** `sweepExpiredHolds` over `holdExpiresAt` every 2 min is authoritative; the sweep self-heal test proves it.
- **T-02-27 (forged LINE webhook):** the raw-body `validateSignature` path is unchanged; no body schema attached to the webhook route.
- **T-02-28 (push to the wrong user):** `pushOrderUpdate` targets the order's own `line_user_id` only; guests skipped.
- **T-02-29 (channel secret/token in logs):** env-only construction; the notifier logs nothing but an error string, never the token.

## Deviations from Plan

**1. [Rule 3 — path correction] Tests filled under api/tests/ (repo convention), not the plan's api/test/**
- **Found during:** both tasks.
- **Issue:** The plan frontmatter listed `api/test/hold-expiry.test.ts` / `api/test/notify.test.ts`; the repo convention is `api/tests/…`, where the Wave-0 scaffolds already lived (same correction as 02-01/02-04/02-06).
- **Fix:** Filled the existing `api/tests/{hold-expiry,notify}.test.ts` scaffolds.
- **Commit:** 4dd8149 / 48d22fe

**2. [Rule 3 — design] Notifier wired via a registry + webhook side-effect import (no index.ts edit)**
- **Found during:** Task 2.
- **Issue:** The plan requires the notify hook be wired "inside the shared applyTransition() post-commit seam" with "no boot-composition edit", but `order-transition.ts` runs inside the caller's tx (cannot observe commit) and importing `notify.ts` from it would create a circular import.
- **Fix:** `order-transition.ts` owns a module-level notifier registry and fires it fire-and-forget after the status UPDATE (data captured by value); `notify.ts` registers INTO it; `webhook.ts` (already composed in `index.ts`) side-effect-imports `notify.ts` so registration happens at boot. No `index.ts` edit, no circular import, single seam. Files touched match the plan's `files_modified` exactly (boss.ts, notify.ts, order-transition.ts, webhook.ts + the two tests) — no call-site edits to orders.ts/payments.ts.
- **Commit:** 48d22fe

## Known Stubs
None. The worker, sweep, notifier registry, and Flex builder are wired against the real schema, the shared `applyTransition`, real pg-boss, and a real `MessagingApiClient`. The only unexercised runtime is the live LINE push (guarded off in tests; credentials harness-locked) — its behavior is fully unit-tested via an injected client.

## Deferred Items
- **LINE Messaging live credentials (LINE_CHANNEL_ACCESS_TOKEN):** present in env as a test placeholder; the live push is guarded off under `NODE_ENV=test`. **Operator action:** set the real channel access token in the deployed env so milestone pushes fire in production. Non-blocking — the transition + release logic is fully live today.
- **LIFF_ID for the deep link:** the Flex button deep-links to `https://liff.line.me/<LIFF_ID>/orders/{orderId}`; the API reads `LIFF_ID`/`VITE_LIFF_ID` from env and falls back to an id-less link if unset. **Operator action:** set `LIFF_ID` in the deployed env before go-live so the "ดูคำสั่งซื้อ" button opens the correct LIFF order page.
- **pg-boss worker runtime:** the `hold-expiry` work handler + `hold-sweep` schedule only run under `import.meta.main` (the deployed server), never in `bun test`. Confirmed by inspection; exercised via direct `expireHold`/`sweepExpiredHolds` calls in the test.

## Requirements covered
PAY-03 (release half — hold-expiry auto-releases reserved stock, never touching paid/under-review orders, with a self-healing sweep), ORD-04 (auto LINE milestone notify, once per transition, members only), LINE-03 (webhook signature validation preserved + status notify).

## Self-Check: PASSED
- FOUND: api/src/services/notify.ts
- FOUND: api/src/jobs/boss.ts, api/src/services/order-transition.ts, api/src/routes/webhook.ts
- FOUND: api/tests/hold-expiry.test.ts, api/tests/notify.test.ts
- FOUND commits: 4dd8149, 48d22fe

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
