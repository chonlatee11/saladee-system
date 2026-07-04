# Phase 01 — Deferred Items (out-of-scope discoveries during execution)

| Discovered in | Item | Reason deferred | Status |
|---------------|------|-----------------|--------|
| 01-01 | `api/tests/storage.test.ts` beforeEach/afterEach hook times out (5s) in the sandbox | Pre-existing R2/network test; requires Cloudflare R2 connectivity not available in the execution sandbox. NOT caused by 01-01 (touches no storage code). Passes in an environment with R2 reachable. | open |
| 01-02 | CORS `methods` allowlist in `api/src/index.ts` does not include `PATCH` | `PATCH /orders/:id/status` is staff-only and there is no staff browser frontend in Phase 1 (dashboard is a later phase). The frozen index.ts cors config (composed by 00-01/00-08) was only appended to per plan instructions; adding `PATCH`/`PUT`/`DELETE` to the browser preflight allowlist belongs with the staff-dashboard slice. Server-side/same-origin callers (and `app.handle`) are unaffected. | open |
