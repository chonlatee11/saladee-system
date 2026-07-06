---
phase: 02-line-storefront-payments-delivery
plan: 08
subsystem: line-storefront-checkout-pay
tags: [liff, vue, checkout-wizard, promptpay, slip-upload, pdpa-consent, delivery, payment-states, tailwind-v4, ssr-test]
status: complete

requires:
  - phase: 02-05
    provides: cart store (server-shaped lines+boxLines, sessionStorage), reusable SFCs (QtyStepper/EmptyState), catalog Eden client
  - phase: 02-03
    provides: GET /delivery/quote — allowedMethods (freshness) + per zone×method fee + read-only deliveryDate
  - phase: 02-04
    provides: POST /orders (delivery snapshot + awaiting_payment + PromptPay QR + hold), GET /orders/:id/qr (idempotent)
  - phase: 02-06
    provides: POST /orders/:id/slip — clean→paid / unavailable→awaiting_review / rejected(reason) + system-wide dedup
provides:
  - "CheckoutWizard (/checkout): 3-step mobile wizard — cart review → delivery+address+PDPA consent → server summary; posts /orders and routes to /pay/:id"
  - "PayView (/pay/:id): idempotent PromptPay QR + live hold countdown + slip uploader, rendering EVERY payment state (not-uploaded · uploading/verifying · paid · rejected-per-reason · awaiting-review · hold-expired/cancelled)"
  - "DeliveryMethodTiles: freshness-disabled tiles + server fee line + free-shipping state"
  - "ConsentCheckboxes: PDPA usage (required, gates CTA) + marketing (default off)"
  - "WizardStepIndicator: accent active/completed step indicator"
  - "SlipUploader: POSTs /orders/:id/slip, normalizes api response → paid/review/rejected"
  - "web/src/lib/checkout.ts: pure buildOrderBody + consentSatisfied helpers (no client money)"
affects: [02-09]

tech-stack:
  added: []
  patterns:
    - "Async-setup views await their data (catalog + quote / QR) in setup so loading is owned by the App.vue <Suspense> fallback (02-02/02-05 shell pattern); each screen owns its own post-load states"
    - "Injectable loaders/uploader/canceler props (default = Eden api call) so the wizard + pay screen are component-testable DOM-free — no module mocking (mirrors 02-05)"
    - "Money is DISPLAY-only: unit prices from the catalog + delivery fee from /delivery/quote are summed for the summary; the order body carries ids+qty+choice+consent only, and POST /orders re-resolves every amount (T-02-30)"
    - "Pure checkout helpers (buildOrderBody/consentSatisfied) extracted to lib/checkout.ts for DOM-free unit tests of the order body + consent gate"

key-files:
  created:
    - web/src/lib/checkout.ts
    - web/src/components/DeliveryMethodTiles.vue
    - web/src/components/ConsentCheckboxes.vue
    - web/src/components/WizardStepIndicator.vue
    - web/src/components/SlipUploader.vue
    - web/tests/checkout-wizard.test.ts
  modified:
    - web/src/views/CheckoutWizard.vue
    - web/src/views/PayView.vue

key-decisions:
  - "Guest LINE checkout maps one collected name/phone/address to both buyer and recipient in the POST /orders body (GuestCustomer requires both); simplest path for the MVP single-recipient flow"
  - "The delivery zone is a client selector (samut_prakan / upcountry, mirroring api/src/config/delivery.ts); the quote re-fetches on zone change and drops a now-disallowed selected method"
  - "The slip-upload outcome comes straight from the POST /orders/:id/slip response (200 paid · 202 awaiting_review · 409/422 rejected) — no client polling; the transient uploading/verifying state is the in-flight POST"
  - "Cancel-order is wired to the shared PATCH /orders/:id/status endpoint (admin-gated today); orders also auto-cancel on hold expiry — see Deferred (no dedicated customer-cancel endpoint yet)"
  - "Pure helpers live in web/src/lib/checkout.ts so the wizard's order-body + consent-gate logic is unit-testable without a DOM"

requirements-completed: [LINE-02, DEL-04, PLAT-04]

metrics:
  duration: ~25m
  completed: 2026-07-04
  tasks: 2
  files_created: 6
  files_modified: 2
  tests: "web suite 15 pass / 0 fail (3 new checkout-wizard cases + 12 existing)"
