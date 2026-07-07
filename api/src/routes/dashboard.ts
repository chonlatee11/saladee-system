// Dashboard routes STUB (Phase-3 backbone 03-01). The Wave-3 dashboard slice
// replaces this whole file, adding the at-a-glance aggregate GET (open rounds,
// reservations, pending B2B, overflow flags) — guarded by
// requireRole("owner","admin"). Kept empty here (DI factory + default instance)
// so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeDashboardRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const dashboardRoutes = makeDashboardRoutes();
