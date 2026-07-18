// CROP-07 demand-driven planting recommendation (04-07). Two layers:
//   1. plantsToMeetDemand — PURE inverse of forecast.ts forecastPlants (no DB), so
//      it unit-tests trivially and round-trips the survival haircut.
//   2. computeDemandRecommendation — parameterized trailing-demand aggregate over
//      the last N rounds of realised sales PLUS back-in-stock (unmet) demand, run
//      against real PostgreSQL 17 (:55432) via the drizzle DI, matching crop.test.ts.
//
// The aggregate proves: realised sales feed demand, back-in-stock requests ADD to it
// (so a stockout never undercounts), and the recommended plant count is the survival
// inverse of that demand (plantsToMeetDemand). A no-data flag fires below the N-round
// history threshold — that drives the UI "ข้อมูลดีมานด์ยังไม่พอ" state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  backInStockRequests,
  customers,
  orderLines,
  orders,
  varieties,
} from "../src/db/schema";
import { forecastPlants } from "../src/services/forecast";
import {
  DEFAULT_PLANTS_PER_REQUEST,
  computeDemandRecommendation,
  plantsToMeetDemand,
} from "../src/services/crop-recommend";
import { seedRound, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  await client.file("drizzle/0002_prices_default_uniq.down.sql").catch(() => {});
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
  await client.file("drizzle/0002_prices_default_uniq.sql");
});

afterAll(async () => {
  await client?.end();
});

/** Set a variety's survival % (default seed is 90). */
async function setSurvival(varietyId: string, survivalPct: number): Promise<void> {
  await db.update(varieties).set({ survivalPct }).where(eq(varieties.id, varietyId));
}

/** Insert a customer, return id. */
async function seedCustomer(): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: false })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

/** Insert a realised (status) order with one variety line decrementing `plants`. */
async function seedSoldOrder(
  roundId: string,
  varietyId: string,
  plants: number,
  status = "paid",
): Promise<void> {
  const customerId = await seedCustomer();
  const [order] = await db
    .insert(orders)
    .values({
      customerId,
      roundId,
      status: status as "paid",
      tier: "b2c",
      subtotalSatang: 10000,
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("seedSoldOrder: no order row");
  await db.insert(orderLines).values({
    orderId: order.id,
    lineKind: "variety",
    varietyId,
    tier: "b2c",
    qty: 1,
    plantsDecremented: plants,
  });
}

/** Insert a back-in-stock (unmet demand) request for a variety in a round. */
async function seedBackInStock(roundId: string, varietyId: string): Promise<void> {
  await db.insert(backInStockRequests).values({ roundId, varietyId });
}

describe("plantsToMeetDemand — PURE inverse of forecastPlants (survival haircut)", () => {
  test("plantsToMeetDemand(180, 90) = 200 (inverse of forecastPlants(200,90)=180)", () => {
    expect(plantsToMeetDemand(180, 90)).toBe(200);
    expect(forecastPlants(200, 90)).toBe(180);
  });

  test("100% survival needs exactly the demand", () => {
    expect(plantsToMeetDemand(200, 100)).toBe(200);
  });

  test("rounds UP so we never plant too few (ceil, not floor)", () => {
    // 100 demand at 90% → 111.11 → 112 plants (never 111, which would undersupply).
    expect(plantsToMeetDemand(100, 90)).toBe(112);
  });

  test("zero demand needs zero plants", () => {
    expect(plantsToMeetDemand(0, 90)).toBe(0);
  });
});

describe("computeDemandRecommendation — trailing sales + unmet demand, survival inverse", () => {
  test("realised sales alone round-trip the forecast haircut", async () => {
    const varietyId = await seedVariety(db, `Rec-A ${crypto.randomUUID()}`);
    await setSurvival(varietyId, 90);
    const roundId = await seedRound(db, `Rec-Round ${crypto.randomUUID()}`);
    await seedSoldOrder(roundId, varietyId, 180); // 180 plants realised

    const rec = await computeDemandRecommendation(db, { nRounds: 1 });
    const item = rec.items.find((i) => i.varietyId === varietyId);
    expect(rec.noData).toBe(false);
    expect(item).toBeDefined();
    expect(item?.demandPlants).toBe(180); // sales only, no requests
    // ceil(180 * 100 / 90) = 200 = inverse of forecastPlants(200,90)=180.
    expect(item?.recommendedPlants).toBe(200);
  });

  test("back-in-stock requests ADD to demand so a stockout never undercounts", async () => {
    const varietyId = await seedVariety(db, `Rec-B ${crypto.randomUUID()}`);
    await setSurvival(varietyId, 90);
    const roundId = await seedRound(db, `Rec-Round ${crypto.randomUUID()}`);
    await seedSoldOrder(roundId, varietyId, 180);
    await seedBackInStock(roundId, varietyId); // one unmet request

    const rec = await computeDemandRecommendation(db, { nRounds: 1 });
    const item = rec.items.find((i) => i.varietyId === varietyId);
    // demand = 180 sales + 1 request × DEFAULT_PLANTS_PER_REQUEST.
    const expectedDemand = 180 + DEFAULT_PLANTS_PER_REQUEST;
    expect(item?.demandPlants).toBe(expectedDemand);
    expect(item?.recommendedPlants).toBe(plantsToMeetDemand(expectedDemand, 90));
    // Strictly greater than sales-only → the unmet demand is really counted.
    expect(item?.recommendedPlants).toBeGreaterThan(200);
  });

  test("cancelled orders are NOT counted as realised demand", async () => {
    const varietyId = await seedVariety(db, `Rec-C ${crypto.randomUUID()}`);
    await setSurvival(varietyId, 90);
    const roundId = await seedRound(db, `Rec-Round ${crypto.randomUUID()}`);
    await seedSoldOrder(roundId, varietyId, 500, "cancelled");

    const rec = await computeDemandRecommendation(db, { nRounds: 1 });
    const item = rec.items.find((i) => i.varietyId === varietyId);
    // No realised sales / requests for this variety → absent from the recommendation.
    expect(item).toBeUndefined();
  });

  test("below the N-round history threshold → no-data flag", async () => {
    const rec = await computeDemandRecommendation(db, { nRounds: 9999 });
    expect(rec.noData).toBe(true);
  });
});
