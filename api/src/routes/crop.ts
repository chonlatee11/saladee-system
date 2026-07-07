// Crop-planning routes STUB (Phase-3 backbone 03-01). The Wave-2 CROP slice
// replaces this whole file, adding batch/mix-template endpoints that close over
// the injected db and are guarded by requireRole("owner","admin","grower").
// Kept empty here (DI factory + default instance) so index.ts composes it now
// without waiting on the slice — the Phase-0 fixed-order compose invariant.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeCropRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const cropRoutes = makeCropRoutes();
