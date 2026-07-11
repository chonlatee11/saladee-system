// CROP-04 / CUST-05 (Success Criterion 3) — the round-open orchestration proof.
//
// publishQuota is the SINGLE OWNER of the open-round sequence: in ONE transaction it
// writes round_stock.quota_plants from the crop forecast (computeDraftQuota, reusing
// the 03-04 pure kernel), then reserves EVERY active standing order through the
// EXISTING guarded reserveStanding()/reserve() path — so a B2C order that reads the
// quota after commit can only ever see `quota − reserved` (standing reserved BEFORE
// B2C, atomically, no race window). AFTER the commit it fires the subscription-generate
// trigger (03-07 queue) exactly once. Re-publish re-syncs quota on NON-override rows
// only and NEVER re-reserves / re-triggers (one-shot per round). Manual-override rows
// (is_manual_override) are never clobbered (D-03 / Pitfall 5). Raced against real
// PostgreSQL 17 (:55432) — no mock of the reservation core.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  customers,
  plantingBatches,
  roundStock,
  rounds,
  standingOrderItems,
  standingOrders,
  varieties,
} from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { computeDraftQuota, publishQuota } from "../src/services/harvest";
import { reserve } from "../src/services/reservation";
import { makeHarvestRoutes } from "../src/routes/harvest";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// ── local seed helpers (params-aware; seed.ts fixtures don't set yield params) ──
async function seedVarietyWithParams(opts: {
  daysToHarvest?: number;
  survivalPct?: number;
  shelfLifeDays?: number;
}): Promise<string> {
  const [row] = await db
    .insert(varieties)
    .values({
      name: `Variety ${crypto.randomUUID()}`,
      avgGramsPerPlant: 120,
      daysToHarvest: opts.daysToHarvest ?? 30,
      survivalPct: opts.survivalPct ?? 90,
      shelfLifeDays: opts.shelfLifeDays ?? 7,
    })
    .returning({ id: varieties.id });
  if (!row) throw new Error("seedVarietyWithParams: no row");
  return row.id;
}

async function seedRoundWithHarvest(harvestDate: string): Promise<string> {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(rounds)
    .values({ name: `Round ${crypto.randomUUID()}`, status: "open", cutoffAt: future, harvestDate })
    .returning({ id: rounds.id });
  if (!row) throw new Error("seedRoundWithHarvest: no row");
  return row.id;
}

async function seedBatch(varietyId: string, plantDate: string, plantCount: number): Promise<void> {
  await db.insert(plantingBatches).values({ varietyId, plantDate: new Date(plantDate), plantCount });
}

async function seedStandingItem(varietyId: string, plants: number): Promise<void> {
  const [cust] = await db
    .insert(customers)
    .values({ name: `B2B ${crypto.randomUUID()}`, b2bStatus: "approved" })
    .returning({ id: customers.id });
  if (!cust) throw new Error("seedStandingItem: no customer");
  const [order] = await db
    .insert(standingOrders)
    .values({ customerId: cust.id, active: true })
    .returning({ id: standingOrders.id });
  if (!order) throw new Error("seedStandingItem: no standing order");
  await db
    .insert(standingOrderItems)
    .values({ standingId: order.id, varietyId, plantsPerRound: plants });
}

async function stockRow(
  roundId: string,
  varietyId: string,
): Promise<{ quota: number; reserved: number; manual: boolean } | null> {
  const [row] = await db
    .select({
      quota: roundStock.quotaPlants,
      reserved: roundStock.reservedPlants,
      manual: roundStock.isManualOverride,
    })
    .from(roundStock)
    .where(and(eq(roundStock.roundId, roundId), eq(roundStock.varietyId, varietyId)))
    .limit(1);
  return row ?? null;
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
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
  await client.file("drizzle/0002_prices_default_uniq.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("computeDraftQuota — batch→round Σ(plantCount × survival%) (D-02/07)", () => {
  test("two same-variety batches whose projected date hits the round sum (floor each)", async () => {
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 90 });
    // plant 2026-06-01 + 30d → projected harvest 2026-07-01.
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100);
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100);
    // A batch whose projected date does NOT hit the round is excluded.
    await seedBatch(varietyId, "2026-06-15T00:00:00.000Z", 100);

    const draft = await computeDraftQuota(db, roundId);
    expect(draft).toEqual([{ varietyId, quotaPlants: 180 }]); // floor(90)+floor(90)
  });
});

