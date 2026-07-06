// ORD-02 / PAY-04 / D-16 — POST /orders freezes a SERVER-resolved price/pack
// snapshot onto order_lines at creation time. Raced against the REAL PostgreSQL
// 17 test container (docker-compose.pg.yml :55432), NOT a mock. Two guarantees:
//   1. Snapshot immutability — mutating the live prices row AFTER an order does
//      not change the stored order_lines.unit_price_satang (the order rebuilds
//      from its own snapshot columns, no join to live price tables).
//   2. Client price is ignored — a bogus client-supplied unit price never lands;
//      the stored price equals deriveUnitPriceSatang(server price, pack grams).
//
// The route is exercised via the makeOrdersRoutes(db) factory with an injected
// test pool (mirrors makeHealthRoutes(db) DI in routes/health.ts) so the endpoint
// hits the same DB this test seeds/inspects, independent of runtime env wiring.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { deriveUnitPriceSatang } from "../src/services/pricing";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

function postOrder(body: unknown): Promise<Response> {
  return routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function lineRow(orderId: string): Promise<Record<string, unknown>> {
  const rows = await db.execute(sql`SELECT * FROM order_lines WHERE order_id = ${orderId}`);
  return rows[0] as Record<string, unknown>;
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

describe("POST /orders — server-resolved frozen snapshot (D-16)", () => {
  test("happy path: 201 + full snapshot columns on order_lines", async () => {
    const seed = await seedSellableLine(db, {
      quotaPlants: 100,
      plantsPerUnit: 2,
      gramsPerUnit: 250,
      pricePerKgSatang: 20000, // 200 baht/kg → 250g pack = 50 baht = 5000 satang
    });
    const res = await postOrder({
      tier: "b2c",
      customer: {
        name: "ลูกค้า A",
        phone: "0810000000",
        recipientName: "ผู้รับ A",
        recipientPhone: "0810000000",
        recipientAddress: "123 ถนนสลัด กรุงเทพ",
      },
      lines: [
        { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; subtotalSatang: number; status: string };
    expect(created.status).toBe("created");
    expect(created.subtotalSatang).toBe(5000);

    const line = await lineRow(created.id);
    expect(Number(line.unit_price_satang)).toBe(deriveUnitPriceSatang(20000, 250)); // 5000
    expect(line.variety_name).toBe(seed.variety.name);
    expect(line.unit_label).toBe("250g");
    expect(Number(line.plants_per_unit)).toBe(2);
    expect(Number(line.price_per_kg_satang)).toBe(20000);
    expect(line.tier).toBe("b2c");
    expect(Number(line.qty)).toBe(1);
    expect(Number(line.plants_decremented)).toBe(2);
  });

  test("snapshot immutability: mutating the live price does not change the order", async () => {
    const seed = await seedSellableLine(db, { pricePerKgSatang: 20000, gramsPerUnit: 250 });
    const res = await postOrder({
      tier: "b2c",
      customer: {
        name: "ลูกค้า B",
        phone: "0820000000",
        recipientName: "ผู้รับ B",
        recipientPhone: "0820000000",
        recipientAddress: "456 ถนนผัก",
      },
      lines: [
        { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const before = Number((await lineRow(created.id)).unit_price_satang);
    expect(before).toBe(5000);

    // Mutate the LIVE price to a wildly different value.
    await db.execute(sql`UPDATE prices SET price_per_kg_satang = 99999 WHERE id = ${seed.priceId}`);

    // The order rebuilds from its own snapshot columns — unchanged.
    const after = Number((await lineRow(created.id)).unit_price_satang);
    expect(after).toBe(before);
    const ordRows = (await db.execute(
      sql`SELECT subtotal_satang FROM orders WHERE id = ${created.id}`,
    )) as unknown as { subtotal_satang: number }[];
    expect(Number(ordRows[0]?.subtotal_satang)).toBe(after); // subtotal reconstructable from snapshot alone
  });

  test("client-supplied price is ignored — server derives the stored price", async () => {
    const seed = await seedSellableLine(db, { pricePerKgSatang: 20000, gramsPerUnit: 250 });
    const res = await postOrder({
      tier: "b2c",
      customer: {
        name: "ลูกค้า C",
        phone: "0830000000",
        recipientName: "ผู้รับ C",
        recipientPhone: "0830000000",
        recipientAddress: "789 ถนนเขียว",
      },
      // Attacker-supplied prices at both the top level and the line — must be ignored.
      unitPriceSatang: 1,
      subtotalSatang: 1,
      lines: [
        {
          roundId: seed.roundId,
          varietyId: seed.varietyId,
          saleUnitId: seed.saleUnitId,
          qty: 1,
          unitPriceSatang: 1,
          pricePerKgSatang: 1,
        },
      ],
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; subtotalSatang: number };
    expect(created.subtotalSatang).toBe(5000); // NOT the client's 1
    const line = await lineRow(created.id);
    expect(Number(line.unit_price_satang)).toBe(5000); // server-derived, not client's 1
  });
});

describe("WR-03: POST /orders honours the variety / sale-unit soft-delete flag", () => {
  const customer = {
    name: "ลูกค้า",
    phone: "0800000000",
    recipientName: "ผู้รับ",
    recipientPhone: "0800000000",
    recipientAddress: "1 ถนนสลัด",
  };

  test("soft-deleted VARIETY cannot be ordered even with a known UUID + live quota/price", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 100 });
    // Staff retires the variety (soft-delete) — quota + price rows still exist.
    await db.execute(sql`UPDATE varieties SET active = false WHERE id = ${seed.varietyId}`);
    const res = await postOrder({
      tier: "b2c",
      customer,
      lines: [
        { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "variety_not_found" });
    // No reservation happened on the retired variety.
    const stock = (await db.execute(
      sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${seed.roundId} AND variety_id = ${seed.varietyId}`,
    )) as unknown as { reserved_plants: number }[];
    expect(Number(stock[0]?.reserved_plants)).toBe(0);
  });

  test("soft-deleted SALE UNIT (retired pack) cannot be ordered", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 100 });
    await db.execute(sql`UPDATE sale_units SET active = false WHERE id = ${seed.saleUnitId}`);
    const res = await postOrder({
      tier: "b2c",
      customer,
      lines: [
        { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_line" });
  });

  test("WR-02: oversized qty is rejected at validation (422), not an int4-overflow 500", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 100 });
    const res = await postOrder({
      tier: "b2c",
      customer,
      lines: [
        {
          roundId: seed.roundId,
          varietyId: seed.varietyId,
          saleUnitId: seed.saleUnitId,
          qty: 100001, // over the 100000 maximum → TypeBox 422 before any DB write
        },
      ],
    });
    expect(res.status).toBe(422);
  });
});
