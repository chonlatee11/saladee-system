// Criterion 1 end-to-end (01-03): a shop admin sets up the whole catalog through
// the HTTP endpoints — create a variety with a 250g pack, open a round, set the
// per-variety sellable quota, and set BOTH B2C and B2B per-kg prices — then reads
// it all back and confirms the round-trip: the pack persists, the quota persists,
// both tiers exist, and the auto-derived pack price is whole baht. Every write
// uses an admin Bearer and returns 2xx. Raced against real PostgreSQL 17 (:55432)
// via the make*Routes(db) DI factories (one injected pool shared by all routers).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makePricesRoutes } from "../src/routes/prices";
import { makeRoundsRoutes } from "../src/routes/rounds";
import { makeVarietiesRoutes } from "../src/routes/varieties";
import { deriveUnitPriceSatang } from "../src/services/pricing";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const GRAMS = 250;
const QUOTA = 80;
const KG_B2C = 20000; // 200 baht/kg
const KG_B2B = 15000; // 150 baht/kg

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let varietyRoutes: ReturnType<typeof makeVarietiesRoutes>;
let roundRoutes: ReturnType<typeof makeRoundsRoutes>;
let priceRoutes: ReturnType<typeof makePricesRoutes>;
let admin: string;

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
  varietyRoutes = makeVarietiesRoutes(db);
  roundRoutes = makeRoundsRoutes(db);
  priceRoutes = makePricesRoutes(db);
  await client.file("drizzle/0002_prices_default_uniq.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0002_prices_default_uniq.sql");
  admin = await issueSession(crypto.randomUUID(), "admin");
});

afterAll(async () => {
  await client?.end();
});

describe("admin catalog setup round-trips end-to-end (criterion 1)", () => {
  test("create variety+pack → round → quota → B2C+B2B prices → read back matches", async () => {
    // 1. Create the variety with a 250g pack (INV-01/INV-03).
    const vName = `กรีนโอ๊ค ${crypto.randomUUID()}`;
    const vRes = await fire(varietyRoutes, "POST", "/varieties", {
      token: admin,
      body: {
        name: vName,
        category: "ผักสลัด",
        avgGramsPerPlant: 120,
        saleUnits: [{ kind: "pack", label: "แพ็ค 250g", gramsPerUnit: GRAMS, plantsPerUnit: 2 }],
      },
    });
    expect(vRes.status).toBe(201);
    const variety = (await vRes.json()) as {
      id: string;
      name: string;
      avgGramsPerPlant: number;
      saleUnits: { id: string; gramsPerUnit: number; label: string }[];
    };
    expect(variety.name).toBe(vName);
    expect(variety.saleUnits).toHaveLength(1);
    const varietyId = variety.id;
    const saleUnitId = variety.saleUnits[0]?.id as string;
    expect(variety.saleUnits[0]?.gramsPerUnit).toBe(GRAMS);

    // 2. Open a round (INV-05 / D-09).
    const rRes = await fire(roundRoutes, "POST", "/rounds", {
      token: admin,
      body: { name: `รอบ ${crypto.randomUUID()}` },
    });
    expect(rRes.status).toBe(201);
    const round = (await rRes.json()) as { id: string; status: string };
    expect(round.status).toBe("open");
    const roundId = round.id;

    // 3. Set the per-variety sellable quota.
    const sRes = await fire(roundRoutes, "POST", `/rounds/${roundId}/stock`, {
      token: admin,
      body: { varietyId, quotaPlants: QUOTA },
    });
    expect(sRes.status).toBe(200);
    expect((await sRes.json()) as { quotaPlants: number }).toMatchObject({ quotaPlants: QUOTA });

    // 4. Set BOTH tier prices (D-15).
    for (const [tier, kg] of [
      ["b2c", KG_B2C],
      ["b2b", KG_B2B],
    ] as const) {
      const pRes = await fire(priceRoutes, "POST", "/prices", {
        token: admin,
        body: { roundId, varietyId, tier, pricePerKgSatang: kg },
      });
      expect(pRes.status).toBe(201);
    }

    // 5a. Read the variety back — pack persisted with the input grams.
    const vGet = await fire(varietyRoutes, "GET", `/varieties/${varietyId}`);
    expect(vGet.status).toBe(200);
    const vBack = (await vGet.json()) as {
      name: string;
      saleUnits: { id: string; gramsPerUnit: number; label: string }[];
    };
    expect(vBack.name).toBe(vName);
    expect(vBack.saleUnits).toHaveLength(1);
    expect(vBack.saleUnits[0]?.gramsPerUnit).toBe(GRAMS);

    // 5b. Read the round back — quota persisted.
    const rGet = await fire(roundRoutes, "GET", `/rounds/${roundId}`);
    expect(rGet.status).toBe(200);
    const rBack = (await rGet.json()) as { stock: { varietyId: string; quotaPlants: number }[] };
    const stockRow = rBack.stock.find((s) => s.varietyId === varietyId);
    expect(stockRow?.quotaPlants).toBe(QUOTA);

    // 5c. Both tiers exist + the derived pack price is whole baht (INV-04/D-13).
    for (const [tier, kg] of [
      ["b2c", KG_B2C],
      ["b2b", KG_B2B],
    ] as const) {
      const resolve = await fire(
        priceRoutes,
        "GET",
        `/prices/resolve?roundId=${roundId}&varietyId=${varietyId}&tier=${tier}`,
      );
      expect(resolve.status).toBe(200);
      const body = (await resolve.json()) as {
        pricePerKgSatang: number;
        packs: { saleUnitId: string; unitPriceSatang: number }[];
      };
      expect(body.pricePerKgSatang).toBe(kg);
      const pack = body.packs.find((p) => p.saleUnitId === saleUnitId);
      expect(pack?.unitPriceSatang).toBe(deriveUnitPriceSatang(kg, GRAMS));
      expect((pack?.unitPriceSatang ?? 1) % 100).toBe(0);
    }

    // 5d. History carries both tier rows for this (round, variety).
    const hist = await fire(
      priceRoutes,
      "GET",
      `/prices?roundId=${roundId}&varietyId=${varietyId}`,
    );
    const rows = (await hist.json()) as { tier: string }[];
    expect(rows.map((r) => r.tier).sort()).toEqual(["b2b", "b2c"]);
  });
});
