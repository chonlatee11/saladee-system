---
phase: 02-line-storefront-payments-delivery
plan: 02
subsystem: line-storefront
tags: [line-login, liff, vue, vue-router, tailwind-v4, rich-menu, jose, eden-treaty]

# Dependency graph
requires:
  - phase: 02-01
    provides: customers/orders schema + migration 0003, applyTransition, env keys, auth-line Wave-0 scaffold
  - phase: 01-commerce-core
    provides: verifyLineIdToken (ES256/JWKS) + issueSession + makeAuthRoutes(db) DI
provides:
  - "POST /auth/line — server-verified LINE Login: idToken (ES256/iss/aud) → member customer upsert by line_user_id → CUSTOMER session; returns { token, customerId, lineUserId }"
  - "Role union extended with 'customer' (staff ROLES unchanged) so /auth/line never mints a staff role (T-02-06)"
  - "web/src greenfield LIFF SPA shell: api.ts (Eden treaty<App>), liff.ts (initLiff/getIdToken/loginWithLine, guest path), style.css (Tailwind v4 @theme UI-SPEC tokens + self-hosted Sarabun), router.ts (all 9 route paths frozen), App.vue (Suspense + error boundary)"
  - "api/scripts/provision-rich-menu.ts — idempotent one-time LINE-01 provisioning (5 buttons, D-18)"
affects: [02-05, 02-08, 02-09]

# Tech tracking
tech-stack:
  added: [vue-router@5.1.0, lucide-vue-next@1.0.0]
  patterns:
    - "Router registers every customer route path up front (lazy chunks); later view plans only create/replace the SFCs, never edit router.ts"
    - "LIFF browser globals imported dynamically inside functions so bun test imports the modules DOM-free"
    - "Real ES256 idToken + stubbed JWKS fetch in test → exercises the genuine verifyLineIdToken, mocks only the network (no module mocking → no cross-file leakage)"

key-files:
  created:
    - api/scripts/provision-rich-menu.ts
    - web/src/api.ts
    - web/src/liff.ts
    - web/src/style.css
    - web/src/router.ts
    - web/src/App.vue
    - web/src/views/CatalogView.vue
    - web/src/views/PricesView.vue
    - web/src/views/VarietyDetailView.vue
    - web/src/views/CareView.vue
    - web/src/views/CheckoutWizard.vue
    - web/src/views/PayView.vue
    - web/src/views/OrderHistoryView.vue
    - web/src/views/OrderDetailView.vue
    - web/src/views/ContactView.vue
  modified:
    - api/src/routes/auth.ts
    - api/src/types.ts
    - api/tests/auth-line.test.ts
    - web/src/main.ts
    - web/package.json

key-decisions:
  - "Added 'customer' to the Role union rather than reusing a staff role — /auth/line must never mint owner/admin/grower/packer (T-02-06); requireRole is only called with staff roles so a customer session can never satisfy a staff gate"
  - "Only the idToken verify is wrapped in try/catch (→ 401); DB faults surface as 500 instead of a misleading invalid_id_token"
  - "Created placeholder stubs for ALL 9 view SFCs (not just PricesView/ContactView) because Vite fails the build on unresolved dynamic imports; owning plans (02-05/02-08/02-09) overwrite the 7 lazy stubs"
  - "Self-hosted Sarabun via absolute /fonts/*.woff2 URLs (served as-is, not bundled) so the build stays green before the font binaries are dropped in; system-font fallback renders meanwhile"

requirements-completed: [LINE-02]
requirements-partial: [LINE-01]

# Metrics
duration: 11min
completed: 2026-07-04
status: complete
---

# Phase 2 Plan 02: LINE Login + LIFF SPA Shell + Rich Menu Summary

**Server-verified LINE Login (idToken → member customer upsert → customer session), the greenfield Vue 3.5 + Vite 8 + Tailwind v4 LIFF SPA shell (Eden client, LIFF wiring, design tokens, a router with every customer route pre-registered), and an idempotent one-time Rich Menu provisioning script — walking-slice-zero for the storefront that every later customer slice enters through.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-04T10:47:20Z
- **Completed:** 2026-07-04T10:58:11Z
- **Tasks:** 3 code tasks complete + 1 human-verify checkpoint pending operator
- **Files created/modified:** 20

## Accomplishments

