// CROP-01/02/03/06 + ADM-02 route integration (03-04). Exercises the grower-gated
// crop endpoints end-to-end against real PostgreSQL 17 (:55432) via the
// makeCropRoutes(db) DI factory — variety-param save, planting-batch create with
// computed harvest date + expected plants, one-click mix→batch spawn with the
// idempotent "already created" guard, and the RBAC gate (401/403/pass, D-19).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { plantingBatches } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeCropRoutes } from "../src/routes/crop";
import { seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let crop: ReturnType<typeof makeCropRoutes>;
let grower: string;
let customer: string;

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
  crop = makeCropRoutes(db);
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
  grower = await issueSession(crypto.randomUUID(), "grower");
  customer = await issueSession(crypto.randomUUID(), "customer");
});

afterAll(async () => {
  await client?.end();
});

describe("variety params (CROP-01) + planting batch compute (CROP-02/03)", () => {
  test("PUT params persists, then a batch returns computed harvest date + expected plants", async () => {
    const varietyId = await seedVariety(db, `Green Oak ${crypto.randomUUID()}`);

    const put = await fire(crop, "PUT", `/crop/varieties/${varietyId}/params`, {
      token: grower,
      body: { daysToHarvest: 45, survivalPct: 90, harvestWindowDays: 2, shelfLifeDays: 7 },
    });
    expect(put.status).toBe(200);
    expect((await put.json()) as { daysToHarvest: number; survivalPct: number }).toMatchObject({
      daysToHarvest: 45,
      survivalPct: 90,
    });

    const post = await fire(crop, "POST", "/crop/planting-batches", {
      token: grower,
      body: { varietyId, plantDate: "2026-07-06", plantCount: 200, bed: "A1" },
    });
    expect(post.status).toBe(201);
    const batch = (await post.json()) as {
      id: string;
      projectedHarvestDate: string;
      expectedPlants: number;
    };
    // 2026-07-06 + 45d = 2026-08-20 ; 200 × 90% floored = 180.
    expect(batch.projectedHarvestDate.slice(0, 10)).toBe("2026-08-20");
    expect(batch.expectedPlants).toBe(180);

    // GET lists it with the same computed fields.
    const list = await fire(crop, "GET", "/crop/planting-batches", { token: grower });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { id: string; expectedPlants: number }[];
    const found = rows.find((r) => r.id === batch.id);
    expect(found?.expectedPlants).toBe(180);
  });

  test("PUT params with survivalPct out of range → 422", async () => {
    const varietyId = await seedVariety(db, `Bad ${crypto.randomUUID()}`);
    const res = await fire(crop, "PUT", `/crop/varieties/${varietyId}/params`, {
      token: grower,
      body: { daysToHarvest: 30, survivalPct: 150, harvestWindowDays: 1, shelfLifeDays: 7 },
    });
    expect(res.status).toBe(422);
  });
});

describe("planting-mix → one-click batch spawn (CROP-06 / D-06)", () => {
  test("create-batches spawns one batch per item; re-run is idempotent (already-created)", async () => {
    const v1 = await seedVariety(db, `Mix-A ${crypto.randomUUID()}`);
    const v2 = await seedVariety(db, `Mix-B ${crypto.randomUUID()}`);

    const tplRes = await fire(crop, "POST", "/crop/mix-templates", {
      token: grower,
      body: {
        name: `สูตรจันทร์ ${crypto.randomUUID()}`,
        items: [
          { varietyId: v1, plantCount: 100 },
          { varietyId: v2, plantCount: 100 },
        ],
      },
    });
    expect(tplRes.status).toBe(201);
    const tpl = (await tplRes.json()) as { id: string; items: unknown[] };
    expect(tpl.items).toHaveLength(2);

    const plantDate = "2026-07-13";
    const first = await fire(crop, "POST", `/crop/mix-templates/${tpl.id}/create-batches`, {
      token: grower,
      body: { plantDate },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { alreadyCreated: boolean; batches: unknown[] };
    expect(firstBody.alreadyCreated).toBe(false);
    expect(firstBody.batches).toHaveLength(2);

    // Re-click the same Monday → no new batches, already-created notice.
    const second = await fire(crop, "POST", `/crop/mix-templates/${tpl.id}/create-batches`, {
      token: grower,
      body: { plantDate },
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { alreadyCreated: boolean; batches: unknown[] };
    expect(secondBody.alreadyCreated).toBe(true);

    // DB truth: exactly 2 batches exist for these varieties on that plant date.
    const rows = await db
      .select()
      .from(plantingBatches)
      .where(
        and(
          eq(plantingBatches.plantDate, new Date("2026-07-13")),
          inArray(plantingBatches.varietyId, [v1, v2]),
        ),
      );
    expect(rows).toHaveLength(2);
  });
});

describe("RBAC gate on crop routes (ADM-02 / D-19 / T-03-07)", () => {
  test("no token → 401", async () => {
    const varietyId = await seedVariety(db, `Guard ${crypto.randomUUID()}`);
    const res = await fire(crop, "PUT", `/crop/varieties/${varietyId}/params`, {
      body: { daysToHarvest: 30, survivalPct: 90, harvestWindowDays: 1, shelfLifeDays: 7 },
    });
    expect(res.status).toBe(401);
  });

  test("customer token → 403 (customer is not a staff role)", async () => {
    const varietyId = await seedVariety(db, `Guard2 ${crypto.randomUUID()}`);
    const res = await fire(crop, "PUT", `/crop/varieties/${varietyId}/params`, {
      token: customer,
      body: { daysToHarvest: 30, survivalPct: 90, harvestWindowDays: 1, shelfLifeDays: 7 },
    });
    expect(res.status).toBe(403);
  });

  test("grower token → allowed to list batches", async () => {
    const res = await fire(crop, "GET", "/crop/planting-batches", { token: grower });
    expect(res.status).toBe(200);
  });
});
