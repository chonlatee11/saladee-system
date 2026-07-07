// PAY-03 / D-11 — re-showing the checkout QR is IDEMPOTENT. The hold-expiry timer
// is scheduled EXACTLY ONCE, at order creation, with singletonKey=orderId; GET
// /orders/:id/qr re-renders the SAME stored payload and NEVER schedules a second
// timer nor extends the hold. Also proves the checkout path (02-04): a delivery
// choice lands the order `awaiting_payment` with a QR whose amount = subtotal+fee
// (Pitfall 5) and a snapshotted holdExpiresAt. Raced against real PostgreSQL 17.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { orders } from "../src/db/schema";
import { type HoldExpiryScheduler, makeOrdersRoutes } from "../src/routes/orders";
import { makePaymentsRoutes } from "../src/routes/payments";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// Records every hold-expiry schedule call so the test can assert it fires exactly
// once (a spy standing in for the real pg-boss worker, which isn't started here).
const scheduleCalls: { orderId: string; holdWindowSeconds: number }[] = [];
const spyScheduler: HoldExpiryScheduler = async (orderId, holdWindowSeconds) => {
  scheduleCalls.push({ orderId, holdWindowSeconds });
};

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

describe("checkout QR + hold schedule idempotency (PAY-03 / D-11)", () => {
  test("checkout lands awaiting_payment with a fee-inclusive QR + one scheduled timer", async () => {
    scheduleCalls.length = 0;
    const routes = makeOrdersRoutes(db, spyScheduler);
    const seed = await seedSellableLine(db, {
      quotaPlants: 100,
      plantsPerUnit: 2,
      gramsPerUnit: 250,
      pricePerKgSatang: 20000, // → unit price ฿50 (5000 satang); subtotal ฿50
    });
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
          deliveryMethod: "self", // samut_prakan self fee = ฿20 (2000 satang)
          deliveryZone: "samut_prakan",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      status: string;
      subtotalSatang: number;
      deliveryFeeSatang: number;
      totalSatang: number;
      qr: string;
    };

    // Checkout semantics: awaiting_payment + fee snapshot + full total.
    expect(created.status).toBe("awaiting_payment");
    expect(created.subtotalSatang).toBe(5000);
    expect(created.deliveryFeeSatang).toBe(2000);
    expect(created.totalSatang).toBe(7000); // subtotal + fee
    expect(created.qr.startsWith("data:image/png;base64,")).toBe(true);

    // The order row carries the delivery + hold snapshot.
    const [row] = await db
      .select({
        status: orders.status,
        qrPayload: orders.qrPayload,
        holdExpiresAt: orders.holdExpiresAt,
        deliveryMethod: orders.deliveryMethod,
        deliveryZone: orders.deliveryZone,
        deliveryFeeSatang: orders.deliveryFeeSatang,
      })
      .from(orders)
      .where(eq(orders.id, created.id))
      .limit(1);
    expect(row?.deliveryMethod).toBe("self");
    expect(row?.deliveryZone).toBe("samut_prakan");
    expect(row?.deliveryFeeSatang).toBe(2000);
    expect(row?.holdExpiresAt).not.toBeNull();
    // QR amount is the FULL total ฿70.00, not the subtotal ฿50.00 (Pitfall 5).
    expect(row?.qrPayload).toContain("70.00");
    expect(row?.qrPayload).not.toContain("50.00");

    // The hold-expiry timer was scheduled EXACTLY ONCE for this order.
    expect(scheduleCalls.length).toBe(1);
    expect(scheduleCalls[0]?.orderId).toBe(created.id);
    expect(scheduleCalls[0]?.holdWindowSeconds).toBeGreaterThan(0);

    // Re-showing the QR is idempotent: same payload, and NO second timer scheduled.
    const payments = makePaymentsRoutes(db);
    const getQr = () =>
      payments.handle(new Request(`http://localhost/orders/${created.id}/qr`, { method: "GET" }));
    const q1 = (await (await getQr()).json()) as { qrPayload: string; qr: string; status: string };
    const q2 = (await (await getQr()).json()) as { qrPayload: string; qr: string; status: string };
    expect(q1.qrPayload).toBe(row?.qrPayload ?? "");
    expect(q2.qrPayload).toBe(q1.qrPayload); // identical bytes every call
    expect(q1.qr).toBe(q2.qr);
    expect(q1.status).toBe("awaiting_payment");
    // GET /qr scheduled NOTHING — the timer count is unchanged (D-11).
    expect(scheduleCalls.length).toBe(1);
  });

  test("GET /orders/:id/qr on a legacy (no-delivery) order → 409 no_qr", async () => {
    const routes = makeOrdersRoutes(db, spyScheduler);
    const seed = await seedSellableLine(db, { quotaPlants: 10, plantsPerUnit: 2 });
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
    const created = (await res.json()) as { id: string; status: string };
    expect(created.status).toBe("created"); // legacy path untouched
    const payments = makePaymentsRoutes(db);
    const qr = await payments.handle(
      new Request(`http://localhost/orders/${created.id}/qr`, { method: "GET" }),
    );
    expect(qr.status).toBe(409);
    expect((await qr.json()) as { error: string }).toEqual({ error: "no_qr" });
  });
});
