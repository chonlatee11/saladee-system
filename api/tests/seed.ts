// Integration-test seed helpers (reuse the postgres.js/drizzle wiring from
// migrate.test.ts). These insert the minimum rows the reservation/order tests
// need to arrange a round_stock counter to race against. Kept dependency-free of
// the app so tests stay pure-DB (no Elysia boot, no env validation).
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../src/db/schema";
import {
  boxComponents,
  boxes,
  prices,
  roundStock,
  rounds,
  saleUnits,
  varieties,
} from "../src/db/schema";

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

// ── Mixed-salad box helpers (01-05, INV-07 / D-17 / D-18) ─────────────────────

/** Insert a box + its fixed BOM (box_components) and return its id. */
export async function seedBox(
  db: SeedDb,
  components: { varietyId: string; plantsPerBox: number }[],
  opts: { name?: string; fixedPriceSatang?: number | null } = {},
): Promise<string> {
  const { name = `Box ${crypto.randomUUID()}`, fixedPriceSatang = null } = opts;
  const [box] = await db
    .insert(boxes)
    .values({ name, fixedPriceSatang })
    .returning({ id: boxes.id });
  if (!box) throw new Error("seedBox: box insert returned no row");
  await db.insert(boxComponents).values(
    components.map((c) => ({
      boxId: box.id,
      varietyId: c.varietyId,
      plantsPerBox: c.plantsPerBox,
    })),
  );
  return box.id;
}

/**
 * Arrange a complete orderable box scenario in ONE open round: each component is
 * its own variety with a round_stock quota + b2c/b2b default prices, wired into a
 * box with the given plantsPerBox. Returns every id the box order/catalog tests
 * need. Box availability = min(floor((quota−reserved)/plantsPerBox)) across these.
 */
export async function seedBoxScenario(
  db: SeedDb,
  spec: {
    components: {
      quotaPlants: number;
      plantsPerBox: number;
      pricePerKgSatangB2c?: number;
      pricePerKgSatangB2b?: number;
      avgGramsPerPlant?: number;
    }[];
    fixedPriceSatang?: number | null;
  },
): Promise<{
  roundId: string;
  boxId: string;
  components: {
    varietyId: string;
    plantsPerBox: number;
    quotaPlants: number;
    avgGramsPerPlant: number;
    pricePerKgSatangB2c: number;
    pricePerKgSatangB2b: number;
  }[];
}> {
  const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
  const components: {
    varietyId: string;
    plantsPerBox: number;
    quotaPlants: number;
    avgGramsPerPlant: number;
    pricePerKgSatangB2c: number;
    pricePerKgSatangB2b: number;
  }[] = [];
  for (const c of spec.components) {
    const avgGramsPerPlant = c.avgGramsPerPlant ?? 120;
    const pricePerKgSatangB2c = c.pricePerKgSatangB2c ?? 20000;
    const pricePerKgSatangB2b = c.pricePerKgSatangB2b ?? 18000;
    const [vrow] = await db
      .insert(varieties)
      .values({ name: `Variety ${crypto.randomUUID()}`, avgGramsPerPlant })
      .returning({ id: varieties.id });
    if (!vrow) throw new Error("seedBoxScenario: variety insert returned no row");
    const varietyId = vrow.id;
    await seedRoundStock(db, roundId, varietyId, c.quotaPlants);
    await seedPrice(db, roundId, varietyId, "b2c", pricePerKgSatangB2c, null);
    await seedPrice(db, roundId, varietyId, "b2b", pricePerKgSatangB2b, null);
    components.push({
      varietyId,
      plantsPerBox: c.plantsPerBox,
      quotaPlants: c.quotaPlants,
      avgGramsPerPlant,
      pricePerKgSatangB2c,
      pricePerKgSatangB2b,
    });
  }
  const boxId = await seedBox(
    db,
    components.map((c) => ({ varietyId: c.varietyId, plantsPerBox: c.plantsPerBox })),
    { fixedPriceSatang: spec.fixedPriceSatang ?? null },
  );
  return { roundId, boxId, components };
}
