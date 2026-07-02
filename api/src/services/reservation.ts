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
