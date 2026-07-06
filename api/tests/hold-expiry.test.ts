// PAY-03 (release half) / D-09 — the hold-expiry job. Raced against real
// PostgreSQL 17 (:55432). expireHold() cancels an UNPAID hold and releases EXACTLY
// the reserved plants, but is a safe NO-OP on a paid order (onlyIfHold gate,
// Pitfall 1 / T-02-25) AND on an order whose slip is under human review
// (awaiting_review, D-04 ↔ D-09). sweepExpiredHolds() self-heals stranded holds
// past holdExpiresAt (Pitfall 2 / T-02-26).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { payments } from "../src/db/schema";
import { expireHold, sweepExpiredHolds } from "../src/jobs/boss";
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

async function statusOf(orderId: string): Promise<string | undefined> {
  const [row] = (await db.execute(
    sql`SELECT status FROM orders WHERE id = ${orderId}`,
  )) as unknown as { status: string }[];
  return row?.status;
}

/** Place a real order (status=created) via the open POST endpoint; return its ids. */
async function placeOrder() {
  const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
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
  return { orderId: id, roundId: seed.roundId, varietyId: seed.varietyId };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("hold expiry (PAY-03 / D-09)", () => {
  test("cancels an awaiting_payment order and releases exactly the reserved plants", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    await db.execute(sql`UPDATE orders SET status = 'awaiting_payment' WHERE id = ${orderId}`);
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const cancelled = await expireHold(db, orderId);

    expect(cancelled).toBe(true);
    expect(await statusOf(orderId)).toBe("cancelled");
    expect(await reservedPlants(roundId, varietyId)).toBe(0); // released exactly once
  });

  test("is a NO-OP on a paid order (never releases already-sold stock)", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    await db.execute(sql`UPDATE orders SET status = 'paid' WHERE id = ${orderId}`);
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const cancelled = await expireHold(db, orderId);

    expect(cancelled).toBe(false);
    expect(await statusOf(orderId)).toBe("paid"); // untouched
    expect(await reservedPlants(roundId, varietyId)).toBe(2); // stock NOT released
  });

  test("skips an order whose slip is under review (awaiting_review — D-04 ↔ D-09)", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    await db.execute(sql`UPDATE orders SET status = 'awaiting_payment' WHERE id = ${orderId}`);
    // A slip was uploaded but the verifier was unavailable → parked for an admin.
    await db.insert(payments).values({ orderId, status: "awaiting_review" });
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const cancelled = await expireHold(db, orderId);

    expect(cancelled).toBe(false);
    expect(await statusOf(orderId)).toBe("awaiting_payment"); // pending admin confirm
    expect(await reservedPlants(roundId, varietyId)).toBe(2); // stock still held
  });

  test("sweepExpiredHolds self-heals a stranded past-deadline hold (Pitfall 2)", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    // Simulate a checkout that landed awaiting_payment with a deadline already in the
    // past, but whose per-order timer was never scheduled (commit-then-crash window).
    await db.execute(
      sql`UPDATE orders SET status = 'awaiting_payment', hold_expires_at = now() - interval '1 minute' WHERE id = ${orderId}`,
    );
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const healed = await sweepExpiredHolds(db);

    expect(healed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(orderId)).toBe("cancelled");
    expect(await reservedPlants(roundId, varietyId)).toBe(0);
  });
});
