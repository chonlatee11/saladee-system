// Coupon over-redemption race (04-03 / T-04-06). The DEFINING coupon proof, mirror
// of tests/reservation.test.ts: N concurrent redemptions of a global-limit-1 coupon
// must yield EXACTLY ONE success. The guarantee is a DB property — the guarded
// conditional UPDATE (global_used = global_used + 1 WHERE global_used < global_limit)
// serialises under PG MVCC row-locking, so the losers re-evaluate against the
// committed value and match zero rows. Raced against real PostgreSQL 17 (:55432);
// the pool max exceeds N so the racers truly run in parallel (Pitfall 2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { coupons, customers, orders } from "../src/db/schema";
import { redeemCouponGuarded } from "../src/services/coupon";
import { seedRound } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const N = 8; // concurrent racers for the single global slot

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  // Pool max MUST exceed N so the racers get distinct connections (Pitfall 2).
  client = postgres(TEST_URL, { prepare: false, max: N + 4 });
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

describe("redeemCouponGuarded — global-limit race (T-04-06)", () => {
  test(`N=${N} concurrent redemptions of a limit-1 coupon → exactly 1 success`, async () => {
    const roundId = await seedRound(db);
    const [coupon] = await db
      .insert(coupons)
      .values({
        code: `RACE-${crypto.randomUUID().slice(0, 8)}`,
        discountKind: "baht",
        discountValue: 10,
        globalLimit: 1,
        // Distinct customers per racer, so the per-customer UNIQUE never interferes —
        // this test isolates the GLOBAL usage cap.
      })
      .returning({ id: coupons.id, code: coupons.code });
    if (!coupon) throw new Error("coupon insert returned no row");

    // Distinct (customer, order) per racer.
    const racers = await Promise.all(
      Array.from({ length: N }, async () => {
        const [c] = await db
          .insert(customers)
          .values({ name: `Racer ${crypto.randomUUID()}` })
          .returning({ id: customers.id });
        if (!c) throw new Error("customer insert returned no row");
        const [o] = await db
          .insert(orders)
          .values({ customerId: c.id, roundId, tier: "b2c", subtotalSatang: 20000 })
          .returning({ id: orders.id });
        if (!o) throw new Error("order insert returned no row");
        return { customerId: c.id, orderId: o.id };
      }),
    );

    const results = await Promise.allSettled(
      racers.map((r) =>
        db.transaction((tx) =>
          redeemCouponGuarded(tx, coupon.code, r.customerId, 20000, "b2c", r.orderId),
        ),
      ),
    );

    const wins = results.filter((r) => r.status === "fulfilled").length;
    const losses = results.filter((r) => r.status === "rejected").length;
    expect(wins).toBe(1); // exactly one racer consumes the single global slot
    expect(losses).toBe(N - 1);

    // The invariant that matters: global_used never exceeds global_limit and exactly
    // one redemption row was recorded.
    const [row] = await db
      .select({ globalUsed: coupons.globalUsed })
      .from(coupons)
      .where(eq(coupons.id, coupon.id))
      .limit(1);
    expect(row?.globalUsed).toBe(1);
    const reds = await db.select().from(schema.couponRedemptions);
    expect(reds.filter((x) => x.couponId === coupon.id)).toHaveLength(1);
  });
});
