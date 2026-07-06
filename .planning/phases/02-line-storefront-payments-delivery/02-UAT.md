---
status: testing
phase: 02-line-storefront-payments-delivery
source: [02-VERIFICATION.md]
started: 2026-07-04
updated: 2026-07-04
---

## Current Test

number: 1
name: LINE-01 live provisioning — Rich Menu + LIFF app + Messaging webhook
expected: |
  Create the LIFF app under the same Login channel as LINE_LOGIN_CHANNEL_ID and set
  VITE_LIFF_ID (web build env + GitHub Actions var). Set the Messaging webhook URL to the
  production API domain. Prepare a 2500×1686 PNG and run
  `LIFF_ID=<id> bun run api/scripts/provision-rich-menu.ts ./rich-menu.png`.
  In the LINE chat the Rich Menu shows all 5 buttons (สั่งผักรอบนี้ · ราคาวันนี้ ·
  ติดตามออเดอร์ · ติดต่อร้าน · ความรู้เรื่องผัก). Tapping "สั่งผักรอบนี้" opens the LIFF app,
  and LINE Login returns a session (or the guest path works).
awaiting: user response

## Tests

### 1. LINE-01 live provisioning (Rich Menu + LIFF + webhook)
expected: LIFF app created under the Login channel, VITE_LIFF_ID set, Messaging webhook URL pointed at the production API, Rich Menu provisioned via the script and showing all 5 buttons; "สั่งผักรอบนี้" opens LIFF and login returns a session.
result: pending

### 2. PromptPay QR pays with a real banking app + production payee
expected: PROMPTPAY_PAYEE_ID is set to the shop's real PromptPay ID in production .env (test uses dummy 0000000000). A real order's QR, scanned in a real banking app, shows the correct payee and the exact amount (subtotal + delivery fee).
result: pending

### 3. Slip auto-verification with a live SlipOK account (optional for launch)
expected: SLIPOK_API_KEY / SLIPOK_BRANCH_ID set to a real SlipOK branch bound to the receiving account. Uploading a genuine slip auto-confirms the order to paid; an ambiguous/failed verify parks the order as awaiting_review for admin manual-confirm. (Admin manual-confirm already works without a live key.)
result: pending

### 4. Real LINE push — milestone Flex notifications reach the customer
expected: LINE_CHANNEL_ACCESS_TOKEN set in production. On order milestones (awaiting_payment → paid → later transitions), a member with a line_user_id receives the Flex card with the "ดูคำสั่งซื้อ" deep-link; guests are skipped silently.
result: pending

### 5. End-to-end live order inside LINE
expected: A real customer opens the Rich Menu, browses the open round in LIFF, adds packs, completes the 3-step checkout (cart → delivery+address+consent → summary), pays via PromptPay, uploads a slip, sees the order confirmed, and receives automatic status updates — while an unpaid hold releases stock on expiry.
result: pending

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
