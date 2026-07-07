// INV-07 / D-17 / T-01-18 — the mixed-salad box reservation core, proven against
// REAL PostgreSQL 17 (docker-compose.pg.yml :55432). A box is orderable only up to
// its SCARCEST component (availability = min across components), and reserving a box
// is ALL-OR-NOTHING: every component decrements in one transaction, or — on any
// shortfall — NOTHING decrements (the tx rolls back to zero net change). This is the
// multi-row analog of the single-row race in reservation.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { BoxShortfallError, boxAvailability, reserveBox } from "../src/services/reservation";
import { seedBoxScenario } from "./seed";

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

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
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

describe("boxAvailability — scarcest component governs (INV-07)", () => {
  test("availability = min(floor((quota−reserved)/plantsPerBox)) across components", () => {
    // A: quota 4, 2 plants/box → 2 boxes.  B: quota 1, 1 plant/box → 1 box.
    const stock = new Map([
      ["a", { quotaPlants: 4, reservedPlants: 0 }],
      ["b", { quotaPlants: 1, reservedPlants: 0 }],
    ]);
    const components = [
      { varietyId: "a", plantsPerBox: 2 },
      { varietyId: "b", plantsPerBox: 1 },
    ];
    expect(boxAvailability(components, stock)).toBe(1); // min(2, 1)
  });

  test("a component with no stock row makes the box unavailable (0)", () => {
    const stock = new Map([["a", { quotaPlants: 10, reservedPlants: 0 }]]);
    const components = [
      { varietyId: "a", plantsPerBox: 1 },
      { varietyId: "missing", plantsPerBox: 1 },
    ];
    expect(boxAvailability(components, stock)).toBe(0);
  });
});

describe("reserveBox — all-or-nothing multi-component decrement (INV-07 / T-01-18)", () => {
  test("an over-quota box rolls back with ZERO net decrement on EVERY component", async () => {
    // Scarce component B caps the box at 1; ordering 2 boxes must fail entirely.
    const { roundId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 }, // A → 2 boxes
        { quotaPlants: 1, plantsPerBox: 1 }, // B → 1 box (the scarce one)
      ],
    });
    const [a, b] = components;
    if (!a || !b) throw new Error("seed produced too few components");

    await expect(
      db.transaction((tx) =>
        reserveBox(
          tx,
          roundId,
          components.map((c) => ({ varietyId: c.varietyId, plantsPerBox: c.plantsPerBox })),
          2, // over the scarce component's limit of 1
        ),
      ),
    ).rejects.toBeInstanceOf(BoxShortfallError);

    // Partial-failure decrements NOTHING: both components untouched (all-or-nothing).
    expect(await reservedPlants(roundId, a.varietyId)).toBe(0);
    expect(await reservedPlants(roundId, b.varietyId)).toBe(0);
  });

  test("an at-limit box succeeds and decrements EVERY component", async () => {
    const { roundId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 },
        { quotaPlants: 1, plantsPerBox: 1 },
      ],
    });
    const [a, b] = components;
    if (!a || !b) throw new Error("seed produced too few components");

    await db.transaction((tx) =>
      reserveBox(
        tx,
        roundId,
        components.map((c) => ({ varietyId: c.varietyId, plantsPerBox: c.plantsPerBox })),
        1,
      ),
    );

    expect(await reservedPlants(roundId, a.varietyId)).toBe(2); // 2 plants/box × 1
    expect(await reservedPlants(roundId, b.varietyId)).toBe(1); // 1 plant/box × 1

    // Now the scarce component is exhausted → a further box must fail, no decrement.
    await expect(
      db.transaction((tx) =>
        reserveBox(
          tx,
          roundId,
          components.map((c) => ({ varietyId: c.varietyId, plantsPerBox: c.plantsPerBox })),
          1,
        ),
      ),
    ).rejects.toBeInstanceOf(BoxShortfallError);
    expect(await reservedPlants(roundId, a.varietyId)).toBe(2); // unchanged
    expect(await reservedPlants(roundId, b.varietyId)).toBe(1); // unchanged
  });
});
