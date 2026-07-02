// Health endpoints (D-14).
//   GET /health        — liveness: 200 whenever the process is up (no I/O).
//   GET /health/ready   — readiness: pings the DB (SELECT 1) → 200 ready / 503 unavailable.
// Readiness does NOT live-call LINE/R2 (D-14) — config is already validated at boot;
// only real DB reachability is checked here.
//
// `makeHealthRoutes(database)` takes the DB so both branches are unit-testable with an
// injected good/bad client; the default binds the real runtime `db`. index.ts imports
// the `healthRoutes` export unchanged.
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";

/** Minimal surface the readiness probe needs — anything that can run `SELECT 1`. */
type Pingable = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export function makeHealthRoutes(database: Pingable = defaultDb) {
  return new Elysia()
    .get("/health", () => ({ status: "ok" }))
    .get("/health/ready", async ({ set }) => {
      try {
        await database.execute(sql`SELECT 1`);
        return { status: "ready" };
      } catch {
        set.status = 503;
        return { status: "unavailable" };
      }
    });
}

export const healthRoutes = makeHealthRoutes();
