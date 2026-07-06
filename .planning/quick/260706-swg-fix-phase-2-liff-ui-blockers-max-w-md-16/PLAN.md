---
type: quick
slug: fix-phase-2-liff-ui-blockers-max-w-md-16
quick_id: 260706-swg
date: 2026-07-06
---

# Fix Phase-2 LIFF UI blockers

Discovered during Phase 2 live UAT (test 5, in-LINE E2E). Root causes recorded in
`.planning/phases/02-line-storefront-payments-delivery/02-UAT.md` ## Gaps.

## Tasks

1. **Layout (blocker):** Tailwind v4 token-name collision — `--spacing-md:16px` makes
   `max-w-md` resolve to 16px, so `<main>` (and the PayView modal) render 16px wide.
   Replace the two `max-w-md` usages with `max-w-[28rem]`.
   - `web/src/App.vue` shell `<main>`
   - `web/src/views/PayView.vue` cancel-confirm modal

2. **Checkout path (major):** catalog adds to cart with no feedback and no route to
   `/checkout`. Add a sticky "ไปชำระเงิน (N)" CTA in `CatalogView.vue`, shown when the
   cart has items, using the existing `cart.lineCount` getter. Routes to `/checkout`.

3. **Fonts (minor):** `web/public/fonts/` never existed → `/fonts/sarabun-*.woff2` 404
   → OTS console errors. Remove both `@font-face` blocks from `web/src/style.css`; keep
   the `--font-sans` system stack (system-ui / Noto Sans Thai).

## Verification

- `bun run --cwd web build` compiles; `vue-tsc --noEmit` clean.
- Local `vite preview` + browser: `<main>` computes 448px (was 16px); the CTA renders
  "ไปชำระเงิน (2)" → `/checkout`, accent bg, 48px tall; no `@font-face` in built CSS.
