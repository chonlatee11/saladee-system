// Oversell-safe stock reservation core (PLAT-01 / INV-06 / D-07).
//
// Correctness is a DATABASE property, not application logic. `reserve()` is a
// single guarded conditional UPDATE: PostgreSQL evaluates the WHERE, row-locks
// the matched row, and applies the increment indivisibly. Under READ COMMITTED
// (PG default), a concurrent UPDATE on the same row blocks until the first
// commits, then re-evaluates its WHERE against the committed value — so the loser
// sees the winner's incremented reserved_plants and matches zero rows. That is
// the whole oversell guarantee; there is deliberately NO SELECT-then-check and NO
// application-side decision. Proven by the N-way race in tests/reservation.test.ts.
//
// Security: only the parameterized drizzle `sql` template is used — never a raw
// unparameterized query or string concatenation — so ids and plant counts can
// never inject SQL (T-01-03).
// Do NOT switch to `.for("update", { noWait: true })` — Drizzle emits invalid SQL
// (issue #3554); the guarded UPDATE needs no explicit lock clause.
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * A drizzle database handle OR a transaction handle — both expose `.execute`.
 * Callers (01-02 POST /orders, 01-05 box) pass a `tx` so the reservation joins
 * the surrounding all-or-nothing transaction; direct callers pass `db`.
 */
export type DbOrTx = Pick<PostgresJsDatabase, "execute">;

/**
 * Atomically reserve `plants` on (round, variety).
 * @returns true iff the plants were reserved; false (zero rows) ⇒ insufficient
 *          stock (sold out) ⇒ the caller rejects / rolls back its transaction.
 */
export async function reserve(
  tx: DbOrTx,
  roundId: string,
  varietyId: string,
  plants: number,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE round_stock
       SET reserved_plants = reserved_plants + ${plants}
     WHERE round_id = ${roundId}
       AND variety_id = ${varietyId}
       AND quota_plants - reserved_plants >= ${plants}
    RETURNING id
  `);
  return rows.length === 1;
}

/**
 * Atomically release `plants` previously reserved on (round, variety).
 * Guarded by `reserved_plants >= plants` so a double-release can never drive
 * reserved below zero or inflate available stock (D-08 / Pitfall 5).
 * @returns true iff the plants were released; false ⇒ nothing to release.
 */
export async function release(
  tx: DbOrTx,
  roundId: string,
  varietyId: string,
  plants: number,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE round_stock
       SET reserved_plants = reserved_plants - ${plants}
     WHERE round_id = ${roundId}
       AND variety_id = ${varietyId}
       AND reserved_plants >= ${plants}
    RETURNING id
  `);
  return rows.length === 1;
}

// ── Mixed-salad box: all-or-nothing multi-component reservation (INV-07 / D-17) ─

/** One BOM component: a variety and how many plants of it a single box consumes. */
export interface BoxComponent {
  varietyId: string;
  plantsPerBox: number;
}

/**
 * Thrown by `reserveBox()` when a component is short. Carries the offending
 * variety for diagnostics. Callers catch it and map to their own HTTP error;
 * because it is thrown INSIDE the surrounding `db.transaction`, throwing rolls
 * back every earlier component decrement in the same box → zero net change.
 */
export class BoxShortfallError extends Error {
  constructor(readonly varietyId: string) {
    super(`box component short: ${varietyId}`);
    this.name = "BoxShortfallError";
  }
}

/**
 * Reserve every BOM component of `boxQty` boxes in ONE transaction, all-or-nothing.
 *
 * Correctness (INV-07): components are sorted by `varietyId` so EVERY concurrent
 * box order acquires its round_stock row locks in the SAME global order — this
 * removes the deadlock window (RESEARCH Pattern 2 / T-01-19). Each component is
 * reserved via the proven guarded `reserve()`; the first component that cannot be
 * satisfied throws `BoxShortfallError`, which unwinds the caller's `db.transaction`
 * and undoes any components already decremented in this box (T-01-18). There is
 * deliberately NO partial success: either every component is reserved or none is.
 *
 * MUST be called inside a `db.transaction` (pass the `tx`) so the throw rolls back.
 */
export async function reserveBox(
  tx: DbOrTx,
  roundId: string,
  components: BoxComponent[],
  boxQty: number,
): Promise<void> {
  // Global lock order: sort by variety_id (stable uuid ordering) → no deadlock.
  const ordered = [...components].sort((a, b) => a.varietyId.localeCompare(b.varietyId));
  for (const c of ordered) {
    const ok = await reserve(tx, roundId, c.varietyId, c.plantsPerBox * boxQty);
    if (!ok) throw new BoxShortfallError(c.varietyId); // → whole tx rolls back
  }
}

/** A round_stock counter for one variety (the numbers box availability reads). */
export interface ComponentStock {
  quotaPlants: number;
  reservedPlants: number;
}

/**
 * How many whole boxes are orderable right now = the scarcest component's limit:
 * `min(floor((quota − reserved) / plantsPerBox))` across every component (INV-07).
 * A component with no stock row in this round (undefined) makes the box
 * unavailable (0). Used for catalog/display; the transaction is the authority at
 * order time.
 */
export function boxAvailability(
  components: BoxComponent[],
  stockByVariety: Map<string, ComponentStock>,
): number {
  if (components.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const c of components) {
    const stock = stockByVariety.get(c.varietyId);
    if (!stock) return 0; // component not stocked this round ⇒ box not orderable
    const avail = Math.floor((stock.quotaPlants - stock.reservedPlants) / c.plantsPerBox);
    if (avail < min) min = avail;
  }
  return Math.max(0, min === Number.POSITIVE_INFINITY ? 0 : min);
}
