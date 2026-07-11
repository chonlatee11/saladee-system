---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 12
subsystem: api
tags: [settings, hot-config, line-webhook, chatbot, flex, liff, typebox, rbac, vue, tanstack-query]

# Dependency graph
requires:
  - phase: 03-01
    provides: "settings table (key/value jsonb), env.ts non-secret hot defaults (HOLD_WINDOW_SECONDS/HAIRCUT_DEFAULT_PCT/B2B_QUOTA_CEILING_PCT), settings route stub, config/delivery.ts + DeliveryConfigSchema"
  - phase: 03-03
    provides: "web-admin scaffold: Eden treaty<App>() client, useSession store, TanStack Query, single-column form conventions (VarietyParams.vue), Settings.vue stub + router entry"
  - phase: 01-commerce-core
    provides: "requireRole(owner,admin) guard, jose HS256 session, webhook.ts raw-bytes-first signature validation, notify.ts buildOrderFlex idiom"
provides:
  - "GET/PUT /settings — staff-gated hot config (hold window, haircut %, B2B quota ceiling, delivery zones/free-ship threshold) editable without redeploy; secret-absent (T-03-31)"
  - "services/settings.ts — allow-listed hot-config accessors over the settings table, env-default overlay; secrets never referenced"
  - "webhook.ts canned chatbot router — keyword/postback (เมนูรอบนี้/ราคาวันนี้/ของเหลือ) → Flex + LIFF deep-link; fallback text; NO NLU/NO in-chat order state (D-25)"
  - "web-admin Settings.vue + useSettings.ts — hot-config form, no secret fields"