- **Real `POST /auth/line` (LINE-02):** replaced the Phase-1 placeholder. Verifies the LIFF idToken server-side via the existing `verifyLineIdToken` (jose ES256, `iss=https://access.line.me`, `aud=LINE_LOGIN_CHANNEL_ID` — Pitfall 4), upserts a member `customers` row keyed on `line_user_id = payload.sub` (`isMember=true`, name captured when present), and issues a **customer** session. Returns `{ token, customerId, lineUserId }`. A forged / expired / wrong-audience token is rejected `401 invalid_id_token` with no upsert.
- **Privilege-escalation guard (T-02-06):** added `"customer"` to the `Role` union while keeping `ROLES` the staff-only set, so a LINE login can never mint owner/admin/grower/packer and a customer session can never satisfy a `requireRole(...)` staff gate.
- **LIFF SPA shell:** split `main.ts` seams into `api.ts` (Eden `treaty<App>` — an api route change is a compile error in the app) and `liff.ts` (`initLiff`/`getIdToken`/`loginWithLine`, all guarded on `VITE_LIFF_ID`; the guest path runs without a LIFF id — D-17). `style.css` declares the UI-SPEC tokens in a Tailwind v4 `@theme` block + self-hosted Sarabun. `router.ts` registers all 9 customer route paths (lazy chunks) matching the Rich Menu deep links; `App.vue` is the router-view shell with a Suspense loading state + error boundary.
- **Rich Menu provisioning (LINE-01):** `provision-rich-menu.ts` builds the 5-button `saladee-main` menu (2500×1686, 3-top + 2-bottom, D-18 Thai labels/order), deep-linking into the LIFF routes; idempotent (deletes menus named `saladee-main` before create); token read from env only, never logged (T-02-07).
- **Verification green:** `bun test tests/auth-line.test.ts` = 5 pass; full api suite = 130 pass / 0 fail; `bunx tsc --noEmit` clean; `cd web && bun run build` exits 0 (16 chunks, one per view); `web` tests 2 pass; the script typechecks.

## Task Commits

1. **Task 1: Server-verified POST /auth/line + customer session** — `24485ff` (feat)
2. **Task 2: LIFF SPA shell (router, Eden client, LIFF wiring, tokens)** — `1d101dd` (feat)
3. **Task 3: Idempotent Rich Menu provisioning script** — `e836674` (feat)

## Files Created/Modified

- `api/src/routes/auth.ts` — real `POST /auth/line` (verify → member upsert → customer session)
- `api/src/types.ts` — `Role` union extended with `"customer"`; `StaffRole` alias; `ROLES` stays staff-only
- `api/tests/auth-line.test.ts` — filled the Wave-0 scaffold (real ES256 idToken + stubbed JWKS)
- `api/scripts/provision-rich-menu.ts` — one-time idempotent LINE-01 provisioning
- `web/src/api.ts` — Eden `treaty<App>` client + typed `getHealth`
- `web/src/liff.ts` — guarded `initLiff` / `getIdToken` / `loginWithLine` + session-token storage
- `web/src/style.css` — Tailwind v4 `@theme` UI-SPEC tokens + self-hosted Sarabun `@font-face`
- `web/src/router.ts` — all 9 customer route paths (frozen for later view plans)
- `web/src/App.vue` — router-view shell (Suspense fallback + error boundary)
- `web/src/views/{Prices,Contact}View.vue` — real minimal screens owned here
- `web/src/views/{Catalog,VarietyDetail,Care,CheckoutWizard,Pay,OrderHistory,OrderDetail}View.vue` — placeholder stubs the owning plans overwrite
- `web/src/main.ts` — router bootstrap (typeof-document guard), re-exports `api`/`getHealth`
- `web/package.json` — added `vue-router`, `lucide-vue-next`

## Decisions Made

- **`customer` role over reusing a staff role.** The threat register (T-02-06) forbids `/auth/line` minting a staff role; a dedicated customer role is the type-safe way to model the session so staff `requireRole(...)` gates always exclude customers.
- **Verify-only try/catch.** Wrapping only `verifyLineIdToken` keeps a real DB fault a 500, not a misleading `invalid_id_token`.
- **Stub all 9 views.** Vite fails the build on unresolvable dynamic imports, so every route component must exist now; the 7 not owned here are trivial placeholders the owning plans replace.

## Deviations from Plan

### Auto-fixed / scope-necessary

**1. [Rule 2 - Security] Added `"customer"` to the `Role` union (api/src/types.ts — not in files_modified)**
- **Why:** `issueSession(customerId, role)` requires a `Role`; the plan forbids minting a staff role (T-02-06). Extending the union is the minimal, type-safe way to model a customer session without privilege escalation.
- **Effect:** `ROLES` (staff set) unchanged, so `requireRole(...)` staff gates still exclude customers. `bunx tsc --noEmit` clean, full suite green.
- **Commit:** 24485ff

