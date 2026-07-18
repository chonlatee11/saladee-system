# Phase 04 — Deferred / Out-of-scope discoveries

Items found during execution that are NOT caused by the current plan's changes.
Logged, not fixed (executor scope boundary).

| Found in | Item | Notes |
|----------|------|-------|
| 04-06 (Task 3) | `web-admin` `bun run typecheck` (vue-tsc) fails pre-existing on `CouponComposer.vue:86` — Eden `post(body: Record<string, unknown>)` not assignable to the typed request body. Shipped that way in 04-03. | Not a build gate (`vite build` passes). BroadcastComposer.vue was written type-clean (typed body literal) to avoid repeating it. A follow-up could tighten CouponComposer's body typing the same way. |
