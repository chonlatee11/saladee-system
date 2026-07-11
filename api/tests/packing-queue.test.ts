// ORD-03 / D-20 / D-21 packing slice (03-09). Exercises the packer-gated packing
// endpoints end-to-end against real PostgreSQL 17 (:55432) via the
// makePackingRoutes(db) DI factory:
//   - GET /packing/queue?roundId — paid orders grouped by round → route
//     (deliveryMethod/deliveryZone), ordered by (round_id, delivery_zone) (Pattern 5)
//   - PATCH /packing/:orderId/packed — sets orders.packed_at (per-order pack state)
//   - GET /packing/pack-slip.pdf?roundId & /packing/label-slip.pdf?orderId — return
//     a real Thai (Sarabun) PDF via renderPackSlip/renderLabelSlip (03-02 spike)
//   - the RBAC gate: owner/admin/packer pass; grower/customer 403; no token 401 (D-19)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, orderLines, orders } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makePackingRoutes } from "../src/routes/packing";
import { seedRound } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let packing: ReturnType<typeof makePackingRoutes>;
let packer: string;
let admin: string;
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

/** Insert a customer and return its id. */
async function seedCustomer(name: string): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: false, name })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: insert returned no row");
  return row.id;
}

/** Insert a PAID order (the pack queue only lists paid orders) with a delivery
 *  snapshot + one order line, and return its id. */
async function seedPaidOrder(
  roundId: string,
  customerId: string,
  opts: {
    deliveryMethod?: string | null;
    deliveryZone?: string | null;
    recipientName?: string;
    subtotalSatang?: number;
  } = {},
): Promise<string> {
  const {
    deliveryMethod = "delivery",
    deliveryZone = "กรุงเทพฯ",
    recipientName = "คุณสมชาย ใจดี",
    subtotalSatang = 18500,
  } = opts;
  const [order] = await db
    .insert(orders)
    .values({
      customerId,
      roundId,
      status: "paid",
      tier: "b2c",
      recipientName,
      recipientPhone: "0812345678",
      recipientAddress: "123 ถนนสุขุมวิท กรุงเทพฯ 10110",
      subtotalSatang,
      deliveryMethod,
      deliveryZone,
      deliveryFeeSatang: 3000,
    })
    .returning({ id: orders.id });
  if (!order) throw new Error("seedPaidOrder: insert returned no row");
  await db.insert(orderLines).values({
    orderId: order.id,
    lineKind: "variety",
    varietyName: "กรีนโอ๊ค",
    unitLabel: "250g",
    tier: "b2c",
    unitPriceSatang: 9250,
    qty: 2,
    plantsDecremented: 4,
  });
  return order.id;
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  packing = makePackingRoutes(db);
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
  packer = await issueSession(crypto.randomUUID(), "packer");
  admin = await issueSession(crypto.randomUUID(), "admin");
  grower = await issueSession(crypto.randomUUID(), "grower");
  customer = await issueSession(crypto.randomUUID(), "customer");
});

afterAll(async () => {
  await client?.end();
});

