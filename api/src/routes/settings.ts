// Settings routes STUB (Phase-3 backbone 03-01). The Wave-3 settings slice
// replaces this whole file, adding the hot key/value config upsert over the
// settings table (D-22) — guarded by requireRole("owner","admin"). Secrets stay
// in env.ts and MUST NOT be surfaced by this API (Pitfall 6). Kept empty here
// (DI factory + default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeSettingsRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const settingsRoutes = makeSettingsRoutes();
