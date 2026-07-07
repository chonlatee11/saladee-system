// INV-02 / INV-04 / D-12..D-15 / OQ-2 — per-kg per-round per-tier pricing with a
// nullable dated daily override, plus the auto-derived whole-baht pack price and
// retained price history. Raced against the REAL PostgreSQL 17 container (:55432)
// through the make*Routes(db) DI factories. The resolution rule this test pins is
// the one the public catalog (01-04) reuses: a row dated for the given day wins;
// otherwise the effective_date IS NULL round default.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makePricesRoutes } from "../src/routes/prices";
import { deriveUnitPriceSatang } from "../src/services/pricing";
import { seedRound, seedSaleUnit, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const OVERRIDE_DATE = "2026-07-10";
const OTHER_DATE = "2026-07-05";
const GRAMS = 250;
const KG_DEFAULT = 20000; // 200 baht/kg
const KG_OVERRIDE = 30000; // 300 baht/kg on OVERRIDE_DATE

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makePricesRoutes>;
let adminToken: string;

function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return routes.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

interface ResolveResp {
  pricePerKgSatang: number;
  effectiveDate: string | null;
  packs: { saleUnitId: string; gramsPerUnit: number; unitPriceSatang: number }[];
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makePricesRoutes(db);
  await client.file("drizzle/0002_prices_default_uniq.down.sql").catch(() => {});
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
  await client.file("drizzle/0002_prices_default_uniq.sql");
  adminToken = await issueSession(crypto.randomUUID(), "admin");
});

afterAll(async () => {
  await client?.end();
});

async function arrange() {
  const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
  const roundId = await seedRound(db, `รอบ ${crypto.randomUUID()}`);
  const saleUnitId = await seedSaleUnit(db, varietyId, { gramsPerUnit: GRAMS });
  // NULL-date round default + a dated override — both via the staff endpoint.
  const d = await req("POST", "/prices", {
    token: adminToken,
    body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: KG_DEFAULT },
  });
  expect(d.status).toBe(201);
  const o = await req("POST", "/prices", {
    token: adminToken,
    body: {
      roundId,
      varietyId,
      tier: "b2c",
      pricePerKgSatang: KG_OVERRIDE,
      effectiveDate: OVERRIDE_DATE,
    },
  });
  expect(o.status).toBe(201);
  return { varietyId, roundId, saleUnitId };
}

describe("price resolution (OQ-2): dated override wins its day, else NULL default", () => {
  test("resolve on the override date returns the override", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req(
      "GET",
      `/prices/resolve?roundId=${roundId}&varietyId=${varietyId}&tier=b2c&date=${OVERRIDE_DATE}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResolveResp;
    expect(body.pricePerKgSatang).toBe(KG_OVERRIDE);
    expect(body.effectiveDate).toBe(OVERRIDE_DATE);
  });

  test("resolve on another date returns the NULL-date default", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req(
      "GET",
      `/prices/resolve?roundId=${roundId}&varietyId=${varietyId}&tier=b2c&date=${OTHER_DATE}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResolveResp;
    expect(body.pricePerKgSatang).toBe(KG_DEFAULT);
    expect(body.effectiveDate).toBeNull();
  });
});

describe("auto pack price (INV-04/D-13): whole-baht derived from the resolved kg price", () => {
  test("derived pack price equals deriveUnitPriceSatang(kg, grams) and is a multiple of 100", async () => {
    const { varietyId, roundId, saleUnitId } = await arrange();
    const res = await req(
      "GET",
      `/prices/resolve?roundId=${roundId}&varietyId=${varietyId}&tier=b2c&date=${OVERRIDE_DATE}`,
    );
    const body = (await res.json()) as ResolveResp;
    const pack = body.packs.find((p) => p.saleUnitId === saleUnitId);
    expect(pack).toBeDefined();
    expect(pack?.unitPriceSatang).toBe(deriveUnitPriceSatang(KG_OVERRIDE, GRAMS));
    expect((pack?.unitPriceSatang ?? 1) % 100).toBe(0);
  });
});

describe("price history: both rows persist", () => {
  test("GET /prices lists the default AND the override for the (round,variety,tier)", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req("GET", `/prices?roundId=${roundId}&varietyId=${varietyId}&tier=b2c`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { pricePerKgSatang: number; effectiveDate: string | null }[];
    expect(rows.length).toBe(2);
    const kgs = rows.map((r) => r.pricePerKgSatang).sort((a, b) => a - b);
    expect(kgs).toEqual([KG_DEFAULT, KG_OVERRIDE]);
  });
});

describe("WR-01: a single NULL-date default per (round,variety,tier)", () => {
  test("re-posting the default UPSERTS the one row (no competing duplicate)", async () => {
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const roundId = await seedRound(db, `รอบ ${crypto.randomUUID()}`);
    const first = await req("POST", "/prices", {
      token: adminToken,
      body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: 20000 },
    });
    expect(first.status).toBe(201);
    // A second default for the SAME (round,variety,tier) must NOT create a rival
    // NULL-date row — it updates the existing default in place.
    const second = await req("POST", "/prices", {
      token: adminToken,
      body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: 25000 },
    });
    expect(second.status).toBe(201);

    // Exactly ONE NULL-date default row exists, carrying the latest price → price
    // resolution is now deterministic.
    const rows = (await db.execute(
      sql`SELECT price_per_kg_satang FROM prices
          WHERE round_id = ${roundId} AND variety_id = ${varietyId}
            AND tier = 'b2c' AND effective_date IS NULL`,
    )) as unknown as { price_per_kg_satang: number }[];
    expect(rows.length).toBe(1);
    expect(Number(rows[0]?.price_per_kg_satang)).toBe(25000);

    const res = await req(
      "GET",
      `/prices/resolve?roundId=${roundId}&varietyId=${varietyId}&tier=b2c&date=2099-01-01`,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ResolveResp).pricePerKgSatang).toBe(25000);
  });
});

describe("tampering (T-01-12): negative/fractional kg price rejected by TypeBox", () => {
  test("negative price → 422", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req("POST", "/prices", {
      token: adminToken,
      body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: -1 },
    });
    expect(res.status).toBe(422);
  });

  test("fractional price → 422", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req("POST", "/prices", {
      token: adminToken,
      body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: 100.5 },
    });
    expect(res.status).toBe(422);
  });

  test("write still gated: no token → 401", async () => {
    const { varietyId, roundId } = await arrange();
    const res = await req("POST", "/prices", {
      body: { roundId, varietyId, tier: "b2c", pricePerKgSatang: 10000 },
    });
    expect(res.status).toBe(401);
  });
});
