// CUST-05 / D-09 / D-10 — the B2B standing-order reservation proof. A standing
// order reserves quota from the forecast BEFORE B2C opens by flowing through the
// EXISTING guarded reserve() (reservation.ts, UNCHANGED) — priority is achieved by
// ORDER OF EXECUTION, never a second counter or a SELECT-available pre-check
// (RESEARCH Pattern 2 / Pitfall 1, T-03-13). When a standing item exceeds the
// round's forecast quota, reserve() reports sold-out (false), reserveStanding does
// NOT auto-trim, and inserts a quota_overflow_flags row inside the tx for the admin
// to resolve (D-10 — the system never auto-decides). Raced against real PostgreSQL
// 17 (:55432) via postgres.js/drizzle (no mock).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { quotaOverflowFlags } from "../src/db/schema";
import { reserveStanding } from "../src/services/b2b";
import { reserve } from "../src/services/reservation";
import { seedStockRow } from "./seed";

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
  // Reset to a clean commerce shape, leaving 0004 applied (down first, up last —
  // the self-resetting-test invariant from 03-01) so sibling tests still find the
  // Phase-3 tables/columns.
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

describe("reserveStanding() — reserved-before-B2C via the existing reserve() (D-09)", () => {
  test("standing 60 of forecast 100 reserves first; B2C then sees only 40 left", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 100);

    const result = await reserveStanding(db, roundId, [{ varietyId, plants: 60 }]);
    expect(result.reserved).toEqual([{ varietyId, plants: 60 }]);
    expect(result.overflow).toEqual([]);
    // The standing reservation moved the SAME reserved_plants counter (no 2nd counter).
    expect(await reservedPlants(roundId, varietyId)).toBe(60);

    // B2C now competes for the leftover only: 41 is sold out, 40 exactly fits.
    expect(await reserve(db, roundId, varietyId, 41)).toBe(false);
    expect(await reserve(db, roundId, varietyId, 40)).toBe(true);
    expect(await reservedPlants(roundId, varietyId)).toBe(100);
  });

  test("standing that exceeds forecast → no reserve (no auto-trim) + an overflow flag (D-10)", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 100);

    const result = await reserveStanding(db, roundId, [{ varietyId, plants: 120 }]);
    // reserve() is all-or-nothing → nothing reserved; reserveStanding does NOT auto-trim.
    expect(result.reserved).toEqual([]);
    expect(result.overflow).toEqual([{ varietyId, shortfall: 120 }]);
    expect(await reservedPlants(roundId, varietyId)).toBe(0);

    // A quota_overflow_flags row was inserted (source b2b, unresolved) for the admin.
    const flags = await db
      .select()
      .from(quotaOverflowFlags)
      .where(
        and(eq(quotaOverflowFlags.roundId, roundId), eq(quotaOverflowFlags.varietyId, varietyId)),
      );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.shortfall).toBe(120);
    expect(flags[0]?.source).toBe("b2b");
    expect(flags[0]?.resolvedAt).toBeNull();
  });

  test("multi-item standing: some reserve, some overflow — all inside one caller tx", async () => {
    const a = await seedStockRow(db, 50);
    const b = await seedStockRow(db, 10);
    // Reuse a's round for b's variety so one round holds both stock rows.
    await db.execute(
      sql`INSERT INTO round_stock (round_id, variety_id, quota_plants) VALUES (${a.roundId}, ${b.varietyId}, 10)`,
    );

    const result = await db.transaction((tx) =>
      reserveStanding(tx, a.roundId, [
        { varietyId: a.varietyId, plants: 30 }, // fits (50)
        { varietyId: b.varietyId, plants: 25 }, // exceeds (10) → overflow
      ]),
    );

    expect(result.reserved).toEqual([{ varietyId: a.varietyId, plants: 30 }]);
    expect(result.overflow).toEqual([{ varietyId: b.varietyId, shortfall: 25 }]);
    expect(await reservedPlants(a.roundId, a.varietyId)).toBe(30);
    expect(await reservedPlants(a.roundId, b.varietyId)).toBe(0);
  });
});
