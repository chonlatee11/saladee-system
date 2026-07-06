---
type: quick
slug: add-loading-spinner-full-screen-busy-ove
quick_id: 260706-ut1
date: 2026-07-06
status: complete
---

# Summary — Loading spinner + busy overlay across the LIFF

UX request from UAT: show a nice loading spinner during API waits, and block the user
from tapping other buttons while an action is in flight.

## Changes (all web/)

- **components/Spinner.vue** (new) — accessible CSS-only ring spinner in the accent
  color; degrades to an opacity pulse under `prefers-reduced-motion`; `size` prop
  (sm/md/lg). No dependency (NFR-08).
- **components/BusyOverlay.vue** (new) — full-screen fixed overlay (`z-50`,
  `bg-canvas/70` + `backdrop-blur`) that shows the spinner + a label and CAPTURES all
  pointer/touch input, so no other control is tappable until the action resolves
  (prevents double-submit / mid-request navigation). `show` + `label` props; fades in/out.
- **App.vue** — Suspense fallback now shows the spinner + "กำลังโหลด…" (was plain text);
  this is the shared loading state for every async route/view.
- **PayView.vue** — overlay while `uploading` (multi-second slip verify) or `cancelling`
  ("กำลังตรวจสอบสลิป…" / "กำลังยกเลิกคำสั่งซื้อ…"). Pairs with the self-heal poll.
- **CheckoutWizard.vue** — overlay while `placing` the order + building the QR.
- **OrderHistoryView.vue** — overlay while a reorder resolves + routes to checkout.

## Verification

- `bun run --cwd web build` ✓ ; `vue-tsc --noEmit` exit 0.
- Built CSS confirmed to generate the utilities used: `bg-canvas/70` → `#ffffffb3`,
  `backdrop-blur`, `border-t-accent`, `border-hairline`; the spin keyframes are bundled
  in the Spinner chunk. Visual confirmation happens on the deployed LIFF.

## Follow-up

- Merges to develop → deploy-web. Eyeball on the live LIFF; adjust spin speed/label copy
  if desired.
