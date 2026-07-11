// INV-07 / PAY-04 / D-18 — box ordering at the HTTP boundary, proven against REAL
// PostgreSQL 17 (:55432). POST /orders with a box line reserves EVERY component
// all-or-nothing, freezes the BOM + server-resolved box price snapshot onto the
// order_line, and — under concurrency for the LAST box — yields exactly one 201 and
// N-1 409 with the scarce component never over-reserved. GET /catalog surfaces box
// availability = min across components with the "หมดรอบนี้" sold-out label. Cancelling
// a box order releases every component (stock stays correct).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeCatalogRoutes } from "../src/routes/catalog";
import { makeOrdersRoutes } from "../src/routes/orders";
import { seedBoxScenario } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const N = 8; // concurrent racers for the last box

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let orders: ReturnType<typeof makeOrdersRoutes>;
let catalog: ReturnType<typeof makeCatalogRoutes>;

const guest = {
  name: "ผู้ซื้อกล่อง",
  phone: "0800000000",
  recipientName: "ผู้รับ",
  recipientPhone: "0800000000",
  recipientAddress: "1 ถนนสลัด",
};

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

function postBoxOrder(
  boxId: string,
  roundId: string,
  qty: number,
  tier = "b2c",
): Promise<Response> {
  return orders.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier, customer: guest, boxLines: [{ boxId, roundId, qty }] }),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: N + 2 }); // Pitfall 2: max >= N
  db = drizzle(client, { schema });
  orders = makeOrdersRoutes(db);
  catalog = makeCatalogRoutes(db);
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /orders (box line) — all-or-nothing + frozen snapshot (INV-07 / PAY-04)", () => {
  test("over-quota box → 409, EVERY component's reserved unchanged (all-or-nothing)", async () => {
    const { roundId, boxId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 }, // A → 2 boxes
        { quotaPlants: 1, plantsPerBox: 1 }, // B → 1 box (scarce)
      ],
    });
    const [a, b] = components;
    if (!a || !b) throw new Error("seed produced too few components");

    const res = await postBoxOrder(boxId, roundId, 2); // over the scarce limit of 1
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: "sold_out" });

    expect(await reservedPlants(roundId, a.varietyId)).toBe(0);
    expect(await reservedPlants(roundId, b.varietyId)).toBe(0);
  });

  test("at-limit box → 201, decrements every component, order_line carries the snapshot", async () => {
    const { roundId, boxId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 },
        { quotaPlants: 1, plantsPerBox: 1 },
      ],
    });
    const [a, b] = components;
    if (!a || !b) throw new Error("seed produced too few components");

    const res = await postBoxOrder(boxId, roundId, 1);
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; subtotalSatang: number };

    expect(await reservedPlants(roundId, a.varietyId)).toBe(2); // 2/box × 1
    expect(await reservedPlants(roundId, b.varietyId)).toBe(1); // 1/box × 1

    // The order_line stores box_bom_json + a server-resolved unit price snapshot.
    // b2c 200 baht/kg, avg 120 g/plant: A(2 plants=240g)=4800 sat, B(1 plant=120g)=2400 sat → 7200.
    const rows = (await db.execute(
      sql`SELECT line_kind, box_id, unit_price_satang, qty, plants_decremented, box_bom_json
            FROM order_lines WHERE order_id = ${created.id}`,
    )) as unknown as {
      line_kind: string;
      box_id: string;
      unit_price_satang: number;
      qty: number;
      plants_decremented: number;
      box_bom_json: { components: { varietyId: string; plantsPerBox: number }[] };
    }[];
    expect(rows.length).toBe(1);
    const line = rows[0];
    if (!line) throw new Error("no order_line");
    expect(line.line_kind).toBe("box");
    expect(line.box_id).toBe(boxId);
    expect(Number(line.unit_price_satang)).toBe(7200);
    expect(created.subtotalSatang).toBe(7200);
    expect(Number(line.plants_decremented)).toBe(3); // 2 + 1 plants per box × 1
    expect(line.box_bom_json.components.length).toBe(2);
  });

  test("a fixed_price_satang box ignores component prices (D-18 override)", async () => {
    const { roundId, boxId } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 10, plantsPerBox: 1 },
        { quotaPlants: 10, plantsPerBox: 1 },
      ],
      fixedPriceSatang: 9900,
    });
    const res = await postBoxOrder(boxId, roundId, 1);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { subtotalSatang: number }).subtotalSatang).toBe(9900);
  });
});