affects: [03-verification, 03-ship, phase-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hot-config allow-list (HOT_KEYS map) as the ONLY read/write surface of the settings table — secrets structurally excluded"
    - "Manual Value.Check(closedSchema) in the PUT handler instead of Elysia body schema, because Elysia coercion silently STRIPS unknown props (would let a secret-shaped key no-op through as 200)"
    - "Canned chatbot: fixed keyword/postback → Flex map with LIFF deep-link footer button, reusing notify.ts bubble idiom; signature block untouched"

key-files:
  created:
    - api/src/services/settings.ts
    - api/tests/settings.test.ts
    - api/tests/chatbot-router.test.ts
    - web-admin/src/composables/useSettings.ts
  modified:
    - api/src/routes/settings.ts
    - api/src/routes/webhook.ts
    - api/tests/webhook.test.ts
    - web-admin/src/views/Settings.vue

key-decisions:
  - "Settings hot surface = 4 allow-listed keys (hold_window_seconds, haircut_default_pct, b2b_quota_ceiling_pct, delivery); rounds/daily-prices keep their own routes (rounds.ts/prices.ts) — settings table is scalar+delivery hot config only"
  - "PUT validation uses Value.Check on the raw parsed body (not Elysia's body schema) so an unknown/secret-shaped key returns 422 rather than being silently stripped — closes the write side of the secret boundary"
  - "Canned chatbot cards carry canned copy + a LIFF deep-link (live menu/price/stock data lives in the mini-app), so webhook.ts needs no DB coupling and stays a thin verified-event router"
  - "Settings.vue edits the free-shipping threshold (baht↔satang) and shows zones read-only; per-zone fee editing stays in delivery.ts (git/redeploy) to avoid shipping a partial DeliveryConfig"

patterns-established:
  - "Secret-absent test: serialize the settings response and assert it contains no env secret VALUE (len>=10) and no secret-shaped KEY (payee/secret/token/apikey/password/jwt)"
  - "Chatbot-router test: sign a Thai payload over exact raw bytes; assert keyword→flex+deep-link, postback→flex, unmatched→fallback text, and 401 on forged/absent signature"

requirements-completed: [ADM-03, MKT-02, ADM-02]

coverage:
  - id: D1
    description: "GET/PUT /settings hot config (hold window, haircut %, B2B ceiling, delivery) editable without redeploy, staff-gated"
    requirement: "ADM-03"
    verification:
      - kind: integration
        ref: "api/tests/settings.test.ts#admin updates haircut % + B2B ceiling; GET reflects it (no redeploy)"
        status: pass
      - kind: integration
        ref: "api/tests/settings.test.ts#RBAC gate — settings is staff-only (T-03-33)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Settings API never exposes any secret value or secret-shaped key; secret-shaped PUT key refused (422)"
    requirement: "ADM-03"
    verification:
      - kind: integration
        ref: "api/tests/settings.test.ts#NO secret value or secret-named key ever appears in the response"
        status: pass
      - kind: integration
        ref: "api/tests/settings.test.ts#a secret-shaped key in the body is refused by the schema (422)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Canned LINE chatbot: keyword/postback → Flex + LIFF deep-link, fallback text, no NLU/order state; webhook signature unchanged"
    requirement: "MKT-02"
    verification:
      - kind: integration
        ref: "api/tests/chatbot-router.test.ts#canned chatbot router — keyword → Flex + LIFF deep-link"
        status: pass
      - kind: integration
        ref: "api/tests/chatbot-router.test.ts#signature trust boundary is UNCHANGED (Pitfall 1 / T-03-32)"
        status: pass
    human_judgment: false
  - id: D4
    description: "web-admin Settings.vue hot-config form (no secret fields) typechecks and follows single-column form conventions"
    requirement: "ADM-02"
    verification:
      - kind: unit
        ref: "cd web-admin && bunx vue-tsc --noEmit (EXIT=0)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live back-office verify: admin edits haircut/hold → saved w/o redeploy, no payee/slip-key shown; LINE chat keyword → Flex + LIFF button, fallback"
    requirement: "MKT-02"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint (gate=blocking): web-admin :5174 + API :3000 login admin + LINE OA keyword test"
        status: unknown
    human_judgment: true
    rationale: "Live cross-origin admin save + real LINE OA chat rendering Flex/deep-link inside the LINE client requires a human in the loop; automation cannot exercise the LINE client render or the live LIFF open."

# Metrics
duration: ~20min
completed: 2026-07-11
status: complete
---

# Phase 3 Plan 12: Hot Settings + Canned LINE Chatbot Summary

**Staff-gated GET/PUT /settings hot config (hold window, haircut %, B2B quota ceiling, delivery) editable without redeploy and provably secret-absent, plus a canned LINE chatbot router (keyword/postback → Flex + LIFF deep-link, fallback) that leaves the raw-bytes signature check untouched.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-11T01:05Z (approx)
- **Completed:** 2026-07-11T01:12Z
- **Tasks:** 2 auto tasks done; Task 3 = human-verify checkpoint (pending, gate=blocking)
- **Files created:** 4 · **Files modified:** 4

## Accomplishments
- `services/settings.ts`: hot config read/write keyed on a 4-entry allow-list (`HOT_KEYS`), overlaying env non-secret defaults on `settings` table override rows. Secrets (payee id, slip-verify key, LINE/JWT/R2) are never imported or referenced — structurally impossible to surface.
- `routes/settings.ts` (filled stub): `requireRole("owner","admin")` on both verbs; PUT validated by `Value.Check` against a closed (`additionalProperties:false`) schema so an unknown/secret-shaped key returns 422 — Elysia's body coercion strips unknown props silently, so manual checking is what actually closes the write side.
- `webhook.ts`: canned chatbot router — text keyword (เมนูรอบนี้/ราคาวันนี้/ของเหลือ) OR postback data → a Flex bubble with a LIFF deep-link footer button (notify.ts idiom); unmatched → fallback text. The raw-bytes-first signature block (lines 37–47 equivalent) is byte-for-byte unchanged; no TypeBox body attached (Pitfall 1). No NLU, no in-chat order state (D-25).
- web-admin `Settings.vue` + `useSettings.ts`: single-column max-w-640 hot-config form (hold window, haircut %, B2B ceiling, free-ship threshold in baht) with validation + saved states; zones shown read-only; NO secret field anywhere. `vue-tsc --noEmit` clean.
- Tests: `settings.test.ts` (hot upsert, RBAC 401/403, secret-value-absent + secret-key-absent + secret-key-write-refused 422) and `chatbot-router.test.ts` (keyword→Flex+deep-link, postback→Flex, fallback, signature preserved) — 19/19 green incl. the untouched `webhook.test.ts` signature tests.

## Task Commits

1. **Task 1 (RED): failing settings + chatbot-router tests** - `13a7159` (test)
2. **Task 1 (GREEN): settings service+route + canned chatbot router** - `d45e1bf` (feat)
3. **Task 2: web-admin Settings view + useSettings** - `bdfa9f0` (feat)

**Plan metadata:** (docs commit — this SUMMARY + STATE + ROADMAP)

_Note: Task 1 is TDD (test → feat)._

## Files Created/Modified
- `api/src/services/settings.ts` - allow-listed hot-config accessors (get/set), env-default overlay, secret-free
- `api/src/routes/settings.ts` - staff-gated GET/PUT; Value.Check closed-schema 422 on unknown keys
- `api/src/routes/webhook.ts` - canned keyword/postback → Flex + LIFF deep-link + fallback; signature block unchanged
- `api/tests/settings.test.ts` - hot upsert, RBAC, secret-absent + secret-write-refused
- `api/tests/chatbot-router.test.ts` - keyword/postback→Flex, fallback, signature preserved
- `api/tests/webhook.test.ts` - retargeted echo assertion to canned fallback (behavior change D-25)
- `web-admin/src/composables/useSettings.ts` - TanStack Query read + save-patch mutation
- `web-admin/src/views/Settings.vue` - hot-config form (no secret fields), validation + saved states

## Decisions Made
- Settings table hot surface = 4 allow-listed keys; rounds & daily prices keep their existing routes. The settings API is scalar + delivery hot config only.
- PUT validated with `Value.Check` on the raw body, not Elysia's `body:` schema — Elysia strips unknown props before validation, which would let a secret-shaped key slip through as a silent 200; manual check returns the required 422.
- Canned chatbot cards are canned copy + LIFF deep-link (live data lives in the mini-app) → webhook.ts stays DB-free and thin.
- Settings.vue edits the free-ship threshold + scalars; per-zone fee editing stays in delivery.ts (avoids shipping a partial/invalid DeliveryConfig from the UI).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Elysia body-schema coercion strips unknown keys → secret-write test failed**
- **Found during:** Task 1 (GREEN)
- **Issue:** With a TypeBox `body:` schema (`additionalProperties:false`), Elysia silently CLEANS unknown properties before validating, so a secret-shaped PUT key (`promptpayPayeeId`) returned 200 instead of 422 — the write-side secret boundary was not actually enforced.
- **Fix:** Dropped the Elysia `body:` schema and validate the raw parsed body with `Value.Check(HotSettingsPatchSchema, body)` in the handler, returning 422 on any unknown/out-of-range key.
- **Files modified:** api/src/routes/settings.ts
- **Verification:** `settings.test.ts` secret-key-refused (422) + out-of-range (422) now pass.
- **Committed in:** `d45e1bf` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Retargeted webhook.test.ts echo assertion**
- **Found during:** Task 1 (RED)
- **Issue:** The pre-existing `webhook.test.ts` asserted the handler ECHOES the inbound text; the D-25 canned router replaces echo with keyword→Flex / fallback, so the echo assertion would break on unchanged behavior expectations.
- **Fix:** Retargeted that one test to assert the fallback text (an unmatched Thai phrase → guidance text). The two signature tests (forged/absent → 401) are unchanged.
- **Files modified:** api/tests/webhook.test.ts
- **Verification:** webhook.test.ts green (3/3); signature 401 tests untouched.
- **Committed in:** `13a7159` (RED test commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both necessary — #1 is what actually enforces the secret write-boundary the plan requires; #2 aligns a placeholder test with the intended D-25 behavior. No scope creep.

## Issues Encountered
- Initial test run used a wrong `TEST_DATABASE_URL_DIRECT` override (saladee@5432) → auth-failed; the committed default (`saladee_test@55432`) is correct. Re-ran with the default and all suites are green. No code impact.

## TDD Gate Compliance
- RED commit `13a7159` (test) precedes GREEN commit `d45e1bf` (feat). Gate sequence satisfied.

## User Setup Required
None for the code. Go-live note (carried from Phase 2): set `LIFF_ID` (or `VITE_LIFF_ID`) in the API env so chatbot deep-links resolve to the real mini-app; unset yields `https://liff.line.me//...` (link without id).

## Threat Surface
- T-03-31 (secret in settings API): mitigated — service references only non-secret env defaults + allow-listed keys; response asserted free of any secret value/key; PUT refuses unknown keys (422).
- T-03-32 (webhook forgery via chatbot): mitigated — raw-bytes-first `validateSignature` block unchanged; forged/absent signature → 401 before the router runs.
- T-03-33 (settings elevation): mitigated — `requireRole("owner","admin")` on GET+PUT; grower/customer → 403.
- T-03-34 (log LINE token/secret): mitigated — no token/secret logged; canned router logs nothing sensitive.
- No new security surface beyond the plan's threat register.

## Next Phase Readiness
- ADM-03 + MKT-02 delivered; hot config changes without redeploy, secrets stay in env.
- **PENDING human verification (Task 3, gate=blocking):** run `cd web-admin && bun run dev` (:5174) with API :3000 — login admin → ตั้งค่าระบบ, edit haircut/hold window → save applies without redeploy and no payee/slip-key appears; then in the LINE OA type "เมนูรอบนี้" / "ราคาวันนี้" / "ของเหลือ" → each returns a Flex card with a LIFF button, and any other text → fallback. Automated suites are green; the live cross-origin save + LINE-client Flex render are the only unverified items.

## Self-Check: PASSED
- All 4 created files present on disk (services/settings.ts, tests/settings.test.ts, tests/chatbot-router.test.ts, web-admin/composables/useSettings.ts); 4 modified files updated.
- All 3 task commits found in git log: 13a7159, d45e1bf, bdfa9f0.
- Automated verification green: `bun test settings/chatbot-router/webhook` 19/19, `tsc --noEmit` API clean, `vue-tsc --noEmit` web-admin EXIT=0.

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-11*
