// Background-job seam — the FIRST worker in the codebase (PAY-03 / D-08/09/10/11).
// pg-boss reuses the SAME PostgreSQL (no extra infra, NFR-08); it creates its own
// `pgboss` schema on start(). This module only BOOTS the queue — the hold-expiry
// work handler + the safety-net sweep are added by 02-07 via boss.work(...).
//
// Lifecycle: startJobs() is called ONLY under `import.meta.main` in index.ts (the
// same guard that binds the port), so `bun test` importing `app` never spins a
// worker. Constructing `boss` here is connection-free — pg-boss connects on start().
import { PgBoss } from "pg-boss"; // v12 named export (was a default export in v10)
import { env } from "../env";
import { log } from "../lib/logger";

// Pitfall 6 / T-02-02: pg-boss MUST use the DIRECT (unpooled) endpoint. Its
// advisory-lock maintenance breaks on a PgBouncer transaction-pooled connection.
export const boss = new PgBoss(env.DATABASE_URL_DIRECT);

/**
 * Start pg-boss and ensure the hold-expiry queue exists. Idempotent: createQueue
 * is a no-op if the queue is already registered. The work handler is intentionally
 * NOT registered here — 02-07 attaches `boss.work("hold-expiry", …)` + the sweep.
 */
export async function startJobs(): Promise<void> {
  await boss.start();
  await boss.createQueue("hold-expiry");
  log.info("jobs started", { queue: "hold-expiry" });
}

/** Graceful shutdown — drain and disconnect the worker on process stop. */
export async function stopJobs(): Promise<void> {
  await boss.stop();
}
