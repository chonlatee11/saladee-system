---
status: complete
phase: 04-web-store-marketing-scale
source: [04-VERIFICATION.md]
started: 2026-07-18T01:54:23Z
updated: 2026-07-18T07:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Web-store guest checkout PromptPay QR end-to-end scan with a real bank app
expected: The rendered NET (post-discount) whole-baht QR scans in a real banking app and shows the exact discounted amount; slip upload completes the order.
result: pass

### 2. Load the public web store on desktop AND mobile viewport
expected: Current round's catalog is server-rendered, product page opens with real gallery imagery, layout is correct mobile-first (NFR-07) and at store-max 1200px desktop.
result: issue
reported: "ไม่เห็นรูปภาพแสดงเลย"
severity: major

### 3. Admin sends a segmented LINE broadcast to a real consented test audience
expected: Only marketing-consented customers with a line_user_id receive the multicast; a customer who opted out does not.
result: pass
note: "Sent successfully (ส่งได้). resolveAudience resolves 2 eligible (marketing-consented + line_user_id); opt-out correctly excluded. Enhancement requested: render as LINE Flex Message instead of plain text (tracked separately, not a UAT failure)."

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Web-store catalog cards show the product photo when images were uploaded via web-admin"
  status: failed
  reason: "User reported: ไม่เห็นรูปภาพแสดงเลย"
  severity: major
  test: 2
  root_cause: "StoreVarietyCard.vue renders `<img v-if=\"variety.imageUrl\">` only (line 56-61), but web-admin product-image upload (api/src/routes/product-images.ts) writes ONLY variety_images rows and never sets varieties.imageUrl. Catalog (catalog.ts:239) returns imageUrl=null + gallery=[variety_images...]. So a normally-uploaded product has imageUrl=null → catalog card shows NO image and NO placeholder. Product page pages/p/[id].vue:39 correctly falls back to gallery[0]; the card does not. Secondary/env: R2_PUBLIC_BASE_URL empty in local .env → stored gallery urls are bare R2 key paths (`/product-images/...`) that resolve to the store origin and 404, so even the product-page cover cannot load locally; production sets R2_PUBLIC_BASE_URL."
  artifacts:
    - path: "web-store/components/StoreVarietyCard.vue"
      issue: "img gated on variety.imageUrl only; no gallery[0] cover fallback like pages/p/[id].vue"
    - path: "api/src/routes/product-images.ts"
      issue: "upload inserts variety_images but never sets varieties.imageUrl cover"
  missing:
    - "StoreVarietyCard cover fallback: use variety.imageUrl ?? gallery[0] (mirror pages/p/[id].vue cover logic)"
    - "Set R2_PUBLIC_BASE_URL in the local/dev .env (and verify the R2 objects exist) so gallery URLs are absolute + loadable for UAT"
