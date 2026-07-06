---
status: partial
phase: 02-line-storefront-payments-delivery
source: [02-VERIFICATION.md]
started: 2026-07-04
updated: 2026-07-06
---

## Current Test

[testing paused — LIFF UI issue found (test 5); fixing before tests 3–4 resume]

## Tests

### 1. LINE-01 live provisioning (Rich Menu + LIFF + webhook)
expected: LIFF app created under the Login channel, VITE_LIFF_ID set, Messaging webhook URL pointed at the production API, Rich Menu provisioned via the script and showing all 5 buttons; "สั่งผักรอบนี้" opens LIFF and login returns a session.
result: pass
notes: |
  Passed after two operator-config fixes (no code defects):
  (1) PROMPTPAY_PAYEE_ID was missing from /opt/saladee/api/.env → API failed env
      validation and exited (D-10 fail-fast) → Caddy 502 → catalog load failed.
      Fixed by adding PROMPTPAY_PAYEE_ID and recreating the api container.
  (2) Rich Menu was provisioned with a truncated LIFF ID (2010573375) instead of the
      full 2010573375-k3WSb8VS → LINE could not resolve the deep link ("เกิดข้อผิดพลาดระบบ").
      Fixed by re-running provision-rich-menu.ts with the full LIFF ID.
  Also noted: deploy-web.yml build step does not inject VITE_LIFF_ID (only VITE_API_URL)
  — VITE_LIFF_ID must be added to the workflow env for future rebuilds to keep login.

### 2. PromptPay QR pays with a real banking app + production payee
expected: PROMPTPAY_PAYEE_ID is set to the shop's real PromptPay ID in production .env (test uses dummy 0000000000). A real order's QR, scanned in a real banking app, shows the correct payee and the exact amount (subtotal + delivery fee).
result: pass
notes: |
  Verified via Bruno payments/create-order-with-qr against the live API (production
  PROMPTPAY_PAYEE_ID). Scanned the returned QR with a real banking app — amount matched
  and payee resolved correctly. Required first seeding a catalog: created owner user
  (SQL), then variety+round+stock+price via the new bruno/Saladee/admin requests.

### 3. Slip auto-verification with a live SlipOK account (optional for launch)
expected: SLIPOK_API_KEY / SLIPOK_BRANCH_ID set to a real SlipOK branch bound to the receiving account. Uploading a genuine slip auto-confirms the order to paid; an ambiguous/failed verify parks the order as awaiting_review for admin manual-confirm. (Admin manual-confirm already works without a live key.)
result: pending
note: deferred — user paused UAT to fix the test-5 LIFF UI blockers first

### 4. Real LINE push — milestone Flex notifications reach the customer
expected: LINE_CHANNEL_ACCESS_TOKEN set in production. On order milestones (awaiting_payment → paid → later transitions), a member with a line_user_id receives the Flex card with the "ดูคำสั่งซื้อ" deep-link; guests are skipped silently.
result: pending

### 5. End-to-end live order inside LINE
expected: A real customer opens the Rich Menu, browses the open round in LIFF, adds packs, completes the 3-step checkout (cart → delivery+address+consent → summary), pays via PromptPay, uploads a slip, sees the order confirmed, and receives automatic status updates — while an unpaid hold releases stock on expiry.
result: issue
reported: "กดอะไรไม่ได้เลยในหน้า liff หลังกดสั่งผักรอบนี้; กดเพิ่มไม่เกิดอะไร; layout เพี้ยน (หัวข้อตัดทีละตัวอักษร) — เพี้ยนทั้งใน LINE และ Chrome desktop"
severity: blocker

## Summary

total: 5
passed: 2
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "The catalog shell renders at the correct width so the LIFF is usable (mobile-first, responsive)"
  status: failed
  reason: "User reported: the whole LIFF page is broken — headings wrap one character per line, nothing usable. Reproduces in LINE and Chrome desktop."
  severity: blocker
  test: 5
  root_cause: "Tailwind v4 token-name collision. web/src/style.css @theme defines --spacing-xs/sm/md/lg/xl/2xl/3xl. The name `md` also feeds the size scale, so `max-w-md` resolves to var(--spacing-md)=16px instead of the container 28rem. Confirmed live: <main> computes max-width:16px, so the app is 16px wide. Spacing utilities (p-md/gap-md=16px) are correct; only NAMED size utilities collide."
  artifacts:
    - path: "web/src/App.vue"
      issue: "line 15: <main class=\"... max-w-md\"> → 16px wide shell"
    - path: "web/src/views/PayView.vue"
      issue: "line 260: modal <div class=\"... max-w-md\"> → same 16px collision"
    - path: "web/src/style.css"
      issue: "@theme --spacing-* named tokens (md/lg/...) collide with the size scale used by max-w-*"
  missing:
    - "Replace the two max-w-md usages with a non-colliding width (e.g. max-w-[28rem] or a dedicated --container-app token), so the shell is ~448px and mobile-first responsive"

- truth: "From the catalog a customer can proceed to checkout after adding packs to the cart"
  status: failed
  reason: "User reported: pressing เพิ่ม does nothing visible. CatalogView adds to the cart store silently but has no cart summary/checkout CTA, and no visible route to /checkout exists from the browse flow."
  severity: major
  test: 5
  root_cause: "CatalogView.vue (and the App shell) render no cart-summary bar / 'ไปชำระเงิน' button; the only navigation to /checkout is OrderHistoryView reorder. cart.add() updates the store with no on-screen feedback."
  artifacts:
    - path: "web/src/views/CatalogView.vue"
      issue: "no sticky cart/checkout CTA; onAdd only calls cart.add with no feedback"
    - path: "web/src/stores/cart.ts"
      issue: "no item-count getter exposed for a cart badge"
  missing:
    - "Add a sticky cart bar / 'ไปชำระเงิน (N)' button shown when the cart has items, routing to /checkout; add feedback on add (badge/count)"

- truth: "Self-hosted Sarabun font loads without console errors"
  status: failed
  reason: "Console: 'Failed to decode downloaded font .../fonts/sarabun-400.woff2 · OTS parsing error: invalid sfntVersion' (the bytes are <!DO — the SPA fallback HTML, i.e. the font files are missing)."
  severity: minor
  test: 5
  root_cause: "web/public/fonts/ does not exist in the repo, so sarabun-400/600.woff2 are never built into dist; Cloudflare Pages returns index.html for the missing URLs. The system-font fallback still renders, so this is cosmetic + console noise, not the layout cause."
  artifacts:
    - path: "web/src/style.css"
      issue: "@font-face references /fonts/sarabun-*.woff2 that are not present"
  missing:
    - "Either add the two real Sarabun woff2 files to web/public/fonts/, or drop the @font-face and rely on the system-ui/Noto Sans Thai fallback"
