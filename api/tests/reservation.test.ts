// PLAT-01 / INV-06 — the phase's defining proof: the guarded atomic decrement
// never oversells under real concurrency. Raced against the REAL PostgreSQL 17
// (tests/docker-compose.pg.yml :55432), NOT a mock — the guarantee lives in PG's
// MVCC row-locking (RESEARCH Pitfall 1). The test pool sets `max >= N` so N
// reserve() calls truly run in parallel across N connections (Pitfall 2);
// with a single shared connection they would serialize and prove nothing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { release, reserve } from "../src/services/reservation";
import { seedStockRow } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const N = 8; // number of concurrent racers for the last pack

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

beforeAll(async () => {
  // Pool max MUST exceed N so the racers get distinct connections (Pitfall 2).
  client = postgres(TEST_URL, { prepare: false, max: N + 2 });
  db = drizzle(client, { schema });
  // Clean slate, then apply both migrations so the commerce tables exist
  // regardless of which integration test file ran first.
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

describe("reserve() — guarded atomic decrement (PLAT-01 / INV-06)", () => {
  test("last pack: first reserve wins, next is sold out (0 rows)", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 1);
    expect(await reserve(db, roundId, varietyId, 1)).toBe(true);
    expect(await reservedPlants(roundId, varietyId)).toBe(1);
    // Sold out — the guard quota - reserved >= 1 no longer holds.
    expect(await reserve(db, roundId, varietyId, 1)).toBe(false);
    expect(await reservedPlants(roundId, varietyId)).toBe(1);
  });

  test(`N=${N} concurrent reserves for the last pack → exactly 1 success, no oversell`, async () => {
    const { roundId, varietyId } = await seedStockRow(db, 1);
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => reserve(db, roundId, varietyId, 1)),
    );
    const wins = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
    const losses = results.filter((r) => r.status === "fulfilled" && r.value === false).length;
    expect(wins).toBe(1); // exactly one winner on the last pack
    expect(losses).toBe(N - 1);
    // The invariant that matters: reserved never exceeds quota.
    expect(await reservedPlants(roundId, varietyId)).toBe(1);
  });

  test("reserve rejects when requested plants exceed remaining availability", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 3);
    expect(await reserve(db, roundId, varietyId, 4)).toBe(false); // 4 > quota 3
    expect(await reservedPlants(roundId, varietyId)).toBe(0);
    expect(await reserve(db, roundId, varietyId, 3)).toBe(true); // exact fit
    expect(await reservedPlants(roundId, varietyId)).toBe(3);
  });
});

describe("release() — guarded idempotent restore (D-08 / Pitfall 5)", () => {
  test("release returns reserved stock once; double-release is a no-op", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 5);
    expect(await reserve(db, roundId, varietyId, 1)).toBe(true);
    expect(await reservedPlants(roundId, varietyId)).toBe(1);

    expect(await release(db, roundId, varietyId, 1)).toBe(true);
    expect(await reservedPlants(roundId, varietyId)).toBe(0);

    // Guard reserved_plants >= n blocks a second release → cannot inflate stock.
    expect(await release(db, roundId, varietyId, 1)).toBe(false);
    expect(await reservedPlants(roundId, varietyId)).toBe(0);
  });
});
