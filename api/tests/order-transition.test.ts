// D-09 / RESEARCH Pitfall 1 / T-02-01 — the shared guarded transition. The
// onlyIfHold option (delivered in 02-01, consumed by the 02-07 hold-expiry job)
// must cancel+release an UNPAID hold but be a safe NO-OP on a paid order, so a
// late-firing expiry timer can never cancel a just-paid order and wrongly release
// its (now sold) stock. Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { applyTransition } from "../src/services/order-transition";
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
        lines: [{ roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 }],
      }),
    }),
  );
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return { orderId: id, roundId: seed.roundId, varietyId: seed.varietyId };
}

async function statusOf(orderId: string): Promise<string | undefined> {
  const [row] = (await db.execute(
    sql`SELECT status FROM orders WHERE id = ${orderId}`,
  )) as unknown as { status: string }[];
  return row?.status;
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

describe("applyTransition onlyIfHold (D-09 / T-02-01)", () => {
  test("cancels an awaiting_payment hold and releases exactly the reserved plants", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    await db.execute(sql`UPDATE orders SET status = 'awaiting_payment' WHERE id = ${orderId}`);
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const result = await db.transaction((tx) =>
      applyTransition(tx, orderId, "cancelled", { onlyIfHold: true }),
    );

    expect(result).toMatchObject({ applied: true, status: "cancelled" });
    expect(await statusOf(orderId)).toBe("cancelled");
    expect(await reservedPlants(roundId, varietyId)).toBe(0); // released exactly once
  });

  test("is a NO-OP on a paid order — never releases already-sold stock", async () => {
    const { orderId, roundId, varietyId } = await placeOrder();
    await db.execute(sql`UPDATE orders SET status = 'paid' WHERE id = ${orderId}`);
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    const result = await db.transaction((tx) =>
      applyTransition(tx, orderId, "cancelled", { onlyIfHold: true }),
    );

    expect(result).toMatchObject({ applied: false, status: "paid" });
    expect(await statusOf(orderId)).toBe("paid"); // untouched
    expect(await reservedPlants(roundId, varietyId)).toBe(2); // stock NOT released
  });
});
