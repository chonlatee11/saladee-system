// CR-01 / NFR-02 — POST /orders must reject an order whose lines span more than
// one round. The order row persists a SINGLE round_id and the cancel path releases
// every line against it, so a multi-round order would strand reserved stock in the
// other round(s) on cancel. The create handler enforces the documented
// "single-round-per-order" invariant (01-02-SUMMARY): a multi-round request is
// rejected 400 multi_round_order_unsupported BEFORE any reservation happens — no
// stock is touched in either round. Raced against the REAL PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
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

const guest = {
  name: "ลูกค้า",
  phone: "0800000000",
  recipientName: "ผู้รับ",
  recipientPhone: "0800000000",
  recipientAddress: "1 ถนนสลัด",
};

function placeOrder(body: unknown): Promise<Response> {
  return routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
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

describe("POST /orders — single-round-per-order invariant (CR-01/NFR-02)", () => {
  test("variety lines spanning two rounds → 400 multi_round_order_unsupported, no stock reserved", async () => {
    const a = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
    const b = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });

    const res = await placeOrder({
      tier: "b2c",
      customer: guest,
      lines: [
        { roundId: a.roundId, varietyId: a.varietyId, saleUnitId: a.saleUnitId, qty: 1 },
        { roundId: b.roundId, varietyId: b.varietyId, saleUnitId: b.saleUnitId, qty: 1 },
      ],
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "multi_round_order_unsupported",
    });

    // Nothing reserved in EITHER round — rejection is before any reservation.
    expect(await reservedPlants(a.roundId, a.varietyId)).toBe(0);
    expect(await reservedPlants(b.roundId, b.varietyId)).toBe(0);
  });

  test("a single-round order still succeeds (guard does not reject the happy path)", async () => {
    const a = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
    const res = await placeOrder({
      tier: "b2c",
      customer: guest,
      lines: [{ roundId: a.roundId, varietyId: a.varietyId, saleUnitId: a.saleUnitId, qty: 1 }],
    });
    expect(res.status).toBe(201);
    expect(await reservedPlants(a.roundId, a.varietyId)).toBe(2);
  });
});
