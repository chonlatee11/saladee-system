// CR-02 (phase-02 code review) — money-safety regression lock.
//
// Every stock-reserving order now carries a holdExpiresAt, INCLUDING the legacy
// public `created` path (POST /orders with no delivery choice), and the safety-net
// sweep (sweepExpiredHolds) reclaims BOTH `created` and `awaiting_payment` holds
// past their deadline. Before CR-02 a `created` order reserved stock with NO
// deadline and was never swept — a leaked/guessed catalog UUID could reserve a
// round's whole quota forever (stock-exhaustion weaponising oversell-prevention,
// NFR-02). These tests are invariant-hardening ONLY; production code is already
// fixed. Raced against real PostgreSQL 17 (:55432), mirroring hold-expiry.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { orders } from "../src/db/schema";
import { sweepExpiredHolds } from "../src/jobs/boss";
import { makeOrdersRoutes } from "../src/routes/orders";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

async function statusOf(orderId: string): Promise<string | undefined> {
  const [row] = (await db.execute(
    sql`SELECT status FROM orders WHERE id = ${orderId}`,
  )) as unknown as { status: string }[];
  return row?.status;
}

async function holdExpiresAtOf(orderId: string): Promise<Date | null> {
  // Typed drizzle select so hold_expires_at is mapped to a real Date (a raw
  // db.execute would hand back the driver's timestamp string).
  const [row] = await db
    .select({ holdExpiresAt: orders.holdExpiresAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row?.holdExpiresAt ?? null;
}

/** Place a real order via the OPEN endpoint WITHOUT a delivery choice → status=created. */
async function placeCreatedOrder() {
  const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
  const res = await routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "b2c",
        customer: {
          name: "ลูกค้า",
          phone: "0800000000",
          recipientName: "ผู้รับ",
          recipientPhone: "0800000000",
          recipientAddress: "1 ถนนสลัด",
        },
        lines: [
          { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
        ],
        // NB: NO deliveryMethod / deliveryZone → the Phase-1 `created` path (not a checkout).
      }),
    }),
  );
  expect(res.status).toBe(201);
  const { id, status } = (await res.json()) as { id: string; status: string };
  expect(status).toBe("created");
  return { orderId: id, roundId: seed.roundId, varietyId: seed.varietyId };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("created-order hold + sweep (CR-02)", () => {
  test("a `created` order (no delivery choice) still carries a non-null holdExpiresAt", async () => {
    const { orderId } = await placeCreatedOrder();
    // Before CR-02 this path left hold_expires_at NULL → the stock was held forever.
    const deadline = await holdExpiresAtOf(orderId);
    expect(deadline).not.toBeNull();
    // And it is a FUTURE deadline (a fresh hold, not an already-expired one).
    expect((deadline as Date).getTime()).toBeGreaterThan(Date.now());
  });

  test("sweepExpiredHolds cancels a past-deadline `created` order and RELEASES its stock", async () => {
    const { orderId, roundId, varietyId } = await placeCreatedOrder();
    // Stock was reserved atomically at creation (plantsPerUnit 2 × qty 1).
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    // Drive the deadline into the past while the order is STILL `created` (never a
    // checkout) — exactly the leaked-UUID stock-hold the sweep must now reclaim.
    await db.execute(
      sql`UPDATE orders SET hold_expires_at = now() - interval '1 minute' WHERE id = ${orderId}`,
    );
    expect(await statusOf(orderId)).toBe("created");

    const cancelled = await sweepExpiredHolds(db);

    expect(cancelled).toBeGreaterThanOrEqual(1);
    expect(await statusOf(orderId)).toBe("cancelled");
    expect(await reservedPlants(roundId, varietyId)).toBe(0); // reserved stock returned to quota
  });
});
