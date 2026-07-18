// Background-job seam — the FIRST worker in the codebase (PAY-03 / D-08/09/10/11).
// pg-boss reuses the SAME PostgreSQL (no extra infra, NFR-08); it creates its own
// `pgboss` schema on start(). 02-01 BOOTED the queue; 02-07 (this file) attaches
// the hold-expiry work handler + the periodic safety-net sweep.
//
// Lifecycle: startJobs() is called ONLY under `import.meta.main` in index.ts (the
// same guard that binds the port), so `bun test` importing `app` never spins a
// worker. Constructing `boss` here is connection-free — pg-boss connects on start().
import { and, eq, inArray, lt } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PgBoss } from "pg-boss"; // v12 named export (was a default export in v10)
import postgres from "postgres";
import * as schema from "../db/schema";
import { orders, payments } from "../db/schema";
import { env } from "../env";
import { log } from "../lib/logger";
import { runBroadcast } from "../services/broadcast";
import { notifySubstitution } from "../services/notify";
import { applyTransition } from "../services/order-transition";
import { generateForRound } from "../services/subscription";

// Pitfall 6 / T-02-02: pg-boss MUST use the DIRECT (unpooled) endpoint. Its
// advisory-lock maintenance breaks on a PgBouncer transaction-pooled connection.
export const boss = new PgBoss(env.DATABASE_URL_DIRECT);

/** A drizzle handle the worker can run transactions against (accepted by expireHold). */
export type WorkerDb = PostgresJsDatabase<typeof schema>;

// Lazily-constructed worker DB on the DIRECT endpoint. Lazy so importing this
// module (e.g. in a test that pulls in the app) opens no connection; the pooled
// runtime `db` is HTTP-request scoped, the worker needs its own out-of-band handle.
let _workerDb: WorkerDb | null = null;
function workerDb(): WorkerDb {
  if (!_workerDb) {
    const client = postgres(env.DATABASE_URL_DIRECT, { prepare: false, max: 4 });
    _workerDb = drizzle(client, { schema });
  }
  return _workerDb;
}

// The unpaid-hold states whose expiry may release stock. applyTransition's
// onlyIfHold gate re-enforces this under a row lock (HOLD_STATES = {created,
// awaiting_payment}) — the list here is only the sweep's coarse pre-filter.
// CR-02: `created` is included so a stock-reserving legacy/guest order (which
// now always carries a holdExpiresAt) is reclaimed too, closing the permanent
// stock-hold hole where a `created` order was never swept (NFR-02).
const HOLD_STATUSES = ["created", "awaiting_payment"] as const;

/**
 * Expire ONE order's payment hold (PAY-03 release half / D-09).
 *
 * Runs inside a single transaction:
 *  1. NO-OP if a payments row for the order is `awaiting_review`/`verifying`
 *     (D-04 ↔ D-09) — a human confirmation is pending; never cancel it out from
 *     under the admin.
 *  2. Otherwise call the SHARED guarded applyTransition(..., { onlyIfHold: true }),
 *     which only cancels a {created, awaiting_payment} order and releases its
 *     reserved stock in the SAME tx. A paid/packing/shipping/done order is a safe
 *     no-op — a late timer can never release already-sold stock (Pitfall 1 / T-02-25).
 *
 * @returns true iff the order was actually cancelled by this call.
 */
export async function expireHold(database: WorkerDb, orderId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    // (1) Guard: a slip is under human review → the hold must NOT auto-cancel.
    const parked = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          inArray(payments.status, ["awaiting_review", "verifying"]),
        ),
      )
      .limit(1);
    if (parked.length > 0) {
      log.info("hold-expiry skipped: payment under review", { orderId });
      return false;
    }

    // (2) Guarded cancel+release — onlyIfHold makes a non-hold order a safe no-op.
    const result = await applyTransition(tx, orderId, "cancelled", { onlyIfHold: true });
    if (result.applied) log.info("hold expired: order cancelled + stock released", { orderId });
    return result.applied;
  });
}

