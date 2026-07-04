// PAY-02 / D-06 — system-wide slip dedup, proven against real PostgreSQL 17.
//
// Two independent orders each present a slip whose bank reference (transRef) is
// IDENTICAL. The first pays cleanly; the second is rejected 409 by the partial
// UNIQUE index payments_trans_ref_idx — the unique-violation on insert IS the
// duplicate rejection (not a vendor-only check). Also proves multiple NULL-transRef
// awaiting-review rows coexist (partial index → NULLs are not deduped).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { orders, payments } from "../src/db/schema";
import { type HoldExpiryScheduler, makeOrdersRoutes } from "../src/routes/orders";
import { makePaymentsRoutes, type PaymentsDeps } from "../src/routes/payments";
import type { SlipVerifier } from "../src/services/slip-verify";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// A no-op scheduler — the hold timer is irrelevant to dedup.
const noopScheduler: HoldExpiryScheduler = async () => {};

// A verifier that always returns a CLEAN result reusing the SAME transRef, echoing
// back the order's expected amount so the amount compare always passes. This isolates
// the DB UNIQUE index as the sole dedup arbiter.
function cleanVerifierWithRef(transRef: string): SlipVerifier {
  return {
    verify: async ({ expectedAmountSatang }) => ({
      status: "clean",
      transRef,
      amountSatang: expectedAmountSatang,
      payeeOk: true,
      raw: {},
    }),
  };
}

// Route deps that skip sharp + R2 (QR-string path stores nothing).
const testDeps = (transRef: string): PaymentsDeps => ({
  verifier: cleanVerifierWithRef(transRef),
  compress: async (b) => b,
  putSlip: async () => {},
});

async function seedAwaitingPaymentOrder(): Promise<string> {
  const seed = await seedSellableLine(db, {
    quotaPlants: 100,
    plantsPerUnit: 2,
    gramsPerUnit: 250,
    pricePerKgSatang: 20000,
  });
  const routes = makeOrdersRoutes(db, noopScheduler);
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
        deliveryMethod: "self",
        deliveryZone: "samut_prakan",
      }),
    }),
  );
  const created = (await res.json()) as { id: string; status: string };
  expect(created.status).toBe("awaiting_payment");
  return created.id;
}

// Submit a slip by QR string (no image → no R2 write needed).
async function submitSlip(orderId: string, transRef: string): Promise<Response> {
  const payments = makePaymentsRoutes(db, testDeps(transRef));
  return payments.handle(
    new Request(`http://localhost/orders/${orderId}/slip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qrPayload: "0044000600000101030066540570.00" }),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
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

describe("slip dedup — UNIQUE trans_ref (PAY-02 / D-06)", () => {
  test("a second order reusing an existing transRef is rejected 409 (system-wide)", async () => {
    const DUP = `DUP-${crypto.randomUUID()}`;
    const orderA = await seedAwaitingPaymentOrder();
    const orderB = await seedAwaitingPaymentOrder();

    // First slip pays cleanly.
    const first = await submitSlip(orderA, DUP);
    expect(first.status).toBe(200);
    expect((await first.json()) as { status: string }).toMatchObject({ status: "paid" });

    // Second slip reuses the SAME transRef → UNIQUE violation → 409 duplicate_slip.
    const second = await submitSlip(orderB, DUP);
    expect(second.status).toBe(409);
    expect((await second.json()) as { error: string }).toEqual({ error: "duplicate_slip" });

    // Order A paid; order B untouched (still awaiting_payment, its stock not lost).
    const [a] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderA)).limit(1);
    const [b] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderB)).limit(1);
    expect(a?.status).toBe("paid");
    expect(b?.status).toBe("awaiting_payment");
  });

  test("multiple NULL-transRef awaiting-review payments coexist (partial index)", async () => {
    const orderId = await seedAwaitingPaymentOrder();
    // Two under-review rows with NULL transRef must both insert (no dedup on NULL).
    await db.insert(payments).values({ orderId, status: "awaiting_review" });
    await db.insert(payments).values({ orderId, status: "awaiting_review" });
    const rows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.orderId, orderId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
