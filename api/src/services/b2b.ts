// B2B service (Wave-2 B2B slice, 03-06): standing-order reservation + wholesale
// visibility (CUST-02/05, D-08/09/10).
//
// reserveStanding is the "reserved before B2C" primitive. It is deliberately a
// THIN loop over the EXISTING guarded reserve() (reservation.ts, UNCHANGED): the
// only thing that makes a standing order "priority" is ORDER OF EXECUTION — the
// caller runs it at round-open, before any B2C order can call reserve(), so the
// shared round_stock.reserved_plants counter is pre-incremented (RESEARCH Pattern
// 2). There is deliberately NO second "priority reserved" counter and NO
// SELECT-available pre-check — either would reopen the TOCTOU/oversell window the
// guarded UPDATE closes (Pitfall 1 / T-03-13).
//
// Overflow (D-10): reserve() is all-or-nothing, so a standing item that exceeds the
// round's forecast quota reserves NOTHING (no auto-trim) and returns false. We then
// insert a quota_overflow_flags row inside the SAME tx recording the full shortfall
// for an operator to resolve — the system NEVER auto-decides (no auto-increase, no
// auto-trim). The insert joins the caller's tx so it commits/rolls back atomically
// with the reservations around it.
//
// IMPORTANT: reserveStanding takes a `tx` handle and does NOT open its own
// transaction. 03-05's publishQuota is the single owner of the round-open sequence
// and calls reserveStanding inside the same tx that writes quota_plants; this
// module only provides the pure function (no orchestration, no trigger).
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { customers, quotaOverflowFlags } from "../db/schema";
import { reserve } from "./reservation";

type CatalogDb = PostgresJsDatabase<typeof schema>;
/** A drizzle db OR tx handle — both expose reserve()'s `.execute` and `.insert`. */
export type DbOrTx = CatalogDb | Parameters<Parameters<CatalogDb["transaction"]>[0]>[0];

/** One standing-order line to reserve: a variety and the plants it needs this round. */
export interface StandingItem {
  varietyId: string;
  plants: number;
}

export interface StandingReserveResult {
  /** Items whose full plant count was reserved via reserve() (before B2C). */
  reserved: { varietyId: string; plants: number }[];
  /** Items that exceeded the forecast quota — nothing reserved, a flag was inserted. */
  overflow: { varietyId: string; shortfall: number }[];
}

/**
 * Reserve every standing item on `roundId` through the existing guarded reserve().
 *
 * MUST be called inside the round-open `db.transaction(tx => …)` (03-05
 * publishQuota) so the reservations + any overflow flags commit atomically with the
 * quota write. For each item: reserve() succeeds → recorded in `reserved`; reserve()
 * reports sold-out (false) → NO auto-trim, a quota_overflow_flags(shortfall = the
 * full requested plants, source "b2b") row is inserted for the admin (D-10).
 */
export async function reserveStanding(
  tx: DbOrTx,
  roundId: string,
  items: StandingItem[],
): Promise<StandingReserveResult> {
  const result: StandingReserveResult = { reserved: [], overflow: [] };
  for (const item of items) {
    // The ONE guarded atomic decrement — same fn B2C/box orders use (no 2nd counter).
    const ok = await reserve(tx, roundId, item.varietyId, item.plants);
    if (ok) {
      result.reserved.push({ varietyId: item.varietyId, plants: item.plants });
    } else {
      // D-10: overflow. reserve() is all-or-nothing → nothing was reserved; do NOT
      // auto-trim. Flag the full unreserved demand for an operator to resolve.
      await tx.insert(quotaOverflowFlags).values({
        roundId,
        varietyId: item.varietyId,
        shortfall: item.plants,
        source: "b2b",
      });
      result.overflow.push({ varietyId: item.varietyId, shortfall: item.plants });
    }
  }
  return result;
}

/**
 * Wholesale-visibility gate (D-08): the b2b (wholesale) tier price is visible ONLY
 * to a customer whose b2b_status is 'approved'. A pending/rejected/non-B2B customer
 * must never see wholesale pricing (T-03-14). Returns false for a missing customer.
 */
export async function wholesaleVisible(db: DbOrTx, customerId: string): Promise<boolean> {
  const [row] = await db
    .select({ b2bStatus: customers.b2bStatus })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row?.b2bStatus === "approved";
}