/**
 * Authoritative self-heal (Pitfall 2 / T-02-26): cancel EVERY awaiting_payment
 * order whose holdExpiresAt is already past, via the same guarded expireHold path.
 * This closes the window where `boss.send("hold-expiry", …)` was never scheduled
 * (a checkout committed then the process crashed before scheduling the timer).
 *
 * @returns the number of orders actually cancelled by the sweep.
 */
export async function sweepExpiredHolds(
  database: WorkerDb,
  now: Date = new Date(),
): Promise<number> {
  const stranded = await database
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.status, HOLD_STATUSES), lt(orders.holdExpiresAt, now)));

  let cancelled = 0;
  for (const o of stranded) {
    // Each order in its own tx so one failure never rolls back the whole sweep.
    if (await expireHold(database, o.id)) cancelled += 1;
  }
  if (cancelled > 0) log.info("hold-sweep self-healed stranded holds", { cancelled });
  return cancelled;
}

/**
 * Start pg-boss, ensure the queues exist, and attach the workers (D-08/09).
 * createQueue/schedule are idempotent. Called ONLY under import.meta.main so
 * `bun test` never spins a worker.
 */
export async function startJobs(): Promise<void> {
  await boss.start();
  const db = workerDb();

  // Per-order hold-expiry timer (scheduled at checkout by 02-04, singletonKey=orderId).
  await boss.createQueue("hold-expiry");
  await boss.work("hold-expiry", async (jobs) => {
    for (const job of jobs) {
      await expireHold(db, (job.data as { orderId: string }).orderId);
    }
  });

  // Safety-net sweep every 2 minutes — authoritative over holdExpiresAt (Pitfall 2).
  await boss.createQueue("hold-sweep");
  await boss.schedule("hold-sweep", "*/2 * * * *");
  await boss.work("hold-sweep", async () => {
    await sweepExpiredHolds(db);
  });

  // Recurring subscription-box generation (SALE-03 / D-13). This file defines the
  // queue + worker ONLY; it does NOT trigger it. The single boss.send trigger lives
  // in 03-05 publishQuota, fired AFTER a round's quota is published+committed
  // (`boss.send("subscription-generate", { roundId }, { singletonKey: roundId })`),
  // because the box fill needs the round's published availability (Wave-3,
  // post-publish). Idempotency is enforced by the DB UNIQUE(subscription_id,
  // round_id) inside generateForRound (23505 → skip), NOT by singletonKey alone
  // (Pitfall 2). Runs on the DIRECT worker db; substitution notices reuse notify.ts.
  const subHoldWindowSeconds = Number(env.HOLD_WINDOW_SECONDS);
  await boss.createQueue("subscription-generate");
  await boss.work("subscription-generate", async (jobs) => {
    for (const job of jobs) {
      const roundId = (job.data as { roundId: string }).roundId;
      const res = await generateForRound(db, roundId, {
        notify: notifySubstitution,
        holdWindowSeconds: subHoldWindowSeconds,
      });
      log.info("subscription-generate ran", {
        roundId,
        generated: res.generated.length,
        skipped: res.skipped.length,
      });
    }
  });

  // Segmented marketing broadcast (MKT-03 / LINE-04). The route enqueues send-now or
  // scheduled (startAfter) campaigns; the worker resolves the consent-filtered audience
  // and multicasts in ≤500 chunks. Runs on the SAME direct worker db (Pitfall 6) — no
  // new pool. Idempotency: runBroadcast marks the row `sent`, so a redelivery re-sends
  // to the (now consent-current) audience; the route blocks re-send of a `sent` row.
  await boss.createQueue("broadcast-send");
  await boss.work("broadcast-send", async (jobs) => {
    for (const job of jobs) {
      await runBroadcast(db, (job.data as { broadcastId: string }).broadcastId);
    }
  });

  log.info("jobs started", {
    queues: ["hold-expiry", "hold-sweep", "subscription-generate", "broadcast-send"],
  });
}

/** Graceful shutdown — drain and disconnect the worker on process stop. */
export async function stopJobs(): Promise<void> {
  await boss.stop();
}
