// B2B routes STUB (Phase-3 backbone 03-01). The Wave-3 B2B slice replaces this
// whole file, adding wholesale approval + standing-order endpoints; standing-order
// reservation flows the existing reserve() (overflow inserts a quota_overflow_flags
// row inside the tx — never auto-decides, D-10). Kept empty here (DI factory +
// default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeB2bRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const b2bRoutes = makeB2bRoutes();
