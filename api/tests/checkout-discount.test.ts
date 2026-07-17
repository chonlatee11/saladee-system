// Checkout discount composition (04-03 / MKT-01 + CUST-03, T-04-07/08/09). The money
// slice's headline invariants, end-to-end against real PostgreSQL 17 (:55432):
//
//   • A percent coupon + redeemed points compose into the order tx AFTER reserve()
//     and BEFORE the PromptPay QR, and the net stays whole baht (netSatang % 100 === 0,
//     Pitfall 1 / T-04-09).
//   • The persisted order carries discount_satang > 0 and total = subtotal + fee −
//     discount; GET /orders/:id/qr re-renders that SAME net (Pitfall 2).
//   • payments.ts expectedAmountSatang subtracts the discount, so a correct slip
//     AUTO-PAYS (status paid, not parked awaiting_review — T-04-08).
//   • Entering `paid` credits loyalty points ONCE (idempotent — Pitfall 4).
//
// The client sends only a coupon CODE + a bounded points integer — never a money
// value (T-04-07); the server resolves every satang.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { coupons, customers, loyaltyLedger, orders } from "../src/db/schema";
import { type HoldExpiryScheduler, makeOrdersRoutes } from "../src/routes/orders";
import { makePaymentsRoutes } from "../src/routes/payments";
import { earnPoints, getBalance } from "../src/services/loyalty";
import type { SlipVerifier } from "../src/services/slip-verify";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const noopScheduler: HoldExpiryScheduler = async () => {};

/** A member customer (is_member=true + line_user_id) so earn/redeem are allowed. */
async function seedMember(): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      isMember: true,
      name: `Member ${crypto.randomUUID()}`,
      lineUserId: `U${crypto.randomUUID().slice(0, 12)}`,
    })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedMember: no row");
  return row.id;
}

async function creditPoints(customerId: string, points: number): Promise<void> {
  await db.insert(loyaltyLedger).values({ customerId, kind: "earn", points });
}

async function seedPercentCoupon(percent: number): Promise<string> {
  const code = `PCT-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(coupons).values({
    code,
    discountKind: "percent",
    discountValue: percent,
    applicability: { segments: ["b2c"] },
  });
  return code;
}

/** A verifier that asserts the route recomputed the DISCOUNTED expected amount, then
 *  returns clean echoing it so the satang compare is never the failing arbiter. */
function expectAmountVerifier(wantSatang: number, transRef: string): SlipVerifier {
  return {
    verify: async ({ expectedAmountSatang }) => {
      expect(expectedAmountSatang).toBe(wantSatang); // Pitfall 2 / T-04-08
      return {
        status: "clean",
        transRef,
        amountSatang: expectedAmountSatang,
        payeeOk: true,
        raw: { echo: "clean" },
      };
    },
  };
}

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

describe("checkout discount composition (MKT-01 + CUST-03)", () => {
  test("percent coupon + points → whole-baht net QR, discounted expected amount auto-pays, earn once", async () => {
    // 800 baht/kg × 250 g = 200 baht = 20000 satang subtotal (≥100 baht so earn ≥ 1).
    const seed = await seedSellableLine(db, {
      quotaPlants: 100,
      plantsPerUnit: 2,
      gramsPerUnit: 250,
      pricePerKgSatang: 80000,
    });
    const customerId = await seedMember();
    await creditPoints(customerId, 100); // balance 100 so redeeming 10 is allowed
    const couponCode = await seedPercentCoupon(10);

    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const res = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: { customerId, recipientName: "ผู้รับ", recipientPhone: "0800000000", recipientAddress: "1 ถนนสลัด" },
          lines: [{ roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 }],
          deliveryMethod: "self",
          deliveryZone: "samut_prakan",
          couponCode,
          redeemPoints: 10,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      status: string;
      subtotalSatang: number;
      deliveryFeeSatang: number | null;
      totalSatang: number;
      discountSatang: number;
    };
    expect(created.status).toBe("awaiting_payment");

    const fee = created.deliveryFeeSatang ?? 0;
    // 10% of 20000 = 2000 satang (coupon) + 10 points × 1 baht = 1000 satang.
    expect(created.discountSatang).toBe(3000);
    const net = created.subtotalSatang + fee - 3000;
    expect(created.totalSatang).toBe(net);
    expect(net % 100).toBe(0); // whole-baht QR invariant (T-04-09)

    // Points were redeemed at checkout (balance 100 → 90); earn has not fired yet.
    expect(await getBalance(db, customerId)).toBe(90);

    // The persisted order reflects the discount.
    const [ord] = await db
      .select({ discountSatang: orders.discountSatang, qrPayload: orders.qrPayload })
      .from(orders)
      .where(eq(orders.id, created.id))
      .limit(1);
    expect(ord?.discountSatang).toBe(3000);
    expect(ord?.qrPayload).toBeTruthy();

    // GET /orders/:id/qr re-renders the SAME net total (Pitfall 2).
    const paymentsRoutes = makePaymentsRoutes(db, {
      verifier: expectAmountVerifier(net, `TX-DISC-${crypto.randomUUID()}`),
      compress: async (b) => b,
      putSlip: async () => {},
    });
    const qrRes = await paymentsRoutes.handle(
      new Request(`http://localhost/orders/${created.id}/qr`, { method: "GET" }),
    );
    expect(qrRes.status).toBe(200);
    expect(((await qrRes.json()) as { totalSatang: number }).totalSatang).toBe(net);

    // A correct slip for the DISCOUNTED amount auto-pays (not awaiting_review).
    const form = new FormData();
    form.append("slip", new File([new Uint8Array([1, 2, 3, 4])], "slip.jpg", { type: "image/jpeg" }));
    const slipRes = await paymentsRoutes.handle(
      new Request(`http://localhost/orders/${created.id}/slip`, { method: "POST", body: form }),
    );
    expect(slipRes.status).toBe(200);
    expect(((await slipRes.json()) as { status: string }).status).toBe("paid");

    // Entering paid credited loyalty points ONCE: subtotal 200 baht × rate 1 = 2 points.
    const earnRows = (await db.select().from(loyaltyLedger).where(eq(loyaltyLedger.orderId, created.id)))
      .filter((r) => r.kind === "earn");
    expect(earnRows).toHaveLength(1);
    expect(earnRows[0]?.points).toBe(2);
    expect(await getBalance(db, customerId)).toBe(92); // 90 + 2 earned

    // Re-crediting the same order is a no-op (partial UNIQUE(order_id) WHERE kind=earn).
    await db.transaction((tx) => earnPoints(tx, created.id));
    expect(await getBalance(db, customerId)).toBe(92);
  });

  test("a checkout with no coupon/points is unchanged (net = subtotal + fee, no discount)", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 50, plantsPerUnit: 2, gramsPerUnit: 250, pricePerKgSatang: 20000 });
    const ordersRoutes = makeOrdersRoutes(db, noopScheduler);
    const res = await ordersRoutes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: "b2c",
          customer: { name: "ลูกค้า", phone: "0800000000", recipientName: "ผู้รับ", recipientPhone: "0800000000", recipientAddress: "1 ถนนสลัด" },
          lines: [{ roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 }],
          deliveryMethod: "self",
          deliveryZone: "samut_prakan",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      subtotalSatang: number;
      deliveryFeeSatang: number | null;
      totalSatang: number;
      discountSatang: number;
    };
    expect(created.discountSatang).toBe(0);
    expect(created.totalSatang).toBe(created.subtotalSatang + (created.deliveryFeeSatang ?? 0));
  });
});
