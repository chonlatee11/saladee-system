// Coupons routes — STUB (Phase-4 composition freeze, 04-02). Wave-2 plan 04-03
// fills this file with the real coupon-composer endpoints (requireRole owner|admin).
// Composed inert in index.ts NOW so the composition seam is frozen: 04-03 edits ONLY
// this file, never index.ts. The placeholder returns HTTP 501 (not implemented).
// DO NOT add feature logic here.
import { Elysia } from "elysia";

export const couponsRoutes = new Elysia().get("/coupons/_stub", ({ set }) => {
  set.status = 501;
  return { error: "not_implemented", module: "coupons" };
});
