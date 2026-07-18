// CROP-05 / INV-10 (D-04/D-05) — actual-harvest logging: 1 batch = 1 lot, lotCode +
// best-before auto-computed (harvestDate + shelfLifeDays via the pure forecast kernel),
// and the actual-vs-forecast delta surfaced (NOT auto-tuned). The UNIQUE(batch_id)
// makes a batch loggable exactly once. Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { plantingBatches, varieties } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeHarvestRoutes } from "../src/routes/harvest";
import { logHarvest } from "../src/services/harvest";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedBatch(opts: {
  survivalPct?: number;
  shelfLifeDays?: number;
  plantCount?: number;
  plantDate?: string;
}): Promise<string> {
  const [v] = await db
    .insert(varieties)
    .values({
      name: `Variety ${crypto.randomUUID()}`,
      avgGramsPerPlant: 120,
      survivalPct: opts.survivalPct ?? 90,
      shelfLifeDays: opts.shelfLifeDays ?? 7,
    })
    .returning({ id: varieties.id });
  if (!v) throw new Error("seedBatch: no variety");
  const [b] = await db
    .insert(plantingBatches)
    .values({
      varietyId: v.id,
      plantDate: new Date(opts.plantDate ?? "2026-06-01T00:00:00.000Z"),
      plantCount: opts.plantCount ?? 100,
    })
    .returning({ id: plantingBatches.id });
  if (!b) throw new Error("seedBatch: no batch");
  return b.id;
}

function fire(
  app: { handle: (r: Request) => Promise<Response> },
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

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

describe("logHarvest — 1 batch = 1 lot + auto lot/best-before + delta (D-04/05, INV-10)", () => {
  test("computes best-before = harvestedAt + shelfLifeDays and a negative delta (short harvest)", async () => {
    const batchId = await seedBatch({ survivalPct: 90, shelfLifeDays: 7, plantCount: 100 });
    const harvestedAt = new Date("2026-07-01T00:00:00.000Z");

    const res = await logHarvest(db, batchId, {
      harvestedAt,
      actualPlants: 85,
      actualGrams: 9000,
      wasteGrams: 200,
    });

    expect(res.expectedPlants).toBe(90); // floor(100 × 90%)
    expect(res.delta).toBe(-5); // 85 actual − 90 expected (shown, never auto-tuned)
    expect(res.log.lotCode).toBeTruthy();
    // best-before = 2026-07-01 + 7 days = 2026-07-08.
    expect(new Date(res.log.bestBefore).toISOString().slice(0, 10)).toBe("2026-07-08");
  });

  test("positive delta when actual exceeds forecast", async () => {
    const batchId = await seedBatch({ survivalPct: 90, plantCount: 100 });
    const res = await logHarvest(db, batchId, {
      harvestedAt: new Date("2026-07-01T00:00:00.000Z"),
      actualPlants: 95,
      actualGrams: 10000,
    });
    expect(res.delta).toBe(5); // 95 − 90
  });

  test("a batch can be logged only once (UNIQUE batch = 1 lot)", async () => {
    const batchId = await seedBatch({ plantCount: 100 });
    await logHarvest(db, batchId, {
      harvestedAt: new Date("2026-07-01T00:00:00.000Z"),
      actualPlants: 90,
      actualGrams: 10000,
    });
    // Second confirmation of the same batch is rejected (no duplicate lot).
    expect(
      logHarvest(db, batchId, {
        harvestedAt: new Date("2026-07-02T00:00:00.000Z"),
        actualPlants: 88,
        actualGrams: 9500,
      }),
    ).rejects.toThrow();
  });
});

describe("POST /harvest/logs — grower-gated route (T-03-12)", () => {
  test("admin logs a harvest (201) then a duplicate is 409; customer 403 / no token 401", async () => {
    const routes = makeHarvestRoutes(db, async () => {});
    const batchId = await seedBatch({ plantCount: 100 });
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const customer = await issueSession(crypto.randomUUID(), "customer");

    const body = {
      batchId,
      harvestedAt: "2026-07-01T00:00:00.000Z",
      actualPlants: 90,
      actualGrams: 10000,
      wasteGrams: 0,
    };

    expect((await fire(routes, "POST", "/harvest/logs", { body })).status).toBe(401);
    expect((await fire(routes, "POST", "/harvest/logs", { token: customer, body })).status).toBe(
      403,
    );

    const ok = await fire(routes, "POST", "/harvest/logs", { token: admin, body });
    expect(ok.status).toBe(201);

    const dup = await fire(routes, "POST", "/harvest/logs", { token: admin, body });
    expect(dup.status).toBe(409);
  });

  test("GET /harvest/logs returns the logged history with variety name + delta", async () => {
    const routes = makeHarvestRoutes(db, async () => {});
    const batchId = await seedBatch({ survivalPct: 90, plantCount: 100 });
    const admin = await issueSession(crypto.randomUUID(), "admin");
    await fire(routes, "POST", "/harvest/logs", {
      token: admin,
      body: {
        batchId,
        harvestedAt: "2026-07-01T00:00:00.000Z",
        actualPlants: 85,
        actualGrams: 9000,
        wasteGrams: 100,
      },
    });

    const res = await fire(routes, "GET", "/harvest/logs", { token: admin });
    expect(res.status).toBe(200);
    const logs = (await res.json()) as {
      batchId: string;
      varietyName: string;
      lotCode: string;
      expectedPlants: number;
      delta: number;
    }[];
    const mine = logs.find((l) => l.batchId === batchId);
    expect(mine).toBeDefined();
    expect(typeof mine?.varietyName).toBe("string");
    expect(mine?.expectedPlants).toBe(90);
    expect(mine?.delta).toBe(-5);
    // Guard: no token → 401.
    expect((await fire(routes, "GET", "/harvest/logs")).status).toBe(401);
  });
});
