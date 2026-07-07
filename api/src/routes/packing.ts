// Packing routes STUB (Phase-3 backbone 03-01). The Wave-2/3 packing slice
// replaces this whole file, adding the pack-queue listing (grouped by round +
// delivery zone), per-order packed_at state (D-20), and the pack/label PDF
// download — all guarded by requireRole("owner","admin","packer"). Kept empty
// here (DI factory + default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makePackingRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const packingRoutes = makePackingRoutes();
