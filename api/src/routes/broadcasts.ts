// Broadcasts routes — STUB (Phase-4 composition freeze, 04-02). Wave-2 plan 04-06
// fills this file with the real LINE broadcast-composer endpoints (requireRole
// owner|admin; PDPA marketing-consent audience gate). Composed inert in index.ts NOW
// so the composition seam is frozen: 04-06 edits ONLY this file, never index.ts.
// The placeholder returns HTTP 501. DO NOT add feature logic here.
import { Elysia } from "elysia";

export const broadcastsRoutes = new Elysia().get("/broadcasts/_stub", ({ set }) => {
  set.status = 501;
  return { error: "not_implemented", module: "broadcasts" };
});
