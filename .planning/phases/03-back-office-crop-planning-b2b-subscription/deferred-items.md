
## 03-08 deferred (out of scope for this task)

- ~~**catalog GET / exposes b2b tier price unconditionally** — `api/src/routes/catalog.ts`
  `/catalog` returns `prices: { b2c, b2b }` for every variety regardless of the caller's
  B2B approval. This is a potential pre-existing wholesale-price exposure (cf. T-03-21,
  which 03-06 gated via `wholesaleVisible`). Not caused by 03-08; the 03-08 B2B view uses
  the gated `/me/b2b/prices` endpoint instead. Needs a follow-up review: either gate/omit
  the `b2b` tier in the public catalog or confirm it is intentionally public.~~
  - **Resolved: 2026-07-11 by plan 03-13 (gap closure).** Per the user decision recorded
    in 03-UAT.md ("Follow-up decision", gap #4), the public catalog now nulls the b2b
    tier — `prices.b2b` and box `priceSatang.b2b` — for any caller without an
    approved-B2B customer session, via the same `wholesaleVisible()` rule (D-08 /
    T-03-21) on both `GET /catalog` and `GET /catalog/rounds/:id`. Keys stay present
    (null) so the response shape is unchanged; `/me/b2b/prices` untouched.
- **`vue-tsc` is not a local devDep in `web/`** — the plan's `bunx vue-tsc --noEmit` pulls an
  incompatible `vue-tsc@latest`. `web/` verification currently relies on `bun run build`
  (vite) + `bun test` SSR view tests. Consider pinning `vue-tsc` + `typescript` as web
  devDeps for a real type-check gate.
