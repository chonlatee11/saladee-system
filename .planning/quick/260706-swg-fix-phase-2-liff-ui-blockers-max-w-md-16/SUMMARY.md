---
type: quick
slug: fix-phase-2-liff-ui-blockers-max-w-md-16
quick_id: 260706-swg
date: 2026-07-06
status: complete
---

# Summary — Fix Phase-2 LIFF UI blockers

Fixed three LIFF issues found in Phase 2 UAT test 5. All in `web/`.

## Changes

- **web/src/App.vue** — shell `<main>` `max-w-md` → `max-w-[28rem]`. `max-w-md` was
  resolving to `--spacing-md` (16px) because the custom `@theme` spacing tokens reuse
  the `md`/`sm`/`lg` names that also feed Tailwind v4's size scale. This made the whole
  app 16px wide (text wrapped one char per line).
- **web/src/views/PayView.vue** — same `max-w-md` → `max-w-[28rem]` on the cancel-confirm
  modal (the other colliding size utility).
- **web/src/views/CatalogView.vue** — added a sticky "ไปชำระเงิน (N)" CTA (RouterLink →
  `/checkout`) shown when `cart.lineCount > 0`. Previously the browse flow had no route
  to checkout and add-to-cart had no on-screen feedback. Count only; money stays
  server-resolved.
- **web/src/style.css** — removed both Sarabun `@font-face` blocks (the woff2 files were
  never provisioned → 404 → OTS decode errors). Text now uses the `--font-sans` system
  stack (system-ui / Noto Sans Thai).

`web/src/stores/cart.ts` already exposed `lineCount` — no store change needed.

## Verification

- `bun run --cwd web build` ✓ ; `vue-tsc --noEmit` exit 0.
- Local preview + browser: `<main>` = 448px (was 16px); heading on one line; CTA renders
  "ไปชำระเงิน (2)" → `/checkout`, bg #2e7d32, 48px; built CSS has `max-width:28rem` and
  0 `@font-face`.

## Follow-up

- Deploy reaches production when this lands on `develop` (deploy-web.yml on web/** push).
- Resume Phase 2 UAT: re-run the in-LINE E2E (test 5), then tests 3–4.
- Related deferred bug: [[migrate-down-journal-bug]] (db:down leaves drizzle journal).
