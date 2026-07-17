// Carrier-tracking routes — STUB (Phase-4 composition freeze, 04-02). Wave-2 plan
// 04-05 fills this file with the real carrier tracking-number endpoints (requireRole
// owner|admin). Composed inert in index.ts NOW so the composition seam is frozen:
// 04-05 edits ONLY this file, never index.ts. The placeholder returns HTTP 501.
// DO NOT add feature logic here.
import { Elysia } from "elysia";

export const trackingRoutes = new Elysia().get("/tracking/_stub", ({ set }) => {
  set.status = 501;
  return { error: "not_implemented", module: "tracking" };
});