describe("packing queue grouping by route (ORD-03 / D-20)", () => {
  test("GET /packing/queue groups paid orders by round → deliveryZone", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const c1 = await seedCustomer("A");
    const c2 = await seedCustomer("B");
    const c3 = await seedCustomer("C");
    // Two orders in the same zone, one in another zone.
    await seedPaidOrder(roundId, c1, { deliveryZone: "กรุงเทพฯ" });
    await seedPaidOrder(roundId, c2, { deliveryZone: "กรุงเทพฯ" });
    await seedPaidOrder(roundId, c3, { deliveryZone: "นนทบุรี" });

    const res = await fire(packing, "GET", `/packing/queue?roundId=${roundId}`, {
      token: packer,
    });
    expect(res.status).toBe(200);
    const groups = (await res.json()) as {
      roundId: string;
      routes: { deliveryZone: string | null; orders: { id: string; packedAt: string | null }[] }[];
    }[];
    const round = groups.find((g) => g.roundId === roundId);
    expect(round).toBeTruthy();
    // Two routes (two distinct zones), one with 2 orders, one with 1.
    expect(round?.routes.length).toBe(2);
    const bkk = round?.routes.find((r) => r.deliveryZone === "กรุงเทพฯ");
    const nbi = round?.routes.find((r) => r.deliveryZone === "นนทบุรี");
    expect(bkk?.orders.length).toBe(2);
    expect(nbi?.orders.length).toBe(1);
    // paid orders are to-pack (packed_at null) initially.
    expect(bkk?.orders.every((o) => o.packedAt === null)).toBe(true);
  });

  test("queue excludes non-paid orders", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const c1 = await seedCustomer("paid");
    await seedPaidOrder(roundId, c1, { deliveryZone: "เชียงใหม่" });
    // A created (unpaid) order in the same round must NOT appear.
    const c2 = await seedCustomer("unpaid");
    await db.insert(orders).values({
      customerId: c2,
      roundId,
      status: "created",
      tier: "b2c",
      subtotalSatang: 1000,
      deliveryZone: "เชียงใหม่",
    });
    const res = await fire(packing, "GET", `/packing/queue?roundId=${roundId}`, {
      token: packer,
    });
    const groups = (await res.json()) as { roundId: string; routes: { orders: unknown[] }[] }[];
    const round = groups.find((g) => g.roundId === roundId);
    const total = round?.routes.reduce((n, r) => n + r.orders.length, 0);
    expect(total).toBe(1); // only the paid order
  });
});

describe("mark-packed (D-20 per-order pack state)", () => {
  test("PATCH /packing/:orderId/packed sets packed_at", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const c = await seedCustomer("pack");
    const orderId = await seedPaidOrder(roundId, c);

    const res = await fire(packing, "PATCH", `/packing/${orderId}/packed`, {
      token: packer,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; packedAt: string | null };
    expect(body.id).toBe(orderId);
    expect(body.packedAt).not.toBeNull();

    const [row] = await db
      .select({ packedAt: orders.packedAt })
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(row?.packedAt).not.toBeNull();
  });

  test("PATCH unknown order → 404", async () => {
    const res = await fire(packing, "PATCH", `/packing/${crypto.randomUUID()}/packed`, {
      token: packer,
    });
    expect(res.status).toBe(404);
  });
});

describe("PDF endpoints return valid Thai PDF (D-21)", () => {
  test("GET /packing/pack-slip.pdf returns application/pdf + %PDF", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const c = await seedCustomer("slip");
    await seedPaidOrder(roundId, c, { deliveryZone: "กรุงเทพฯ" });

    const res = await fire(packing, "GET", `/packing/pack-slip.pdf?roundId=${roundId}`, {
      token: packer,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  test("GET /packing/label-slip.pdf returns application/pdf + %PDF", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const c = await seedCustomer("label");
    const orderId = await seedPaidOrder(roundId, c, { deliveryZone: "นนทบุรี" });

    const res = await fire(packing, "GET", `/packing/label-slip.pdf?orderId=${orderId}`, {
      token: packer,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("label-slip.pdf for unknown order → 404", async () => {
    const res = await fire(packing, "GET", `/packing/label-slip.pdf?orderId=${crypto.randomUUID()}`, {
      token: packer,
    });
    expect(res.status).toBe(404);
  });
});

describe("RBAC gate (D-19 / T-03-23)", () => {
  test("owner/admin/packer pass; grower/customer 403; no token 401", async () => {
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const path = `/packing/queue?roundId=${roundId}`;

    expect((await fire(packing, "GET", path, { token: packer })).status).toBe(200);
    expect((await fire(packing, "GET", path, { token: admin })).status).toBe(200);
    expect((await fire(packing, "GET", path, { token: grower })).status).toBe(403);
    expect((await fire(packing, "GET", path, { token: customer })).status).toBe(403);
    expect((await fire(packing, "GET", path)).status).toBe(401);
  });
});