describe("GET /catalog — box availability = min across components (INV-07)", () => {
  test("box availability = min; scarce-component-0 box shows soldOut หมดรอบนี้", async () => {
    const { roundId } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 }, // 2 boxes
        { quotaPlants: 1, plantsPerBox: 1 }, // 1 box (scarce) → box availability 1
      ],
    });
    let res = await catalog.handle(new Request("http://localhost/catalog"));
    let body = (await res.json()) as {
      boxes: {
        rounds: {
          roundId: string;
          availability: number;
          soldOut: boolean;
          soldOutLabel: string | null;
        }[];
      }[];
    };
    const before = body.boxes.flatMap((bx) => bx.rounds).find((r) => r.roundId === roundId);
    expect(before?.availability).toBe(1);
    expect(before?.soldOut).toBe(false);

    // Exhaust every component in this round → box availability drops to 0.
    await db.execute(
      sql`UPDATE round_stock SET reserved_plants = quota_plants WHERE round_id = ${roundId}`,
    );
    res = await catalog.handle(new Request("http://localhost/catalog"));
    body = (await res.json()) as typeof body;
    const after = body.boxes.flatMap((bx) => bx.rounds).find((r) => r.roundId === roundId);
    expect(after?.availability).toBe(0);
    expect(after?.soldOut).toBe(true);
    expect(after?.soldOutLabel).toBe("หมดรอบนี้");
  });
});

describe("POST /orders (box) — concurrency: exactly one winner on the last box (INV-07)", () => {
  test(`N=${N} racers for the last box → one 201, ${N - 1} × 409, scarce reserved ≤ quota`, async () => {
    // Scarce component B caps the box at exactly 1 (quota 1, 1 plant/box).
    const { roundId, boxId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 100, plantsPerBox: 2 }, // A: plentiful
        { quotaPlants: 1, plantsPerBox: 1 }, // B: the last-box bottleneck
      ],
    });
    const scarce = components[1];
    if (!scarce) throw new Error("seed produced too few components");

    const results = await Promise.allSettled(
      Array.from({ length: N }, () => postBoxOrder(boxId, roundId, 1)),
    );
    const statuses = await Promise.all(
      results.map((r) => (r.status === "fulfilled" ? r.value.status : 500)),
    );
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(N - 1);
    // The invariant that matters: the scarce component never exceeds its quota.
    expect(await reservedPlants(roundId, scarce.varietyId)).toBe(1);
  });
});

describe("PATCH /orders/:id/status — cancelling a box order releases every component", () => {
  test("cancel → all box components released back to 0 (stock correctness)", async () => {
    const admin = await issueSession("staff-admin", "admin");
    const { roundId, boxId, components } = await seedBoxScenario(db, {
      components: [
        { quotaPlants: 4, plantsPerBox: 2 },
        { quotaPlants: 4, plantsPerBox: 1 },
      ],
    });
    const [a, b] = components;
    if (!a || !b) throw new Error("seed produced too few components");

    const res = await postBoxOrder(boxId, roundId, 1);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await reservedPlants(roundId, a.varietyId)).toBe(2);
    expect(await reservedPlants(roundId, b.varietyId)).toBe(1);

    const cancel = await orders.handle(
      new Request(`http://localhost/orders/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
        body: JSON.stringify({ status: "cancelled" }),
      }),
    );
    expect(cancel.status).toBe(200);
    expect(await reservedPlants(roundId, a.varietyId)).toBe(0);
    expect(await reservedPlants(roundId, b.varietyId)).toBe(0);
  });
});
