// Loyalty points core (CUST-03 / T-04-11). Points are an APPEND-ONLY ledger:
// positive `earn` rows, negative `redeem` rows; the balance is the SUM of rows,
// never a mutable column (mirrors consent_logs). Economics (earn rate + point→baht)
// are hot config read from the `settings` table (D-11), defaulting to 1 point per
// 100 baht subtotal and 1 baht per point.
//
//   • earnPoints(tx, orderId): credits the member once per order. The partial
//     UNIQUE(order_id) WHERE kind='earn' makes a re-entered `paid` transition a safe
//     no-op (ON CONFLICT DO NOTHING, Pitfall 4). A guest order (is_member=false)
//     NEVER earns (Pitfall 5) — self-gated by reading the order's customer.
//   • redeemPointsGuarded(tx, customerId, orderId, points, payableSatang): validates
//     points ≤ balance, converts to a WHOLE-BAHT discount (netSatang % 100 stays 0),
//     caps it at the payable amount, and appends a negative redeem row.
//   • getBalance(db, customerId): SUM(points).
//
// MUST run inside the order / transition transaction so a downstream rollback undoes
// the ledger write. Only parameterized drizzle `sql` templates are used.
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { OrderError } from "./order-transition";

/** A drizzle db handle OR a transaction handle — both expose `.execute`. */
export type DbOrTx = Pick<PostgresJsDatabase, "execute">;

/** Hot loyalty economics (D-11), read from `settings`; defaults 1 point / 100 baht
 *  and 1 baht / point when no override row exists. */
async function readEconomics(tx: DbOrTx): Promise<{ earnRate: number; pointBaht: number }> {
  const rows = (await tx.execute(sql`
    SELECT key, value FROM settings
     WHERE key IN ('loyalty_earn_rate', 'loyalty_point_baht')
  `)) as unknown as { key: string; value: unknown }[];
  let earnRate = 1;
  let pointBaht = 1;
  for (const r of rows) {
    const n = typeof r.value === "number" ? r.value : Number(r.value);
    if (!Number.isFinite(n)) continue;
    if (r.key === "loyalty_earn_rate") earnRate = n;
    else if (r.key === "loyalty_point_baht") pointBaht = n;
  }
  return { earnRate, pointBaht };
}

/** Current points balance = SUM of the append-only ledger rows. */
export async function getBalance(tx: DbOrTx, customerId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(points), 0)::int AS balance
      FROM loyalty_ledger WHERE customer_id = ${customerId}
  `)) as unknown as { balance: number }[];
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Credit loyalty points for `orderId`, ONCE. Reads the order's customer + subtotal;
 * a guest (is_member=false) earns nothing (Pitfall 5). Points are computed on the
 * subtotal (A4) at the hot earn rate. The partial UNIQUE(order_id) WHERE kind='earn'
 * makes a repeat call (re-entered `paid`) a no-op.
 * @returns the points credited (0 if guest, zero-value, or already earned).
 */
export async function earnPoints(tx: DbOrTx, orderId: string): Promise<number> {
  const ord = (await tx.execute(sql`
    SELECT o.customer_id, o.subtotal_satang, c.is_member
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ${orderId}
  `)) as unknown as { customer_id: string; subtotal_satang: number; is_member: boolean }[];
  const row = ord[0];
  if (!row || !row.is_member) return 0; // guest never earns

  const { earnRate } = await readEconomics(tx);
  // earnRate = points per 100 baht subtotal; subtotal is satang → /10000 per point.
  const points = Math.floor((Number(row.subtotal_satang) * earnRate) / 10000);
  if (points <= 0) return 0;

  const inserted = (await tx.execute(sql`
    INSERT INTO loyalty_ledger (customer_id, order_id, kind, points)
    VALUES (${row.customer_id}, ${orderId}, 'earn', ${points})
    ON CONFLICT (order_id) WHERE kind = 'earn' DO NOTHING
    RETURNING id
  `)) as unknown as { id: string }[];
  return inserted.length === 1 ? points : 0;
}

/**
 * Redeem `points` for `customerId` on `orderId`, returning the WHOLE-BAHT discount in
 * satang, capped at `payableSatang`. MUST run inside the order tx.
 * @throws OrderError points_insufficient (409) when points exceed the balance.
 */
export async function redeemPointsGuarded(
  tx: DbOrTx,
  customerId: string,
  orderId: string,
  points: number,
  payableSatang: number,
): Promise<number> {
  if (points <= 0) return 0;
  const balance = await getBalance(tx, customerId);
  if (points > balance) throw new OrderError("points_insufficient", 409);

  const { pointBaht } = await readEconomics(tx);
  // Convert to a WHOLE-BAHT discount, then cap at the payable amount (Pitfall 1).
  const rawSatang = Math.floor(points * pointBaht) * 100;
  const discountSatang = Math.min(rawSatang, Math.max(0, payableSatang));

  await tx.execute(sql`
    INSERT INTO loyalty_ledger (customer_id, order_id, kind, points)
    VALUES (${customerId}, ${orderId}, 'redeem', ${-points})
  `);
  return discountSatang;
}
