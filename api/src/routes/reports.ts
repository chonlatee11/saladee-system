// Reports routes STUB (Phase-3 backbone 03-01). The Wave-3 reports slice replaces
// this whole file, adding server-side aggregate GETs (sales/yield/waste by
// period/channel/product/round, money kept integer satang until display), CSV
// export — guarded by requireRole("owner","admin"). Kept empty here (DI factory +
// default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeReportsRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const reportsRoutes = makeReportsRoutes();
