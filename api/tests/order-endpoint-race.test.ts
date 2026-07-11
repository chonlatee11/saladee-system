// PLAT-01 / SALE-01 / criterion 2 — the phase's DEFINING measurement, now at the
// HTTP boundary. N guests race POST /orders for the LAST pack against the REAL
// PostgreSQL 17 container (docker-compose.pg.yml :55432). The oversell rate MUST
// be exactly 0: exactly one 201, N-1 409 (sold out), and reserved_plants never
// exceeds quota_plants. This proves the guarantee end-to-end, not just at the
// reservation service (that lower-level race lives in reservation.test.ts).
//
// CRITICAL (Pitfall 2): the test pool max MUST be >= N, or the N concurrent
// db.transaction()s serialize on one connection and the race proves nothing.
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

const N = 8; // concurrent racers for the last pack

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

beforeAll(async () => {
  // max >= N so the racers get distinct connections (Pitfall 2).
  client = postgres(TEST_URL, { prepare: false, max: N + 2 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /orders — end-to-end no-oversell race (criterion 2 / PLAT-01)", () => {
  test(`N=${N} concurrent orders for the last pack → exactly one 201, ${N - 1} × 409`, async () => {
    // quota == one pack (plantsPerUnit) so only ONE order of qty=1 can ever win.
    const seed = await seedSellableLine(db, {
      quotaPlants: 2,
      plantsPerUnit: 2,
      gramsPerUnit: 250,
      pricePerKgSatang: 20000,
    });
    const body = JSON.stringify({
      tier: "b2c",
      customer: {
        name: "ผู้แข่ง",
        phone: "0800000000",
        recipientName: "ผู้รับ",
        recipientPhone: "0800000000",
        recipientAddress: "1 ถนนสลัด",
      },
      lines: [
        { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
      ],
    });

    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        routes.handle(
          new Request("http://localhost/orders", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        ),
      ),
    );

    const statuses = await Promise.all(
      results.map((r) => (r.status === "fulfilled" ? r.value.status : 500)),
    );
    const wins = statuses.filter((s) => s === 201).length;
    const soldOut = statuses.filter((s) => s === 409).length;

    expect(wins).toBe(1); // exactly one winner on the last pack
    expect(soldOut).toBe(N - 1); // everyone else is sold out
    // The invariant that matters: reserved never exceeds quota (oversell rate = 0).
    expect(await reservedPlants(seed.roundId, seed.varietyId)).toBe(2);
  });
});