---

# Phase 2 Plan 08: LINE Checkout Wizard + PromptPay Pay Screen Summary

**Closes the customer's end-to-end LINE path — browse → 3-step checkout wizard (เลือกผักรอบนี้ → วิธีรับสินค้า & ที่อยู่ → สรุป & ชำระเงิน) → PromptPay pay screen → slip upload → confirmed — all inside the LIFF mini-app.** The wizard consumes the cart store (02-05), calls GET /delivery/quote (02-03) for freshness-gated methods + server fees, captures PDPA consent + recipient, posts /orders (02-04), and hands off to the pay screen which renders the idempotent PromptPay QR + hold countdown and the slip uploader with EVERY payment state (02-06). Covers the checkout/pay half of LINE-02, the checkout side of DEL-04, and the consent UI for PLAT-04.

## Performance
- **Duration:** ~25 min
- **Completed:** 2026-07-04
- **Tasks:** 2 (both `type=auto`)
- **Files:** 6 created, 2 modified

## Accomplishments

**Task 1 — 3-step checkout wizard** — commit `7a63150`
- **CheckoutWizard.vue (`/checkout`):** a 3-step mobile wizard with `WizardStepIndicator` (accent active/completed steps, D-16). Step 1 reviews the cart lines resolved against the catalog (name + server unit price + `QtyStepper` edit) and shows the display subtotal, with the "ยังไม่ได้เลือกผัก" empty state. Step 2 offers the zone selector + `DeliveryMethodTiles` (from the quote), the recipient fields (name/phone/address, per-field inline errors), and `ConsentCheckboxes`; the "ถัดไป" CTA is **disabled until the required usage consent is ticked** (D-25). Step 3 shows the server-sourced summary (subtotal + fee + total) and the primary "ยืนยันและชำระเงิน" CTA that POSTs /orders (with the delivery choice + consent) and routes to `/pay/:id`.
- **DeliveryMethodTiles.vue:** the four methods (self/cold/general/on_demand) as tiles; a method not in the server `allowedMethods` (freshness, D-13) or not offered in the zone renders **disabled**, with the "ผักในตะกร้าต้องส่งแบบ …" strictest-set copy. The per-method flat fee is the server value; a ฿0 fee shows the free-shipping-applied state (D-15). The chosen tile gets the accent ring + check.
- **ConsentCheckboxes.vue:** the PDPA usage consent (required) + a separate default-unchecked marketing consent (D-25/26), each a full 44px touch target with the accent tick-fill and the policy link.
- **lib/checkout.ts:** pure `buildOrderBody` (ids + qty + delivery choice + consent only — never money, T-02-30) and `consentSatisfied` (the CTA gate predicate), plus the method labels / zones / policy version constants.
- **checkout-wizard.test.ts:** 3 DOM-free cases (vue/server-renderer, the 02-05 pattern) — a freshness-blocked tile renders disabled, the step-2 CTA is disabled with usage unticked (+ the `consentSatisfied` gate), and `buildOrderBody` produces the exact POST /orders body with no money field.

**Task 2 — PromptPay pay screen + slip uploader** — commit `1f9c93a`
- **PayView.vue (`/pay/:id`):** fetches GET /orders/:id/qr (idempotent — never re-arms the timer, D-11), renders the QR image, the pay instruction "สแกน QR นี้ด้วยแอปธนาคารเพื่อโอน ฿{amount} แล้วอัปโหลดสลิป", and a live `mm:ss` hold countdown that flips to the expired state at 0. Implements **every** UI-SPEC payment state: not-yet-uploaded (QR + uploader) · uploading/verifying (in-flight POST) · verified/paid (accent ✓ success screen) · rejected-per-reason (exact wrong-amount / wrong-payee / duplicate copy, D-02/03/06) · awaiting-review (amber D-04 "เราได้รับสลิปแล้ว กำลังตรวจสอบ…") · hold-expired/cancelled (D-09). Includes a destructive cancel-order confirm bottom-sheet and a replace-slip re-upload CTA.
- **SlipUploader.vue:** a file picker that POSTs /orders/:id/slip (multipart) and **normalizes** the api response (200 paid · 202 awaiting_review · 409 duplicate · 422 wrong_amount/wrong_payee) into a `SlipResult` the pay screen renders — HTTP codes never leak into the view. Injectable `uploader` for testability.

