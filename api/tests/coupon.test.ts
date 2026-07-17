// Coupon redemption service (04-03 / MKT-01, T-04-06/T-04-07). redeemCouponGuarded
// is the money-safe coupon gate: a guarded conditional UPDATE bumps global_used as a
// DB property (mirrors reserve(), reservation.ts:38-46) and a UNIQUE(coupon,customer)
// row is the per-customer cap arbiter (a 23505 IS "already used", payments.ts dedup
// idiom). Races against real PostgreSQL 17 (:55432) so the guarantee lives in PG's
// MVCC row-locking, not application logic. Discounts are ALWAYS whole baht so the
// downstream PromptPay QR keeps netSatang % 100 === 0 (Pitfall 1).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { coupons, customers, orders } from "../src/db/schema";
import { redeemCouponGuarded } from "../src/services/coupon";
import { OrderError } from "../src/services/order-transition";
import { seedRound } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedCustomer(isMember = false): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember, name: `Cust ${crypto.randomUUID()}` })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

/** A bare order row (coupon_redemptions.order_id is NOT NULL + FK → orders.id). */
async function seedOrder(
  customerId: string,
  roundId: string,
  subtotalSatang = 20000,
  tier: "b2c" | "b2b" = "b2c",
): Promise<string> {
  const [row] = await db
    .insert(orders)
    .values({ customerId, roundId, tier, subtotalSatang })
    .returning({ id: orders.id });
  if (!row) throw new Error("seedOrder: no row");
  return row.id;
}

async function seedCoupon(opts: {
  discountKind?: "percent" | "baht";
  discountValue?: number;
  minSubtotalSatang?: number;
  globalLimit?: number | null;
  globalUsed?: number;
  perCustomerLimit?: number;
  applicability?: { segments: string[] };
  active?: boolean;
  expiresAt?: Date | null;
}): Promise<{ id: string; code: string }> {
  const code = `SAVE-${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(coupons)
    .values({
      code,
      discountKind: opts.discountKind ?? "percent",
      discountValue: opts.discountValue ?? 10,
      minSubtotalSatang: opts.minSubtotalSatang ?? 0,
      globalLimit: opts.globalLimit === undefined ? null : opts.globalLimit,
      globalUsed: opts.globalUsed ?? 0,
      perCustomerLimit: opts.perCustomerLimit ?? 1,
      applicability: opts.applicability ?? { segments: ["b2c"] },
      active: opts.active ?? true,
      expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
    })
    .returning({ id: coupons.id });
  if (!row) throw new Error("seedCoupon: no row");
  return { id: row.id, code };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 12 });
  db = drizzle(client, { schema });
  await client.file("drizzle/0005_phase4.down.sql").catch(() => {});
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
  await client.file("drizzle/0005_phase4.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("redeemCouponGuarded — money-safe coupon redemption (MKT-01)", () => {
  test("valid percent coupon → whole-baht discount + records a redemption", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 20000); // 200 baht
    const { id: couponId, code } = await seedCoupon({ discountKind: "percent", discountValue: 10 });

    const discountSatang = await db.transaction((tx) =>
      redeemCouponGuarded(tx, code, customerId, 20000, "b2c", orderId),
    );

    expect(discountSatang).toBe(2000); // 10% of 200 baht = 20 baht
    expect(discountSatang % 100).toBe(0); // whole baht (Pitfall 1)
    const reds = await db.select().from(schema.couponRedemptions);
    expect(reds.filter((r) => r.couponId === couponId && r.orderId === orderId)).toHaveLength(1);
  });

  test("valid baht coupon → discount_value baht → satang, capped at subtotal", async () => {
    const roundId = await seedRound(db);
    const c1 = await seedCustomer();
    const o1 = await seedOrder(c1, roundId, 20000);
    const { code } = await seedCoupon({ discountKind: "baht", discountValue: 50 });
    expect(await db.transaction((tx) => redeemCouponGuarded(tx, code, c1, 20000, "b2c", o1))).toBe(
      5000, // 50 baht
    );

    // A 500-baht coupon on a 200-baht subtotal caps at the subtotal.
    const c2 = await seedCustomer();
    const o2 = await seedOrder(c2, roundId, 20000);
    const { code: big } = await seedCoupon({ discountKind: "baht", discountValue: 500 });
    expect(await db.transaction((tx) => redeemCouponGuarded(tx, big, c2, 20000, "b2c", o2))).toBe(
      20000,
    );
  });

  test("percent discount floors to whole baht (never fractional satang)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 25500);
    const { code } = await seedCoupon({ discountKind: "percent", discountValue: 10 });
    // 10% of 255 baht = 25.5 baht → floor to 25 baht = 2500 satang.
    const discountSatang = await db.transaction((tx) =>
      redeemCouponGuarded(tx, code, customerId, 25500, "b2c", orderId),
    );
    expect(discountSatang).toBe(2500);
    expect(discountSatang % 100).toBe(0);
  });

  test("exhausted global limit → coupon_exhausted (409)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 20000);
    const { code } = await seedCoupon({ globalLimit: 1, globalUsed: 1 });
    await expect(
      db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 20000, "b2c", orderId)),
    ).rejects.toMatchObject({ code: "coupon_exhausted", httpStatus: 409 });
  });

  test("expired coupon → coupon_exhausted (guarded UPDATE matches zero rows)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 20000);
    const { code } = await seedCoupon({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(
      db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 20000, "b2c", orderId)),
    ).rejects.toBeInstanceOf(OrderError);
  });

  test("subtotal below min → coupon_min_subtotal (409)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 5000);
    const { code } = await seedCoupon({ minSubtotalSatang: 10000 });
    await expect(
      db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 5000, "b2c", orderId)),
    ).rejects.toMatchObject({ code: "coupon_min_subtotal", httpStatus: 409 });
  });

  test("tier not in applicability segments → coupon_not_applicable (409)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const orderId = await seedOrder(customerId, roundId, 20000, "b2b");
    const { code } = await seedCoupon({ applicability: { segments: ["b2c"] } });
    await expect(
      db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 20000, "b2b", orderId)),
    ).rejects.toMatchObject({ code: "coupon_not_applicable", httpStatus: 409 });
  });

  test("same customer's second use of a per-customer-1 coupon → coupon_already_used (409)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer();
    const o1 = await seedOrder(customerId, roundId, 20000);
    const o2 = await seedOrder(customerId, roundId, 20000);
    const { code } = await seedCoupon({ discountKind: "percent", discountValue: 10 });

    expect(await db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 20000, "b2c", o1))).toBe(
      2000,
    );
    await expect(
      db.transaction((tx) => redeemCouponGuarded(tx, code, customerId, 20000, "b2c", o2)),
    ).rejects.toMatchObject({ code: "coupon_already_used", httpStatus: 409 });
  });
});
