// Loyalty ledger service (04-03 / CUST-03, T-04-11). Points are an append-only
// ledger (positive earn / negative redeem); the balance is the SUM of rows, never a
// mutable column (mirrors consent_logs). earnPoints is idempotent per order via the
// partial UNIQUE(order_id) WHERE kind='earn' (a re-entered `paid` transition earns
// at most once). A guest (is_member=false) NEVER earns or redeems (Pitfall 5).
// Economics (earn rate + point→baht) come from the hot settings, defaulting 1/1.
// Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, orders } from "../src/db/schema";
import { earnPoints, getBalance, redeemPointsGuarded } from "../src/services/loyalty";
import { seedRound } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedCustomer(isMember: boolean): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      isMember,
      name: `Cust ${crypto.randomUUID()}`,
      lineUserId: isMember ? `U${crypto.randomUUID().slice(0, 12)}` : null,
    })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

async function seedOrder(customerId: string, roundId: string, subtotalSatang = 20000): Promise<string> {
  const [row] = await db
    .insert(orders)
    .values({ customerId, roundId, tier: "b2c", subtotalSatang })
    .returning({ id: orders.id });
  if (!row) throw new Error("seedOrder: no row");
  return row.id;
}

/** Credit a member with `points` directly (a manual earn row) to set a balance. */
async function creditPoints(customerId: string, points: number): Promise<void> {
  await db.insert(schema.loyaltyLedger).values({ customerId, kind: "earn", points });
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 8 });
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

describe("earnPoints — idempotent earn on a member order (CUST-03)", () => {
  test("inserts a positive ledger row once; a second call is a no-op", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(true);
    const orderId = await seedOrder(customerId, roundId, 20000); // 200 baht

    // Default earn rate 1 point / 100 baht → 200 baht = 2 points.
    const earned = await db.transaction((tx) => earnPoints(tx, orderId));
    expect(earned).toBe(2);
    expect(await getBalance(db, customerId)).toBe(2);

    // Re-entering paid must NOT double-credit (ON CONFLICT DO NOTHING).
    const again = await db.transaction((tx) => earnPoints(tx, orderId));
    expect(again).toBe(0);
    expect(await getBalance(db, customerId)).toBe(2);
  });

  test("a guest order (is_member=false) NEVER earns (Pitfall 5)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(false);
    const orderId = await seedOrder(customerId, roundId, 20000);
    expect(await db.transaction((tx) => earnPoints(tx, orderId))).toBe(0);
    expect(await getBalance(db, customerId)).toBe(0);
  });
});

describe("redeemPointsGuarded — bounded redeem (CUST-03)", () => {
  test("redeems points as a whole-baht discount and appends a negative row", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(true);
    const orderId = await seedOrder(customerId, roundId, 20000);
    await creditPoints(customerId, 100);

    // pointBaht default 1 → 30 points = 30 baht = 3000 satang; payable is generous.
    const discountSatang = await db.transaction((tx) =>
      redeemPointsGuarded(tx, customerId, orderId, 30, 20000),
    );
    expect(discountSatang).toBe(3000);
    expect(discountSatang % 100).toBe(0);
    expect(await getBalance(db, customerId)).toBe(70); // 100 - 30
  });

  test("caps the discount at the payable amount", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(true);
    const orderId = await seedOrder(customerId, roundId, 5000);
    await creditPoints(customerId, 100); // worth 100 baht = 10000 satang

    // Payable is only 5000 satang → discount capped at 5000.
    const discountSatang = await db.transaction((tx) =>
      redeemPointsGuarded(tx, customerId, orderId, 100, 5000),
    );
    expect(discountSatang).toBe(5000);
  });

  test("over-redeem (points > balance) → points_insufficient (409)", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(true);
    const orderId = await seedOrder(customerId, roundId, 20000);
    await creditPoints(customerId, 10);
    await expect(
      db.transaction((tx) => redeemPointsGuarded(tx, customerId, orderId, 200, 20000)),
    ).rejects.toMatchObject({ code: "points_insufficient", httpStatus: 409 });
  });

  test("getBalance = SUM(points) across earn + redeem rows", async () => {
    const roundId = await seedRound(db);
    const customerId = await seedCustomer(true);
    const orderId = await seedOrder(customerId, roundId, 20000);
    await creditPoints(customerId, 50);
    await creditPoints(customerId, 20);
    await db.transaction((tx) => redeemPointsGuarded(tx, customerId, orderId, 15, 20000));
    expect(await getBalance(db, customerId)).toBe(55); // 50 + 20 - 15
  });
});
