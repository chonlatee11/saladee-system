// Shared, guarded order-status transition (D-09) — the SINGLE implementation of
// the row-lock + re-read + on-cancel stock-release path that ALL Phase-2 callers
// reuse: the staff PATCH /orders/:id/status (01-02), the slip-verify → paid flow
// (02-06), and the pg-boss hold-expiry → cancelled job (02-07). Extracting it here
// (behavior-preserving lift from the orders.ts PATCH handler) guarantees three
// future callers cannot each re-break the Phase-1 concurrent-cancel oversell fix.
//
// The block below is TOCTOU-safe: it SELECT ... FOR UPDATE locks the order row and
// reads the AUTHORITATIVE status inside the caller's transaction, so two concurrent
// cancels serialise and release() runs at most once (CR-01 / WR-05 / NFR-02).
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { orderLines, orders } from "../db/schema";
import { canTransition, type OrderStatus } from "./order-status";
import { release } from "./reservation";

// The transaction handle passed by a caller's `database.transaction(async (tx) => …)`.
// Typed from the driver so `.select().for("update")` / `.update()` are available.
type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/** Signalled inside a transaction to roll back with a specific HTTP mapping. */
export class OrderError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
  }
}

// The unpaid hold states an expiry timer is allowed to cancel. TRANSITIONS also
// permits paid→cancelled (a legitimate staff refund), so a naive canTransition
// would let a LATE hold-expiry timer cancel a just-paid order and wrongly release
// its (now sold) stock — RESEARCH Pitfall 1 / T-02-01. onlyIfHold gates on these.
const HOLD_STATES: ReadonlySet<OrderStatus> = new Set(["created", "awaiting_payment"]);

export interface ApplyTransitionOpts {
  /**
   * When true, refuse (no-op) any transition whose LOCKED current status is not an
   * unpaid hold state ({created, awaiting_payment}). The hold-expiry job (02-07)
   * passes this so a late timer can never cancel a paid/packing/shipping order.
   */
  onlyIfHold?: boolean;
}

export interface TransitionResult {
  /** false ⇒ onlyIfHold skipped a non-hold state (safe no-op). */
  applied: boolean;
  /** The authoritative status after this call (unchanged when skipped). */
  status: OrderStatus;
}

/**
 * Apply `next` to order `orderId` inside the caller's transaction `tx`, guarded by
 * a row lock + authoritative re-read; on entering `cancelled` it releases the
 * order's reserved plants in the SAME tx, idempotently (D-08 / Pitfall 5).
 *
 * Post-commit side effects (e.g. the milestone Flex push wired in 02-07) belong at
 * the CALL SITE, keyed off the returned {@link TransitionResult}, because this
 * function runs INSIDE the caller's tx and cannot observe its commit — firing a
 * notification here would leak on rollback (RESEARCH: notify is post-commit).
 *
 * @throws OrderError order_not_found (404) / illegal_transition (400).
 */
export async function applyTransition(
  tx: Tx,
  orderId: string,
  next: OrderStatus,
  opts: ApplyTransitionOpts = {},
): Promise<TransitionResult> {
  // Lock the order row and read the AUTHORITATIVE status INSIDE the tx
  // (SELECT ... FOR UPDATE). Reading status outside the tx and validating against
  // that stale value opened a TOCTOU window where two concurrent cancels both
  // passed canTransition('paid','cancelled') and both ran release() —
  // double-decrementing reserved_plants and freeing OTHER orders' reservations
  // (oversell, NFR-02 / INV-06). With the row lock, the second racer blocks until
  // the first commits, then re-reads status = 'cancelled' and fails the transition
  // gate below, so release() runs exactly once. This also closes the general
  // lost-update window for ANY two concurrent transitions (WR-05).
  const [locked] = await tx
    .select({ status: orders.status, roundId: orders.roundId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update")
    .limit(1);
  if (!locked) throw new OrderError("order_not_found", 404);
  const current = locked.status as OrderStatus;

  // Hold-expiry guard (D-09): a late timer must never touch a non-hold order.
  // Return a safe no-op instead of an error so the job is idempotent.
  if (opts.onlyIfHold && !HOLD_STATES.has(current)) {
    return { applied: false, status: current };
  }

  // Re-validate the transition against the LOCKED row, not a stale read.
  // `cancelled` from a terminal state (done) or a repeat cancel is illegal here
  // → 400, so stock is never re-released.
  if (!canTransition(current, next)) {
    throw new OrderError("illegal_transition", 400);
  }

  // A `cancelled` entry (from a non-cancelled state) releases the order's reserved
  // plants in the SAME tx. The row lock above serialises racers, so this branch
  // runs at most once per order (D-08 / Pitfall 5).
  if (next === "cancelled" && current !== "cancelled") {
    const lines = await tx
      .select({
        lineKind: orderLines.lineKind,
        varietyId: orderLines.varietyId,
        plants: orderLines.plantsDecremented,
        qty: orderLines.qty,
        boxBomJson: orderLines.boxBomJson,
      })
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId));
    for (const l of lines) {
      if (l.lineKind === "box") {
        // Release EVERY component of the box from its frozen BOM snapshot
        // (plantsPerBox × qty), so a cancelled box never strands stock.
        const bom = l.boxBomJson as {
          components?: { varietyId: string; plantsPerBox: number }[];
        } | null;
        for (const c of bom?.components ?? []) {
          await release(tx, locked.roundId, c.varietyId, c.plantsPerBox * l.qty);
        }
      } else if (l.varietyId) {
        await release(tx, locked.roundId, l.varietyId, l.plants);
      }
    }
  }

  await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, orderId));
  return { applied: true, status: next };
}
