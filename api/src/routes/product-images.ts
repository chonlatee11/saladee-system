// Product-images routes — STUB (Phase-4 composition freeze, 04-02). Wave-2 plan
// 04-04 fills this file with the real product-image upload/gallery endpoints
// (requireRole owner|admin; R2 storage plugin). Composed inert in index.ts NOW so
// the composition seam is frozen: 04-04 edits ONLY this file, never index.ts.
// The placeholder returns HTTP 501. DO NOT add feature logic here.
import { Elysia } from "elysia";

export const productImagesRoutes = new Elysia().get("/product-images/_stub", ({ set }) => {
  set.status = 501;
  return { error: "not_implemented", module: "product-images" };
});
