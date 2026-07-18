// SALE-03 / D-13/D-14/D-16 — the subscription generator proof, raced against real
// PostgreSQL 17 (:55432). generateForRound(db, roundId) creates ONE box order per
// active subscription and reserves its plants through the EXISTING guarded
// reserveBox() (reservation.ts, UNCHANGED — no second counter, Pitfall 1). It is
// IDEMPOTENT: the DB UNIQUE(subscription_id, round_id) on subscription_orders makes
// a re-run a safe no-op (23505 → skip), never a duplicate box (Pitfall 2). It reads
// subscription status + skip rows at RUN TIME, so paused/cancelled/skipped
// subscriptions are skipped (D-14). When a round variety is sold out the box is
// filled from what's available and a substitution notice fires to the member — a
// guest (no line_user_id) is skipped silently (D-16 / D-23).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  customers,
  subscriptionOrders,
  subscriptions,
  subscriptionSkips,
} from "../src/db/schema";
import { reserve } from "../src/services/reservation";
import { generateForRound, type SubstitutionNotice } from "../src/services/subscription";
import { seedPrice, seedRound, seedRoundStock, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

async function seedCustomer(lineUserId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: lineUserId !== null, lineUserId })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: insert returned no row");
  return row.id;
}

async function seedSubscription(
  customerId: string,
  opts: {
    status?: "active" | "paused" | "cancelled";
    packageValueSatang?: number;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(subscriptions)
    .values({
      customerId,
      packageCode: "M",
      packageValueSatang: opts.packageValueSatang ?? 50000,
      frequency: "weekly",
      status: opts.status ?? "active",
    })
    .returning({ id: subscriptions.id });
  if (!row) throw new Error("seedSubscription: insert returned no row");
  return row.id;
}

async function orderCountFor(subscriptionId: string): Promise<number> {
  const rows = await db
    .select()
    .from(subscriptionOrders)
    .where(eq(subscriptionOrders.subscriptionId, subscriptionId));
  return rows.length;
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  // Self-resetting-test invariant (03-01): down all, up all so sibling tests still
  // find the Phase-3 tables/columns after this file runs.
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

// Each test owns a clean subscription slate; generateForRound iterates ALL active
// subscriptions, so leftover rows from a sibling test would otherwise generate into
// this test's round. Rounds/varieties are per-test (fresh ids), so stock is isolated.
beforeEach(async () => {
  await db.delete(subscriptionOrders);
  await db.delete(subscriptionSkips);
  await db.delete(subscriptions);
});

describe("generateForRound() — reserve-before-B2C via reserveBox(), idempotent (D-13)", () => {
  test("creates one box order per active subscription and reserves its plants", async () => {
    const varietyId = await seedVariety(db);
    const roundId = await seedRound(db);
    await seedRoundStock(db, roundId, varietyId, 100);
    await seedPrice(db, roundId, varietyId, "b2c", 20000); // 200 baht/kg
    const customerId = await seedCustomer("U-member-1");
    const subId = await seedSubscription(customerId, { packageValueSatang: 50000 });

    const result = await generateForRound(db, roundId);

    expect(result.generated).toHaveLength(1);
    expect(result.generated[0]?.subscriptionId).toBe(subId);
    expect(await orderCountFor(subId)).toBe(1);
    // per-plant = ceil(20000*120/1000/100)*100 = 2400 satang; 50000/2400 → 20 plants.
    expect(await reservedPlants(roundId, varietyId)).toBe(20);
  });

  test("is idempotent: a second run creates no duplicate order and does not double-reserve", async () => {
    const varietyId = await seedVariety(db);
    const roundId = await seedRound(db);
    await seedRoundStock(db, roundId, varietyId, 100);
    await seedPrice(db, roundId, varietyId, "b2c", 20000);
    const customerId = await seedCustomer("U-member-2");
    const subId = await seedSubscription(customerId, { packageValueSatang: 50000 });

    await generateForRound(db, roundId);
    const reservedAfterFirst = await reservedPlants(roundId, varietyId);

    const second = await generateForRound(db, roundId);
    // The DB UNIQUE(subscription,round) makes the retry a no-op (Pitfall 2).
    expect(second.generated).toHaveLength(0);
    expect(second.skipped.some((s) => s.subscriptionId === subId && s.reason === "duplicate")).toBe(
      true,
    );
    expect(await orderCountFor(subId)).toBe(1);
    expect(await reservedPlants(roundId, varietyId)).toBe(reservedAfterFirst);
  });

  test("skips paused/cancelled subscriptions and subscriptions with a skip row (D-14)", async () => {
    const varietyId = await seedVariety(db);
    const roundId = await seedRound(db);
    await seedRoundStock(db, roundId, varietyId, 100);
    await seedPrice(db, roundId, varietyId, "b2c", 20000);

    const paused = await seedSubscription(await seedCustomer("U-paused"), { status: "paused" });
    const cancelled = await seedSubscription(await seedCustomer("U-cancel"), {
      status: "cancelled",
    });
    const skipped = await seedSubscription(await seedCustomer("U-skip"));
    await db.insert(subscriptionSkips).values({ subscriptionId: skipped, roundId });

    const result = await generateForRound(db, roundId);

    expect(result.generated).toHaveLength(0);
    expect(await orderCountFor(paused)).toBe(0);
    expect(await orderCountFor(cancelled)).toBe(0);
    expect(await orderCountFor(skipped)).toBe(0);
    // Nothing was reserved because no order was generated.
    expect(await reservedPlants(roundId, varietyId)).toBe(0);
  });

  test("substitution: a sold-out variety fills from what's available and notifies the member; guest is skipped", async () => {
    // Available variety + a sold-out (0-quota) variety in the SAME round → substitution.
    const okVariety = await seedVariety(db, "In-stock Oak");
    const soldOut = await seedVariety(db, "Sold-out Cos");
    const roundId = await seedRound(db);
    await seedRoundStock(db, roundId, okVariety, 100);
    await seedRoundStock(db, roundId, soldOut, 0); // availableUnits 0 → excluded → substitution
    await seedPrice(db, roundId, okVariety, "b2c", 20000);
    await seedPrice(db, roundId, soldOut, "b2c", 20000);

    const memberSub = await seedSubscription(await seedCustomer("U-member-3"), {
      packageValueSatang: 50000,
    });
    const guestSub = await seedSubscription(await seedCustomer(null), {
      packageValueSatang: 50000,
    });

    const notified: SubstitutionNotice[] = [];
    const result = await generateForRound(db, roundId, { notify: (n) => void notified.push(n) });

    // Both subs get a box (filled from the in-stock variety), both flagged substitution.
    expect(result.generated).toHaveLength(2);
    expect(result.generated.every((g) => g.substitution)).toBe(true);
    expect(await orderCountFor(memberSub)).toBe(1);
    expect(await orderCountFor(guestSub)).toBe(1);
    // Only the MEMBER (line_user_id present) is notified; the guest is skipped (D-23).
    expect(notified).toHaveLength(1);
    expect(notified[0]?.lineUserId).toBe("U-member-3");
    // The box was filled entirely from the in-stock variety.
    expect(await reservedPlants(roundId, okVariety)).toBeGreaterThan(0);
    expect(await reservedPlants(roundId, soldOut)).toBe(0);
  });
});
