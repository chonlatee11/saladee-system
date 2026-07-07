// ORD-02 / D-03 / D-08 / Pitfall 5 — PATCH /orders/:id/status is the staff-only
// status pipeline. Auth boundary: 401 no/invalid token, 403 wrong role, 200 for
// owner|admin. Transition validation: only legal transitions apply; illegal ones
// (created→paid, done→cancelled) are rejected. Cancel releases the order's
// reserved plants exactly once (idempotent) — a second cancel never drives
// reserved below the real level. Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeOrdersRoutes } from "../src/routes/orders";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

/** Place one order for a given (round, variety, saleUnit) line; returns its id. */
async function placeOrderOn(seed: {
  roundId: string;
  varietyId: string;
  saleUnitId: string;
}): Promise<string> {
  const res = await routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "b2c",
        customer: {
          name: "ลูกค้า",
          phone: "0800000000",
          recipientName: "ผู้รับ",
          recipientPhone: "0800000000",
          recipientAddress: "1 ถนนสลัด",
        },
        lines: [
          { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
        ],
      }),
    }),
  );
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Place a real order via the open POST endpoint; returns its ids + reserved. */
async function placeOrder() {
  const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
  const orderId = await placeOrderOn(seed);
  return { orderId, roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId };
}

function patchStatus(id: string, status: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return routes.handle(
    new Request(`http://localhost/orders/${id}/status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status }),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
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

describe("PATCH /orders/:id/status — staff auth boundary (D-03/PLAT-03)", () => {
  test("no token → 401", async () => {
    const { orderId } = await placeOrder();
    const res = await patchStatus(orderId, "awaiting_payment");
    expect(res.status).toBe(401);
  });

  test("packer role → 403 (forbidden)", async () => {
    const { orderId } = await placeOrder();
    const token = await issueSession("staff-1", "packer");
    const res = await patchStatus(orderId, "awaiting_payment", token);
    expect(res.status).toBe(403);
  });

  test("admin role → 200 on a legal transition", async () => {
    const { orderId } = await placeOrder();
    const token = await issueSession("staff-admin", "admin");
    const res = await patchStatus(orderId, "awaiting_payment", token);
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "awaiting_payment" });
  });
});

describe("PATCH /orders/:id/status — transition validation", () => {
  test("illegal transition (created→paid) → 400, status unchanged", async () => {
    const { orderId } = await placeOrder();
    const token = await issueSession("staff-admin", "admin");
    const res = await patchStatus(orderId, "paid", token);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "illegal_transition" });
    const [row] = (await db.execute(
      sql`SELECT status FROM orders WHERE id = ${orderId}`,
    )) as unknown as { status: string }[];
    expect(row?.status).toBe("created");
  });
});

describe("PATCH /orders/:id/status — cancel releases stock idempotently (D-08/Pitfall 5)", () => {
  test("cancel releases reserved to 0; a second cancel keeps it at 0", async () => {
    const admin = await issueSession("staff-admin", "admin");
    const { orderId, roundId, varietyId } = await placeOrder();
    expect(await reservedPlants(roundId, varietyId)).toBe(2); // one pack reserved

    const c1 = await patchStatus(orderId, "cancelled", admin);
    expect(c1.status).toBe(200);
    expect(await reservedPlants(roundId, varietyId)).toBe(0); // released exactly once

    // Second cancel must NOT release again (already terminal) — reserved stays 0.
    const c2 = await patchStatus(orderId, "cancelled", admin);
    expect(c2.status).toBe(400); // cancelled is terminal → illegal_transition
    expect(await reservedPlants(roundId, varietyId)).toBe(0);
  });

  test("CONCURRENT double-cancel releases stock exactly once (CR-01/WR-05)", async () => {
    // Regression for the TOCTOU window: two cancels fired in parallel on the same
    // order must NOT both run release(). Before the fix both read status outside the
    // tx, both passed canTransition('created','cancelled'), and both decremented
    // reserved_plants — freeing OTHER orders' reservations (oversell). With the
    // SELECT ... FOR UPDATE re-read inside the tx, exactly one cancel wins (200) and
    // the loser re-reads 'cancelled' → 400, so reserved lands at 0, never negative.
    const admin = await issueSession("staff-admin", "admin");
    // One shared round_stock counter, two live orders on it (2 plants each).
    const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
    const orderId = await placeOrderOn(seed);
    const otherOrderId = await placeOrderOn(seed);
    const { roundId, varietyId } = seed;
    // The OTHER order's 2 reserved plants are exactly what a buggy double-release of
    // the first order would silently free. They must remain reserved.
    expect(await reservedPlants(roundId, varietyId)).toBe(4); // 2 + 2 reserved

    const [c1, c2] = await Promise.all([
      patchStatus(orderId, "cancelled", admin),
      patchStatus(orderId, "cancelled", admin),
    ]);
    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([200, 400]); // exactly one wins, the other is rejected

    // The cancelled order released its 2 plants exactly once; the OTHER order's 2
    // plants are untouched. A double-release would have driven this to 0 (or the
    // CHECK would have aborted at reserved < 0) — either way ≠ 2.
    expect(await reservedPlants(roundId, varietyId)).toBe(2);
    // The still-live order is unaffected.
    const [row] = (await db.execute(
      sql`SELECT status FROM orders WHERE id = ${otherOrderId}`,
    )) as unknown as { status: string }[];
    expect(row?.status).toBe("created");
  });

  test("done → cancelled is rejected (D-08); stock stays reserved", async () => {
    const admin = await issueSession("staff-admin", "admin");
    const { orderId, roundId, varietyId } = await placeOrder();
    // Force the order to a terminal shipped/done state directly.
    await db.execute(sql`UPDATE orders SET status = 'done' WHERE id = ${orderId}`);
    const res = await patchStatus(orderId, "cancelled", admin);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "illegal_transition" });
    expect(await reservedPlants(roundId, varietyId)).toBe(2); // done keeps stock reserved
  });
});
