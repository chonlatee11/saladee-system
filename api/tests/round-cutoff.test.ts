// INV-09 / D-10 / Pitfall 6 — POST /orders is rejected for a CLOSED round or a
// round whose cut-off has passed, and NO stock is reserved in either case. The
// cut-off is re-checked INSIDE the reservation transaction (Pitfall 6), so a
// round that closes between request validation and reservation still rejects.
// Raced against the real PostgreSQL 17 container (docker-compose.pg.yml :55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { rounds } from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { seedPrice, seedRoundStock, seedSaleUnit, seedVariety } from "./seed";

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

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

/** Arrange a sellable line on a round with an explicit status + cut-off. */
async function seedLineOnRound(status: "open" | "closed", cutoffAt: Date | null) {
  const varietyId = await seedVariety(db, `Variety ${crypto.randomUUID()}`);
  const [rnd] = await db
    .insert(rounds)
    .values({ name: `Round ${crypto.randomUUID()}`, status, cutoffAt })
    .returning({ id: rounds.id });
  if (!rnd) throw new Error("seedLineOnRound: round insert returned no row");
  const roundId = rnd.id;
  const saleUnitId = await seedSaleUnit(db, varietyId, { plantsPerUnit: 2, gramsPerUnit: 250 });
  await seedRoundStock(db, roundId, varietyId, 100);
  await seedPrice(db, roundId, varietyId, "b2c", 20000, null);
  return { varietyId, roundId, saleUnitId };
}

function orderBody(seed: { roundId: string; varietyId: string; saleUnitId: string }) {
  return {
    tier: "b2c" as const,
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
  };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /orders — round cut-off enforcement (INV-09 / D-10)", () => {
  test("closed round → 409 round_closed, nothing reserved", async () => {
    const seed = await seedLineOnRound("closed", new Date(Date.now() + 86_400_000));
    const res = await postOrder(orderBody(seed));
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "round_closed" });
    expect(await reservedPlants(seed.roundId, seed.varietyId)).toBe(0);
  });

  test("past-cutoff open round → 409 round_closed, nothing reserved", async () => {
    const seed = await seedLineOnRound("open", new Date(Date.now() - 60_000)); // 1 min ago
    const res = await postOrder(orderBody(seed));
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "round_closed" });
    expect(await reservedPlants(seed.roundId, seed.varietyId)).toBe(0);
  });

  test("open, future-cutoff round → 201 (control: the same body succeeds)", async () => {
    const seed = await seedLineOnRound("open", new Date(Date.now() + 86_400_000));
    const res = await postOrder(orderBody(seed));
    expect(res.status).toBe(201);
    expect(await reservedPlants(seed.roundId, seed.varietyId)).toBe(2);
  });
});
