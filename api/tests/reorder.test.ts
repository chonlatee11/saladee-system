// CUST-04 / LINE-02 (02-09) — member order history + reorder, raced against the
// REAL PostgreSQL 17 container (:55432) via the makeXxxRoutes(db) DI factories.
//
// Behavior proven here:
//   • Reorder RE-PRICES each line at the currently selected open round (a dated-
//     today override wins — the SAME rule as orders.ts) and NEVER reuses the old
//     order's frozen snapshot price (T-02-35 / D-20).
//   • An item now sold-out in that round is FLAGGED (not silently duplicated) and
//     is left OUT of the proposed cart (D-20).
//   • History + reorder are MEMBER-ONLY: a session for a customer with a
//     line_user_id succeeds; a guest (no line_user_id) is rejected 403, and a
//     missing token is 401 (D-19 / T-02-33 / T-02-34).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, roundStock } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeMeOrdersRoutes } from "../src/routes/me-orders";
import { makeOrdersRoutes } from "../src/routes/orders";
import {
  seedPrice,
  seedRound,
  seedRoundStock,
  seedSaleUnit,
  seedVariety,
} from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// A no-op hold scheduler: these order-creation calls run without a pg-boss worker.
const noopScheduler = async () => {};

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
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

/** Insert a member/guest customer and return its id. */
async function seedCustomer(lineUserId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: lineUserId !== null, lineUserId, name: "ลูกค้าทดสอบ" })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: insert returned no row");
  return row.id;
}

describe("member reorder + history (CUST-04 / LINE-02 / D-19 / D-20)", () => {
  test("reorder re-prices at the current round and flags a sold-out item", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // ── Arrange ONE open round with two sellable varieties (single-round order) ──
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    // A: reprice target — 250 g pack, ฿200/kg default → ฿50.00 (5000 satang).
    const vA = await seedVariety(db, `A ${crypto.randomUUID()}`);
    const suA = await seedSaleUnit(db, vA, { label: "250g", gramsPerUnit: 250, plantsPerUnit: 2 });
    await seedRoundStock(db, roundId, vA, 100);
    await seedPrice(db, roundId, vA, "b2c", 20000, null); // ฿200/kg → ฿50 pack
    // B: sold-out target — same round, own stock.
    const vB = await seedVariety(db, `B ${crypto.randomUUID()}`);
    const suB = await seedSaleUnit(db, vB, { label: "250g", gramsPerUnit: 250, plantsPerUnit: 2 });
    await seedRoundStock(db, roundId, vB, 100);
    await seedPrice(db, roundId, vB, "b2c", 20000, null);

    const customerId = await seedCustomer(`U_${crypto.randomUUID()}`);

    // Place the original order (member path) — freezes the ฿50 snapshot on A + B.
    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const created = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: { customerId },
          lines: [
            { roundId, varietyId: vA, saleUnitId: suA, qty: 2 },
            { roundId, varietyId: vB, saleUnitId: suB, qty: 1 },
          ],
        }),
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as { id: string };

    // Mutate the CURRENT round: A gets a dated-today price override (฿300/kg →
    // ฿75.00), B is depleted so it is sold-out for the reorder.
    await seedPrice(db, roundId, vA, "b2c", 30000, today); // dated-today wins → ฿75 pack
    await db
      .update(roundStock)
      .set({ reservedPlants: 100 }) // reserved == quota → availability 0
      .where(and(eq(roundStock.roundId, roundId), eq(roundStock.varietyId, vB)));

    // ── Act: reorder as the member ──────────────────────────────────────────────
    const me = makeMeOrdersRoutes(db);
    const token = await issueSession(customerId, "customer");
    const res = await me.handle(
      new Request(`http://localhost/me/orders/${order.id}/reorder`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cart: { lines: { varietyId: string; saleUnitId: string; qty: number }[] };
      items: {
        varietyId: string | null;
        unitPriceSatang: number | null;
        oldUnitPriceSatang: number | null;
        available: boolean;
        soldOut: boolean;
        reason: string | null;
      }[];
      hasUnavailable: boolean;
    };

    // A: re-priced at the CURRENT round (฿75.00), differing from the ฿50 snapshot.
    const a = body.items.find((i) => i.varietyId === vA);
    expect(a?.oldUnitPriceSatang).toBe(5000); // the frozen old snapshot
    expect(a?.unitPriceSatang).toBe(7500); // re-resolved at the dated-today price
    expect(a?.unitPriceSatang).not.toBe(a?.oldUnitPriceSatang); // never reuses snapshot
    expect(a?.available).toBe(true);

    // B: flagged sold-out — NOT blindly duplicated, and left out of the cart.
    const b = body.items.find((i) => i.varietyId === vB);
    expect(b?.available).toBe(false);
    expect(b?.soldOut).toBe(true);
    expect(b?.reason).toBe("sold_out");

    // The proposed cart carries A only; hasUnavailable warns the customer (D-20).
    expect(body.cart.lines.map((l) => l.varietyId)).toEqual([vA]);
    expect(body.hasUnavailable).toBe(true);
  });

  test("history is scoped to the member and guests are rejected", async () => {
    // A member with an order sees exactly their own order.
    const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
    const v = await seedVariety(db, `V ${crypto.randomUUID()}`);
    const su = await seedSaleUnit(db, v, { label: "250g", gramsPerUnit: 250, plantsPerUnit: 2 });
    await seedRoundStock(db, roundId, v, 100);
    await seedPrice(db, roundId, v, "b2c", 20000, null);
    const memberId = await seedCustomer(`U_${crypto.randomUUID()}`);

    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const created = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: { customerId: memberId },
          lines: [{ roundId, varietyId: v, saleUnitId: su, qty: 1 }],
        }),
      }),
    );
    const order = (await created.json()) as { id: string };

    const me = makeMeOrdersRoutes(db);
    const memberToken = await issueSession(memberId, "customer");
    const hist = await me.handle(
      new Request("http://localhost/me/orders", {
        method: "GET",
        headers: { authorization: `Bearer ${memberToken}` },
      }),
    );
    expect(hist.status).toBe(200);
    const histBody = (await hist.json()) as { orders: { id: string }[] };
    expect(histBody.orders.some((o) => o.id === order.id)).toBe(true);
    // Every returned order belongs to THIS member (no cross-customer leakage).
    expect(histBody.orders.length).toBeGreaterThanOrEqual(1);

    // A guest (customer with no line_user_id) is rejected 403 (D-19 / T-02-34).
    const guestId = await seedCustomer(null);
    const guestToken = await issueSession(guestId, "customer");
    const guest = await me.handle(
      new Request("http://localhost/me/orders", {
        method: "GET",
        headers: { authorization: `Bearer ${guestToken}` },
      }),
    );
    expect(guest.status).toBe(403);

    // A missing token is 401.
    const anon = await me.handle(
      new Request("http://localhost/me/orders", { method: "GET" }),
    );
    expect(anon.status).toBe(401);
  });
});
