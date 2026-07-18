// Coupon redemption core (MKT-01 / T-04-06 / T-04-07). Correctness is a DATABASE
// property, not application logic — exactly like the oversell reservation guard.
//
// `redeemCouponGuarded()` is a single guarded conditional UPDATE that bumps
// `global_used` iff the coupon is active, unexpired, and still under its global
// limit (mirrors reserve(), reservation.ts:38-46). Under READ COMMITTED a concurrent
// redemption on the same row blocks until the first commits, then re-evaluates its
// WHERE against the committed `global_used` — so the loser matches zero rows. That is
// the whole over-redemption guarantee (coupon-race.test.ts). The per-customer cap is
// the UNIQUE(coupon_id, customer_id) row on `coupon_redemptions`: a 23505 on insert IS
// "already used" (mirrors the payments dedup arbiter).
//
// MUST run INSIDE the POST /orders transaction: a min-subtotal / applicability reject
// (thrown AFTER the guarded UPDATE) rolls back the increment along with the whole
// order, and a coupon shortfall never half-commits. The client sends only the coupon
// CODE (string) — the server resolves the money (T-04-07), and every discount is a
// WHOLE-BAHT amount so the downstream PromptPay QR keeps netSatang % 100 === 0
// (Pitfall 1).
//
// Security: only the parameterized drizzle `sql` template is used — never string
// concatenation — so the code/ids can never inject SQL.
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { OrderError } from "./order-transition";

/** A drizzle db handle OR a transaction handle — both expose `.execute` (mirrors
 *  reservation.ts). Callers pass the order `tx` so redemption joins the order tx. */
export type DbOrTx = Pick<PostgresJsDatabase, "execute">;

/**
 * True for a PostgreSQL unique-violation (SQLSTATE 23505) — the per-customer arbiter.
 * Drizzle wraps the driver error, so the pg SQLSTATE lives on `.cause`; walk the
 * chain to find it (identical to payments.ts:72-79).
 */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

interface CouponRow {
  id: string;
  discount_kind: string;
  discount_value: number;
  min_subtotal_satang: number;
  applicability: { segments?: string[] } | null;
}

/**
 * Atomically redeem coupon `code` for `customerId` on `orderId`, returning the
 * WHOLE-BAHT discount in satang (netSatang % 100 stays 0). MUST run inside the order
 * transaction.
 *
 * @throws OrderError
 *   coupon_exhausted (409)      — no active/unexpired/under-limit coupon matched.
 *   coupon_min_subtotal (409)   — subtotal below the coupon's minimum.
 *   coupon_not_applicable (409) — the order tier is not in the coupon's segments.
 *   coupon_already_used (409)   — this customer already redeemed this coupon (23505).
 */
export async function redeemCouponGuarded(
  tx: DbOrTx,
  code: string,
  customerId: string,
  subtotalSatang: number,
  tier: "b2c" | "b2b",
  orderId: string,
): Promise<number> {
  // Guarded conditional UPDATE — the global usage cap is a DB property. Zero rows ⇒
  // inactive / expired / exhausted ⇒ reject (rolls back the order).
  const rows = (await tx.execute(sql`
    UPDATE coupons
       SET global_used = global_used + 1
     WHERE code = ${code}
       AND active
       AND (expires_at IS NULL OR expires_at > now())
       AND (global_limit IS NULL OR global_used < global_limit)
    RETURNING id, discount_kind, discount_value, min_subtotal_satang, applicability
  `)) as unknown as CouponRow[];
  if (rows.length !== 1) throw new OrderError("coupon_exhausted", 409);
  const c = rows[0] as CouponRow;

  // Static per-coupon guards (safe AFTER the atomic global gate — a throw rolls the
  // increment back inside the order tx).
  if (subtotalSatang < Number(c.min_subtotal_satang)) {
    throw new OrderError("coupon_min_subtotal", 409);
  }
  const segments = c.applicability?.segments ?? ["b2c"]; // D-13 default b2c
  if (!segments.includes(tier)) throw new OrderError("coupon_not_applicable", 409);

  // Resolve the WHOLE-BAHT discount (Pitfall 1). percent → floor to 100-satang
  // multiples; baht → discount_value is a whole-baht amount → satang. Cap at subtotal.
  let discountSatang: number;
  if (c.discount_kind === "percent") {
    const raw = Math.floor((subtotalSatang * Number(c.discount_value)) / 100);
    discountSatang = Math.floor(raw / 100) * 100; // floor to whole baht
  } else {
    discountSatang = Number(c.discount_value) * 100;
  }
  discountSatang = Math.min(discountSatang, subtotalSatang);

  // Per-customer cap: the UNIQUE(coupon_id, customer_id) insert is the arbiter — a
  // 23505 IS "already used" (D-08 idiom). Rolls back with the order on conflict.
  try {
    await tx.execute(sql`
      INSERT INTO coupon_redemptions (coupon_id, customer_id, order_id)
      VALUES (${c.id}, ${customerId}, ${orderId})
    `);
  } catch (e) {
    if (isUniqueViolation(e)) throw new OrderError("coupon_already_used", 409);
    throw e;
  }

  return discountSatang;
}
