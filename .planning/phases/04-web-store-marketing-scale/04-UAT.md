---
status: testing
phase: 04-web-store-marketing-scale
source: [04-VERIFICATION.md]
started: 2026-07-18T01:54:23Z
updated: 2026-07-18T01:54:23Z
---

## Current Test

number: 1
name: Web-store guest checkout PromptPay QR end-to-end scan with a real bank app
expected: |
  The rendered NET (post-discount) whole-baht QR scans in a real banking app and shows
  the exact discounted amount; slip upload completes the order.
awaiting: user response

## Tests

### 1. Web-store guest checkout PromptPay QR end-to-end scan with a real bank app
expected: The rendered NET (post-discount) whole-baht QR scans in a real banking app and shows the exact discounted amount; slip upload completes the order.
result: [pending]

### 2. Load the public web store on desktop AND mobile viewport
expected: Current round's catalog is server-rendered, product page opens with real gallery imagery, layout is correct mobile-first (NFR-07) and at store-max 1200px desktop.
result: [pending]

### 3. Admin sends a segmented LINE broadcast to a real consented test audience
expected: Only marketing-consented customers with a line_user_id receive the multicast; a customer who opted out does not.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
