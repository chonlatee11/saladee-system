// Integration-test seed helpers (reuse the postgres.js/drizzle wiring from
// migrate.test.ts). These insert the minimum rows the reservation/order tests
// need to arrange a round_stock counter to race against. Kept dependency-free of
// the app so tests stay pure-DB (no Elysia boot, no env validation).
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../src/db/schema";
import { roundStock, rounds, varieties } from "../src/db/schema";

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