**2. [Rule 3 - Blocking] Stubbed all 9 view SFCs, not just PricesView/ContactView**
- **Why:** The plan intended to leave 7 views as bare lazy imports for later plans, but Vite/Rollup fails `bun run build` on unresolved dynamic imports — the build-exit-0 acceptance criterion could not pass otherwise.
- **Fix:** Created trivial placeholder SFCs for Catalog/VarietyDetail/Care/CheckoutWizard/Pay/OrderHistory/OrderDetail with a clear "PLACEHOLDER stub (02-02) — owned by 02-0X" marker; the owning plans overwrite them.
- **Commit:** 1d101dd

**3. [Rule 3 - Path] Test scaffold + lockfile locations**
- `api/tests/auth-line.test.ts` (repo uses `tests/`, plan wrote `test/`); the web lockfile is the repo-root `bun.lock` (single workspace lock), staged with the web commit.

**4. [Note] Plan verify command TS5112**
- The plan's `bunx tsc --noEmit scripts/provision-rich-menu.ts` emits `TS5112` (newer tsc refuses to load `tsconfig.json` when files are named on the CLI) — a CLI ergonomics notice, not a type error. Verified clean with `--ignoreConfig` (+ project-equivalent flags): 0 errors. The `setDefaultRichMenu` grep gate (the real check) returns 1.

**Total deviations:** 4 (1 security, 2 blocking/path, 1 tooling note). No scope creep.

## Pending Operator Verification — Task 4 checkpoint (blocking-human, LINE-01 live)

The code for LINE-01/LINE-02 is complete and verified, but **three LINE-console/vendor artifacts cannot be auto-verified** and require the operator (this is the plan's `autonomous:false` gate). The harness is also locked out of `.env*` files, so the LIFF id must be supplied by the operator.

1. **สร้าง LIFF app** ใน LINE Developers Console ภายใต้ **Login channel เดียวกันกับที่ id = `LINE_LOGIN_CHANNEL_ID`** (aud ต้องตรงกัน — Pitfall 4). ตั้ง endpoint = origin ของเว็บที่ deploy (Cloudflare Pages URL) แล้วคัดลอกค่า LIFF id ไปใส่ **`VITE_LIFF_ID`** (web build env + GitHub Actions var).
2. **ตั้ง Messaging webhook URL** ของ Messaging channel เป็นโดเมน API โปรดักชัน (`https://146.190.100.171.sslip.io/webhook` หรือโดเมนจริง).
3. **เตรียมรูป Rich Menu ขนาด 2500×1686 (PNG)** แล้วรัน `LIFF_ID=<id> bun run api/scripts/provision-rich-menu.ts ./rich-menu.png` — ยืนยันว่าปุ่มทั้ง 5 ปรากฏในแชท LINE.
4. เปิดปุ่ม **“สั่งผักรอบนี้”** จาก Rich Menu แล้วยืนยันว่า LIFF app โหลดได้ และ LINE Login คืน session (หรือ guest path ทำงานได้).

**Resume signal:** พิมพ์ “approved” เมื่อ `VITE_LIFF_ID` ถูกตั้งค่า, webhook URL ถูกตั้ง, และ Rich Menu แสดงผลแล้ว; หรืออธิบายอุปสรรคที่พบ.

## Known Stubs

The 7 view SFCs owned by later plans (Catalog, VarietyDetail, Care, CheckoutWizard, Pay, OrderHistory, OrderDetail) are intentional placeholders so the router/build resolves today. They are replaced by 02-05 (catalog/variety/care), 02-08 (checkout/pay), and 02-09 (history/detail). PricesView and ContactView are real minimal screens owned by this plan.

## Deferred Items

- **UNIQUE(line_user_id) on customers** — `/auth/line` uses find-or-insert; a concurrent first-login for the same LINE user could theoretically insert two rows. The login flow is single-request per user so the window is negligible for the MVP, but a partial-unique index (mirroring the payments `trans_ref` idiom) would let a later migration make the upsert atomic. Schema/migrations were frozen by 02-01, so this is a follow-up migration, not this plan.
- **Sarabun woff2 binaries** — `web/public/fonts/sarabun-400.woff2` + `-600.woff2` must be dropped in by the operator; until then the system-font fallback renders (build stays green; `/fonts/*` are served as-is).

## Self-Check

- FOUND: api/scripts/provision-rich-menu.ts
- FOUND: web/src/router.ts, web/src/api.ts, web/src/liff.ts, web/src/style.css, web/src/App.vue
- FOUND: 9 view SFCs under web/src/views/
- FOUND commit 24485ff (auth/line), 1d101dd (LIFF shell), e836674 (rich-menu)
- VERIFIED: api suite 130 pass / 0 fail; web build exit 0; tsc clean

## Self-Check: PASSED

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
