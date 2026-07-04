// INV-08 / SALE-04 / SALE-01 / SALE-02 — the PUBLIC (no-auth) catalog surface the
// Phase-2 LIFF consumes. Raced against the REAL PostgreSQL 17 container (:55432)
// through the make*Routes(db) DI factory. Pins the customer-facing contract:
//   - availability = quota_plants − reserved_plants (per open round)
//   - a fully-reserved variety in a round shows soldOut + label "หมดรอบนี้" (INV-08)
//   - one variety surfaces MULTIPLE rounds/modes: preorder (future harvest, SALE-01)
//     and ready-to-ship (already harvested, SALE-02) on one product surface (SALE-04)
//   - resolved tiered prices (b2c/b2b) + derived whole-baht pack prices
//   - NO customer/order PII appears anywhere in a catalog response (T-01-15)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { roundStock, rounds } from "../src/db/schema";
import { makeCatalogRoutes } from "../src/routes/catalog";
import { deriveUnitPriceSatang } from "../src/services/pricing";
import { seedPrice, seedSaleUnit, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const FUTURE_HARVEST = "2027-01-01"; // > today ⇒ preorder (SALE-01)
const PAST_HARVEST = "2026-01-01"; // <= today ⇒ ready-to-ship (SALE-02)
const GRAMS = 250;
const KG_B2C = 20000; // 200 baht/kg
const KG_B2B = 15000; // 150 baht/kg

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeCatalogRoutes>;

function req(method: string, path: string) {
  return routes.handle(new Request(`http://localhost${path}`, { method }));
}

interface PackResp {
  saleUnitId: string;
  gramsPerUnit: number;
  unitPriceSatang: number;
}
interface TierPriceResp {
  pricePerKgSatang: number;
  effectiveDate: string | null;
  packs: PackResp[];
}
interface RoundEntryResp {
  roundId: string;
  saleMode: "preorder" | "ready";
  availability: number;
  soldOut: boolean;
  soldOutLabel: string | null;
  prices: { b2c: TierPriceResp | null; b2b: TierPriceResp | null };
}
interface VarietyResp {
  id: string;
  name: string;
  saleUnits: { id: string; gramsPerUnit: number }[];
  rounds: RoundEntryResp[];
}
interface CatalogResp {
  varieties: VarietyResp[];
}

/**
 * Arrange ONE variety selling in TWO open rounds:
 *   round A — future harvest, quota 100, reserved 0  ⇒ preorder, available 100
 *   round B — past harvest,   quota 10,  reserved 10 ⇒ ready,    sold out
 * Both rounds carry a b2c + b2b default price for the variety.
 */
async function arrange() {
  const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
  const saleUnitId = await seedSaleUnit(db, varietyId, { gramsPerUnit: GRAMS });

  const [rA] = await db
    .insert(rounds)
    .values({
      name: `รอบพรีออเดอร์ ${crypto.randomUUID()}`,
      status: "open",
      harvestDate: FUTURE_HARVEST,
    })
    .returning({ id: rounds.id });
  const [rB] = await db
    .insert(rounds)
    .values({ name: `รอบพร้อมส่ง ${crypto.randomUUID()}`, status: "open", harvestDate: PAST_HARVEST })
    .returning({ id: rounds.id });
  if (!rA || !rB) throw new Error("round insert returned no row");

  await db
    .insert(roundStock)
    .values({ roundId: rA.id, varietyId, quotaPlants: 100, reservedPlants: 0 });
  await db
    .insert(roundStock)
    .values({ roundId: rB.id, varietyId, quotaPlants: 10, reservedPlants: 10 });

  for (const roundId of [rA.id, rB.id]) {
    await seedPrice(db, roundId, varietyId, "b2c", KG_B2C, null);
    await seedPrice(db, roundId, varietyId, "b2b", KG_B2B, null);
  }
  return { varietyId, saleUnitId, preorderRoundId: rA.id, readyRoundId: rB.id };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeCatalogRoutes(db);
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

describe("GET /catalog — availability, sold-out label, multi-mode surface (INV-08/SALE-04)", () => {
  test("one variety surfaces BOTH sale modes across its two open rounds (SALE-04/01/02)", async () => {
    const { varietyId } = await arrange();
    const res = await req("GET", "/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogResp;
    const v = body.varieties.find((x) => x.id === varietyId);
    expect(v).toBeDefined();
    const modes = (v?.rounds ?? []).map((r) => r.saleMode).sort();
    expect(modes).toEqual(["preorder", "ready"]);
  });

  test("availability = quota − reserved; the fully-reserved round is soldOut with label หมดรอบนี้ (INV-08)", async () => {
    const { varietyId, preorderRoundId, readyRoundId } = await arrange();
    const res = await req("GET", "/catalog");
    const body = (await res.json()) as CatalogResp;
    const v = body.varieties.find((x) => x.id === varietyId);
    const pre = v?.rounds.find((r) => r.roundId === preorderRoundId);
    const ready = v?.rounds.find((r) => r.roundId === readyRoundId);

    expect(pre?.availability).toBe(100); // 100 − 0
    expect(pre?.saleMode).toBe("preorder");
    expect(pre?.soldOut).toBe(false);
    expect(pre?.soldOutLabel).toBeNull();

    expect(ready?.availability).toBe(0); // 10 − 10
    expect(ready?.saleMode).toBe("ready");
    expect(ready?.soldOut).toBe(true);
    expect(ready?.soldOutLabel).toBe("หมดรอบนี้");
  });

  test("resolved tiered prices + whole-baht derived pack prices are exposed", async () => {
    const { varietyId, saleUnitId, preorderRoundId } = await arrange();
    const res = await req("GET", "/catalog");
    const body = (await res.json()) as CatalogResp;
    const v = body.varieties.find((x) => x.id === varietyId);
    const pre = v?.rounds.find((r) => r.roundId === preorderRoundId);

    expect(pre?.prices.b2c?.pricePerKgSatang).toBe(KG_B2C);
    expect(pre?.prices.b2b?.pricePerKgSatang).toBe(KG_B2B);
    const pack = pre?.prices.b2c?.packs.find((p) => p.saleUnitId === saleUnitId);
    expect(pack?.unitPriceSatang).toBe(deriveUnitPriceSatang(KG_B2C, GRAMS));
    expect((pack?.unitPriceSatang ?? 1) % 100).toBe(0); // whole baht
  });

  test("no customer/order PII appears in the catalog response (T-01-15)", async () => {
    await arrange();
    const res = await req("GET", "/catalog");
    const raw = await res.text();
    for (const leak of ["recipient", "phone", "customerId", "subtotalSatang", "taxId"]) {
      expect(raw.includes(leak)).toBe(false);
    }
  });
});

describe("GET /catalog/rounds/:id — single round view", () => {
  test("returns the sold-out variety with its หมดรอบนี้ label for that round", async () => {
    const { varietyId, readyRoundId } = await arrange();
    const res = await req("GET", `/catalog/rounds/${readyRoundId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: { id: string; saleMode: string };
      varieties: RoundEntryResp[] & { id?: string }[];
    };
    expect(body.round.id).toBe(readyRoundId);
    expect(body.round.saleMode).toBe("ready");
    const v = (
      body.varieties as unknown as { id: string; soldOut: boolean; soldOutLabel: string | null }[]
    ).find((x) => x.id === varietyId);
    expect(v?.soldOut).toBe(true);
    expect(v?.soldOutLabel).toBe("หมดรอบนี้");
  });

  test("unknown round id → 404", async () => {
    const res = await req("GET", `/catalog/rounds/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