## Verification
- `cd web && bun run build` → exits 0 (CheckoutWizard + PayView chunks emitted).
- `cd web && bun test` → **15 pass / 0 fail** (3 new checkout-wizard cases + 12 existing; no regressions).
- `bunx vue-tsc --noEmit` → no errors in any 02-08 file (pre-existing unrelated errors noted in Deferred Issues).
- Acceptance greps: `ยืนยันและชำระเงิน`=2 and `ส่งฟรีเมื่อซื้อครบ`=1 in CheckoutWizard.vue; `disabled`≥1 in DeliveryMethodTiles.vue; `สแกน QR`=2, `กำลังตรวจสอบ`=1, and the rejected-reason copy=2 in PayView.vue; `/orders/`=2 in SlipUploader.vue.

## Threat mitigations applied
- **T-02-30 (client showing a fee/total it computed to under-pay):** every amount is a server value (catalog unit price + /delivery/quote fee); the order body carries ids+qty+choice+consent only; POST /orders re-resolves price/fee and drives the QR amount. Asserted by the `buildOrderBody` "no `Satang` field" test.
- **T-02-31 (bypassing the usage-consent gate):** the step-2 CTA is disabled until usage is ticked (`consentSatisfied`), and the server also rejects usage=false (422, 02-04).
- **T-02-32 (re-fetching QR to reset the hold timer):** the pay screen only READS GET /orders/:id/qr (idempotent server-side, D-11) — no client re-arm.

## Deviations from Plan
None affecting scope — the plan executed as written. Notes:
- **Recipient mapping:** the single collected name/phone/address maps to both buyer and recipient in the guest order body (the api GuestCustomer requires both). No schema change.
- **Zone selector added to step 2:** the quote needs a zone; the two config zones are surfaced as a selector and the quote re-fetches on change. Consistent with the server config (02-03).

## Known Stubs
None. Both views render live data through the Eden client (or the injected loaders in tests); the QR, countdown, slip upload, and every payment state are wired to the real 02-03/02-04/02-06 endpoints.

## Deferred Issues
- **Pre-existing typecheck errors (out of scope, not introduced here):** `bunx vue-tsc --noEmit` reports errors in `api/src/services/slip-verify/slipok.adapter.ts` (Uint8Array→BodyInit, 02-06) and `web/src/liff.ts` (string|undefined, 02-02). Neither file was touched by this plan and the vite build (esbuild transpile) is unaffected. Logged for a future cleanup; not a 02-08 regression.

## Deferred Items
- **No dedicated customer-cancel endpoint.** The pay screen's cancel action is wired to the shared PATCH /orders/:id/status (admin-gated today); a customer call would be refused, but orders auto-cancel on hold expiry (02-07) which is the authoritative path. A customer-owned cancel endpoint (on `me-orders`) is a follow-up.
- **Sarabun woff2 binaries** (carried from 02-02/02-05) — `web/public/fonts/sarabun-{400,600}.woff2` still absent; the system-font fallback renders and the build stays green. Operator asset.
- **Box (mixed-box) checkout UI** — `cart.ts`/`buildOrderBody` support `boxLines`, and the wizard resolves box display names, but the catalog browse (02-05) still renders single-variety packs only, so boxes rarely reach the cart. Full box browse is a later enhancement.

## Requirements covered
LINE-02 (checkout/pay half — the 3-step wizard + PromptPay pay + slip inside LINE), DEL-04 (delivery method/zone/fee chosen at checkout, freshness-gated), PLAT-04 (PDPA usage+marketing consent captured before name/address/phone).

## Self-Check: PASSED
- FOUND: web/src/lib/checkout.ts
- FOUND: web/src/components/{DeliveryMethodTiles,ConsentCheckboxes,WizardStepIndicator,SlipUploader}.vue
- FOUND: web/src/views/{CheckoutWizard,PayView}.vue
- FOUND: web/tests/checkout-wizard.test.ts
- FOUND commits: 7a63150 (task 1), 1f9c93a (task 2)
- VERIFIED: web build exit 0; web test 15 pass / 0 fail

---
*Phase: 02-line-storefront-payments-delivery*
*Completed: 2026-07-04*