describe("publishQuota — round-open orchestrator (reserve-before-B2C, one-shot)", () => {
  test("writes quota + reserves standing IN-TX so B2C sees quota − standingReserved; trigger fires post-commit", async () => {
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100); // forecast 100
    await seedStandingItem(varietyId, 60); // standing reserves 60 before B2C

    const triggered: string[] = [];
    // The trigger runs AFTER commit → a fresh read inside it MUST see the committed
    // quota row + the standing reservation (proves post-commit ordering).
    let seenReservedInTrigger = -1;
    const result = await publishQuota(db, roundId, async (rid) => {
      triggered.push(rid);
      const row = await stockRow(roundId, varietyId);
      seenReservedInTrigger = row?.reserved ?? -1;
    });

    expect(result.firstPublish).toBe(true);
    expect(result.standing.reserved).toEqual([{ varietyId, plants: 60 }]);

    const after = await stockRow(roundId, varietyId);
    expect(after?.quota).toBe(100);
    expect(after?.reserved).toBe(60); // standing reserved through the SAME counter

    // B2C now competes only for the leftover 40 (standing had priority-by-execution).
    expect(await reserve(db, roundId, varietyId, 41)).toBe(false);
    expect(await reserve(db, roundId, varietyId, 40)).toBe(true);
    expect((await stockRow(roundId, varietyId))?.reserved).toBe(100);

    // Trigger fired exactly once, AFTER commit (it saw reserved=60 already committed).
    expect(triggered).toEqual([roundId]);
    expect(seenReservedInTrigger).toBe(60);
  });

  test("re-publish is one-shot: re-syncs non-override quota but never re-reserves nor re-triggers", async () => {
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100); // forecast 100
    await seedStandingItem(varietyId, 60);

    const t1: string[] = [];
    await publishQuota(db, roundId, async (r) => void t1.push(r));
    expect(t1).toEqual([roundId]);
    expect((await stockRow(roundId, varietyId))?.reserved).toBe(60);

    // Bump the forecast (extra batch) then re-publish: quota re-syncs, reserve does NOT.
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 20); // forecast now 120
    const t2: string[] = [];
    const re = await publishQuota(db, roundId, async (r) => void t2.push(r));

    expect(re.firstPublish).toBe(false);
    expect(re.standing.reserved).toEqual([]); // no re-reserve
    expect(t2).toEqual([]); // no re-trigger (one-shot)
    const after = await stockRow(roundId, varietyId);
    expect(after?.quota).toBe(120); // non-override row re-synced to the new draft
    expect(after?.reserved).toBe(60); // reserved UNCHANGED (no double reserve)
  });

  test("manual-override rows are never clobbered by re-publish (D-03 / Pitfall 5)", async () => {
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100); // forecast 100

    await publishQuota(db, roundId, async () => {});
    // Operator hand-sets a smaller sellable qty and flags it manual.
    await db
      .update(roundStock)
      .set({ quotaPlants: 50, isManualOverride: true })
      .where(and(eq(roundStock.roundId, roundId), eq(roundStock.varietyId, varietyId)));

    // Re-publish would compute draft 100, but the manual row must survive untouched.
    await publishQuota(db, roundId, async () => {});
    const after = await stockRow(roundId, varietyId);
    expect(after?.quota).toBe(50);
    expect(after?.manual).toBe(true);
  });

  test("publishQuota touches only quota_plants — reserved_plants moves only via reserve()", async () => {
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100);
    // No standing orders this round → nothing reserved by publish.
    await publishQuota(db, roundId, async () => {});
    const after = await stockRow(roundId, varietyId);
    expect(after?.quota).toBe(100);
    expect(after?.reserved).toBe(0);
  });
});

describe("harvest routes — grower/admin gate (T-03-12)", () => {
  test("no token → 401, customer → 403, admin → 200", async () => {
    const routes = makeHarvestRoutes(db, async () => {});
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100);

    const admin = await issueSession(crypto.randomUUID(), "admin");
    const customer = await issueSession(crypto.randomUUID(), "customer");

    expect((await fire(routes, "GET", `/harvest/calendar?roundId=${roundId}`)).status).toBe(401);
    expect(
      (await fire(routes, "GET", `/harvest/calendar?roundId=${roundId}`, { token: customer }))
        .status,
    ).toBe(403);
    const ok = await fire(routes, "GET", `/harvest/calendar?roundId=${roundId}`, { token: admin });
    expect(ok.status).toBe(200);
  });

  test("POST /harvest/publish then PATCH /harvest/quota override persists across re-publish", async () => {
    const routes = makeHarvestRoutes(db, async () => {});
    const varietyId = await seedVarietyWithParams({ daysToHarvest: 30, survivalPct: 100 });
    const roundId = await seedRoundWithHarvest("2026-07-01");
    await seedBatch(varietyId, "2026-06-01T00:00:00.000Z", 100);
    const admin = await issueSession(crypto.randomUUID(), "admin");

    const pub = await fire(routes, "POST", "/harvest/publish", { token: admin, body: { roundId } });
    expect(pub.status).toBe(200);

    const patch = await fire(routes, "PATCH", "/harvest/quota", {
      token: admin,
      body: { roundId, varietyId, quotaPlants: 40 },
    });
    expect(patch.status).toBe(200);

    // Re-publish must not clobber the manual override.
    await fire(routes, "POST", "/harvest/publish", { token: admin, body: { roundId } });
    const after = await stockRow(roundId, varietyId);
    expect(after?.quota).toBe(40);
    expect(after?.manual).toBe(true);
  });
});
