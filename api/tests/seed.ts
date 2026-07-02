// Integration-test seed helpers (reuse the postgres.js/drizzle wiring from
// migrate.test.ts). These insert the minimum rows the reservation/order tests
// need to arrange a round_stock counter to race against. Kept dependency-free of
// the app so tests stay pure-DB (no Elysia boot, no env validation).
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../src/db/schema";
import { prices, roundStock, rounds, saleUnits, varieties } from "../src/db/schema";

export type SeedDb = PostgresJsDatabase<typeof schema>;

/** Insert a variety and return its id. */
export async function seedVariety(db: SeedDb, name = "Test Green Oak"): Promise<string> {
  const [row] = await db
    .insert(varieties)
    .values({ name, avgGramsPerPlant: 120 })
    .returning({ id: varieties.id });
  if (!row) throw new Error("seedVariety: insert returned no row");
  return row.id;
}

/** Insert an OPEN round with a future cut-off and return its id. */
export async function seedRound(db: SeedDb, name = "Test Round"): Promise<string> {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // +1 day
  const [row] = await db
    .insert(rounds)
    .values({ name, status: "open", cutoffAt: future })
    .returning({ id: rounds.id });
  if (!row) throw new Error("seedRound: insert returned no row");
  return row.id;
}

/** Insert a round_stock counter (reserved defaults to 0) and return its id. */
export async function seedRoundStock(
  db: SeedDb,
  roundId: string,
  varietyId: string,
  quotaPlants: number,
): Promise<string> {
  const [row] = await db
    .insert(roundStock)
    .values({ roundId, varietyId, quotaPlants })
    .returning({ id: roundStock.id });
  if (!row) throw new Error("seedRoundStock: insert returned no row");
  return row.id;
}

/**
 * Arrange a fresh (variety, round, round_stock) triple with the given quota.
 * Each call uses a distinct variety+round so parallel tests never collide on
 * the same counter.
 */
export async function seedStockRow(
  db: SeedDb,
  quotaPlants: number,
): Promise<{ varietyId: string; roundId: string; stockId: string }> {
  const varietyId = await seedVariety(db, `Variety ${crypto.randomUUID()}`);
  const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
  const stockId = await seedRoundStock(db, roundId, varietyId, quotaPlants);
  return { varietyId, roundId, stockId };
}

/** Insert a sale unit (pack) for a variety and return its id. */
export async function seedSaleUnit(
  db: SeedDb,
  varietyId: string,
  opts: { label?: string; gramsPerUnit?: number; plantsPerUnit?: number } = {},
): Promise<string> {
  const { label = "250g", gramsPerUnit = 250, plantsPerUnit = 2 } = opts;
  const [row] = await db
    .insert(saleUnits)
    .values({ varietyId, kind: "pack", label, gramsPerUnit, plantsPerUnit })
    .returning({ id: saleUnits.id });
  if (!row) throw new Error("seedSaleUnit: insert returned no row");
  return row.id;
}

/**
 * Insert a price row (integer satang per kg) for (round, variety, tier).
 * `effectiveDate` NULL = the round default; a 'YYYY-MM-DD' string = a dated override.
 */
export async function seedPrice(
  db: SeedDb,
  roundId: string,
  varietyId: string,
  tier: "b2c" | "b2b",
  pricePerKgSatang: number,
  effectiveDate: string | null = null,
): Promise<string> {
  const [row] = await db
    .insert(prices)
    .values({ roundId, varietyId, tier, pricePerKgSatang, effectiveDate })
    .returning({ id: prices.id });
  if (!row) throw new Error("seedPrice: insert returned no row");
  return row.id;
}

/**
 * Arrange a complete sellable line: variety + sale unit + open round + stock +
 * a b2c default price. Returns every id the order endpoint tests need.
 */
export async function seedSellableLine(
  db: SeedDb,
  opts: {
    quotaPlants?: number;
    plantsPerUnit?: number;
    gramsPerUnit?: number;
    pricePerKgSatang?: number;
  } = {},
): Promise<{
  varietyId: string;
  roundId: string;
  saleUnitId: string;
  stockId: string;
  priceId: string;
  variety: { name: string; avgGramsPerPlant: number };
}> {
  const {
    quotaPlants = 100,
    plantsPerUnit = 2,
    gramsPerUnit = 250,
    pricePerKgSatang = 20000, // 200 baht/kg
  } = opts;
  const name = `Variety ${crypto.randomUUID()}`;
  const [vrow] = await db
    .insert(varieties)
    .values({ name, avgGramsPerPlant: 120 })
    .returning({ id: varieties.id });
  if (!vrow) throw new Error("seedSellableLine: variety insert returned no row");
  const varietyId = vrow.id;
  const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
  const saleUnitId = await seedSaleUnit(db, varietyId, { gramsPerUnit, plantsPerUnit });
  const stockId = await seedRoundStock(db, roundId, varietyId, quotaPlants);
  const priceId = await seedPrice(db, roundId, varietyId, "b2c", pricePerKgSatang, null);
  return {
    varietyId,
    roundId,
    saleUnitId,
    stockId,
    priceId,
    variety: { name, avgGramsPerPlant: 120 },
  };
}
