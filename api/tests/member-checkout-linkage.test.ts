// VR5 / LINE-02 / CUST-04 (D-04/D-19/D-21) — member LINE checkout order linkage,
// raced against the REAL PostgreSQL 17 container (:55432) via makeOrdersRoutes(db).
//
// Behavior proven here (closes Phase-2 UAT-4: empty history/detail + no status push):
//   • A logged-in member's checkout binds order.customer_id to THEIR member customer
//     id (the one bearing line_user_id) AND snapshots recipient_name/phone/address
//     from the checkout form — so history/detail populate and status push has a
//     recipient.
//   • A bare `{ customerId }`-only member body (no recipient) still creates an order
//     (recipient columns stay NULL) — the optional schema fields did not break the
//     legacy member contract that several existing tests post verbatim.
//
// A member's seedVariety defaults to deliveryClass "normal", which allows the "self"
// method (delivery.ts ALLOWED_METHODS), so `deliveryMethod:"self"` + zone
// "samut_prakan" clears the freshness gate → status awaiting_payment (the real
// LINE-checkout path), not 422.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, orders } from "../src/db/schema";
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

/** Insert a member/guest customer and return its id (mirrors reorder.test.ts). */
async function seedCustomer(lineUserId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: lineUserId !== null, lineUserId, name: "ลูกค้าทดสอบ" })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: insert returned no row");
  return row.id;
}

/** Arrange ONE open round + one sellable variety (single-round order) → its ids. */
async function seedSellable() {
  const roundId = await seedRound(db, `Round ${crypto.randomUUID()}`);
  const varietyId = await seedVariety(db, `V ${crypto.randomUUID()}`);
  const saleUnitId = await seedSaleUnit(db, varietyId, {
    label: "250g",
    gramsPerUnit: 250,
    plantsPerUnit: 2,
  });
  await seedRoundStock(db, roundId, varietyId, 100);
  await seedPrice(db, roundId, varietyId, "b2c", 20000, null); // ฿200/kg → ฿50 pack
  return { roundId, varietyId, saleUnitId };
}

describe("member LINE checkout linkage (VR5 / LINE-02 / CUST-04 / D-19 / D-21)", () => {
  test("member checkout links customer_id AND records the recipient", async () => {
    const { roundId, varietyId, saleUnitId } = await seedSellable();
    const memberId = await seedCustomer(`U_${crypto.randomUUID()}`);

    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const res = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: {
            customerId: memberId,
            recipientName: "คุณสมาชิก",
            recipientPhone: "0812345678",
            recipientAddress: "123 ถนนทดสอบ",
          },
          lines: [{ roundId, varietyId, saleUnitId, qty: 1 }],
          deliveryMethod: "self",
          deliveryZone: "samut_prakan",
          consent: { usage: true, marketing: false, policyVersion: "1.0" },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string };
    // Real LINE-checkout path: a delivery choice + consent → awaiting_payment.
    expect(created.status).toBe("awaiting_payment");

    // The order binds to the MEMBER customer id (line_user_id-bearing) and snapshots
    // the recipient columns from the checkout form.
    const [row] = await db
      .select({
        customerId: orders.customerId,
        recipientName: orders.recipientName,
        recipientPhone: orders.recipientPhone,
        recipientAddress: orders.recipientAddress,
      })
      .from(orders)
      .where(eq(orders.id, created.id))
      .limit(1);
    expect(row?.customerId).toBe(memberId);
    expect(row?.recipientName).toBe("คุณสมาชิก");
    expect(row?.recipientPhone).toBe("0812345678");
    expect(row?.recipientAddress).toBe("123 ถนนทดสอบ");
  });

  test("bare { customerId } member body still 201 with NULL recipients (backward-compat)", async () => {
    const { roundId, varietyId, saleUnitId } = await seedSellable();
    const memberId = await seedCustomer(`U_${crypto.randomUUID()}`);

    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const res = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: { customerId: memberId },
          lines: [{ roundId, varietyId, saleUnitId, qty: 1 }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string };
    // Legacy `created` path (no delivery choice) is unchanged.
    expect(created.status).toBe("created");

    const [row] = await db
      .select({
        customerId: orders.customerId,
        recipientName: orders.recipientName,
        recipientPhone: orders.recipientPhone,
        recipientAddress: orders.recipientAddress,
      })
      .from(orders)
      .where(eq(orders.id, created.id))
      .limit(1);
    expect(row?.customerId).toBe(memberId);
    expect(row?.recipientName).toBeNull();
    expect(row?.recipientPhone).toBeNull();
    expect(row?.recipientAddress).toBeNull();
  });
});
