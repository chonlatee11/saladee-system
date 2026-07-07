// Harvest-confirmation routes STUB (Phase-3 backbone 03-01). The Wave-2 harvest
// slice replaces this whole file, adding lot-confirmation endpoints (1 batch = 1
// lot, D-05) guarded by requireRole("owner","admin","grower"). Kept empty here
// (DI factory + default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeHarvestRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const harvestRoutes = makeHarvestRoutes();
