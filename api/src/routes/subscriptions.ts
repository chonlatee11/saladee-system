// Subscription routes STUB (Phase-3 backbone 03-01). The Wave-3 subscription
// slice replaces this whole file, adding subscribe/pause/skip endpoints; the
// recurring box generation runs through pg-boss (idempotent via the
// subscription_orders UNIQUE(subscription_id, round_id)). Kept empty here
// (DI factory + default instance) so index.ts composes it now.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;

export function makeSubscriptionsRoutes(_database: CatalogDb = defaultDb) {
  return new Elysia();
}

// Default instance bound to the runtime db — composed in index.ts.
export const subscriptionsRoutes = makeSubscriptionsRoutes();
