---
phase: 03-back-office-crop-planning-b2b-subscription
source: 03-VERIFICATION.md
status: pending
generated: 2026-07-11
total_items: 10
passed: 0
---

# Phase 3 — UAT Checklist (live human verification)

Automated verification passed 5/5 success criteria (api 298 pass / 0 fail, web 30/0 + build, web-admin build ✓). The items below are the **blocking live-browser / LINE / real-PDF checks** every Wave-2/3 plan deferred — they cannot be automated. Complete them, then re-run the verify step until status is `passed`.

**Setup:** start API on :3000, web-admin on :5174, web (LIFF) on :5173. Seed staff accounts (owner / grower / packer), at least one B2B customer, one active subscription, and a round with due planting batches.

| # | Plan | Test | Expected |
|---|------|------|----------|
| 1 | 03-03 | web-admin RBAC nav + direct-URL 403 | grower/packer see only their menus; out-of-role direct URL is server-403'd (not just hidden nav) |
| 2 | 03-04 | crop planning end-to-end | grower sets variety params → logs a batch (shows projected harvest date + expected yield) → 1-click mix spawns the week's batches; repeat click = already-created |
| 3 | 03-05 | publish gate + override permanence + harvest log | publish writes sellable qty; a hand-set override row survives re-publish; harvest logs lot/best-before + delta; B2C sees quota − (standing+subscription reserved) from first view |
| 4 | 03-06 | B2B approval + standing reserve-before-B2C + overflow | approving B2B reveals wholesale price; standing order pre-decrements reserved before B2C; over-forecast raises admin overflow flag (no auto-trim) |
| 5 | 03-07 | subscription generator + idempotency + substitution | round-open auto-creates 1 box order per active subscription (reserved before B2C); re-trigger = no duplicate; sold-out variety fires LINE substitution notice; admin pause/skip/cancel works |
| 6 | 03-08 | LIFF subscription/B2B customer flows | customer signs up/manages subscription; requests B2B (pending → wholesale after approval); sees standing order + substitution detail — all on mobile/LINE |
| 7 | 03-09 | packing queue by route + Thai PDF | packer sees paid orders grouped by round → delivery zone/method; pack/label PDF opens with legible Sarabun Thai (no tofu), print-safe |
| 8 | 03-10 | dashboard cards | shows today's/this-round sales, unpaid orders, near-sold-out, next-round yield + B2B/subscription card with overflow flag; live numbers correct |
| 9 | 03-11 | reports charts + CSV | period/channel/product/round filters update charts with stable channel↔color mapping; best-sellers/AOV/repeat correct; Thai CSV opens without mojibake |
| 10 | 03-12 | settings secret-safety + canned chatbot | editing haircut %/hold window takes effect with no redeploy and no payee/slip-key ever in form/response; LINE keywords เมนูรอบนี้/ราคาวันนี้/ของเหลือ → Flex + LIFF deep-link; other text → fallback |

## Follow-up decision (warning, not phase-blocking)

- **`api/src/routes/catalog.ts` (lines 110-111, 269)** returns the b2b (wholesale) tier price to **all** callers ungated — a potential wholesale-price / PDPA exposure. Pre-existing (not caused by Phase 3), flagged by 03-08 in `deferred-items.md`. CUST-02 is met via the gated `/me/b2b/prices` path, so the phase goal is not blocked. **Decision needed:** gate/omit the b2b tier in the public catalog, or confirm it is intentionally public.

## How to verify

Run `/gsd-verify-work 03` and walk each item conversationally, or test manually and mark this file. Phase 03 is **not marked complete** until UAT passes.
