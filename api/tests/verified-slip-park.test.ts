// CR-01 (phase-02 code review) — money-safety regression lock.
//
// POST /orders/:id/slip verifies the slip over a multi-second SlipOK/R2 network
// window. If the hold-expiry sweep cancels the order DURING that window (TOCTOU),
// the order is no longer collectable by the time the tx locks the row. Before CR-01
// applyTransition→paid then threw illegal_transition and rolled the WHOLE tx back —
// INCLUDING the payments INSERT — so a customer who really paid (slip verified) was
// left with NO payment row, released stock, and an orphan slip: a verified payment
// silently DROPPED. CR-01 instead persists the verified slip as `awaiting_review`
// (transRef/amount/slipKey intact) and returns 202 so an admin can reconcile.
//
// This test drives the REAL CR-01 branch deterministically: the injected verifier
// stub fires the actual hold-expiry sweep (expireHold) mid-verify, so the order is
// `cancelled` when the route re-reads it under `FOR UPDATE`. Invariant-hardening
// ONLY; production code is already fixed. Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { orders, payments } from "../src/db/schema";
import { expireHold } from "../src/jobs/boss";
import { type HoldExpiryScheduler, makeOrdersRoutes } from "../src/routes/orders";
import { makePaymentsRoutes } from "../src/routes/payments";
import type { SlipVerifier } from "../src/services/slip-verify";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

// The hold timer is irrelevant here — we drive the cancel from inside the verifier.
const noopScheduler: HoldExpiryScheduler = async () => {};

async function reservedPlants(roundId: string, varietyId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
  );
  return Number((rows[0] as { reserved_plants: number }).reserved_plants);
}

/**
 * A verifier that returns CLEAN but, BEFORE returning, fires the REAL hold-expiry
 * sweep against this order — reproducing the exact TOCTOU window where the sweep
 * cancels an awaiting_payment order while its slip is being verified. `amountSatang`
 * echoes the expected amount so the satang compare is never the failing arbiter.
 */
function sweepDuringVerify(orderId: string, transRef: string): SlipVerifier {
  return {
    verify: async ({ expectedAmountSatang }) => {
      await expireHold(db, orderId); // the sweep fires mid-verify → order cancelled + stock released
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

/** Seed a sellable line and drive a real LINE checkout → status=awaiting_payment. */
async function seedAwaitingPaymentOrder() {
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
  return { orderId: created.id, roundId: seed.roundId, varietyId: seed.varietyId };
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

describe("verified slip is parked, never dropped, when the order is cancelled mid-verify (CR-01)", () => {
  test("returns 202 and persists the verified slip as awaiting_review with transRef/amount/slipKey", async () => {
    const { orderId, roundId, varietyId } = await seedAwaitingPaymentOrder();
    expect(await reservedPlants(roundId, varietyId)).toBe(2);

    // The exact expected amount the route recomputes server-side.
    const [ord] = await db
      .select({ subtotal: orders.subtotalSatang, fee: orders.deliveryFeeSatang })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const expectedAmount = (ord?.subtotal ?? 0) + (ord?.fee ?? 0);
    expect(expectedAmount).toBeGreaterThan(0);

    const REF = `TX-CR01-${crypto.randomUUID()}`;
    // Route deps: real verifier stub (cancels mid-verify) + no-op sharp/R2 so an
    // actual slipKey is assigned (image path) without touching sharp or R2.
    const paymentsRoutes = makePaymentsRoutes(db, {
      verifier: sweepDuringVerify(orderId, REF),
      compress: async (b) => b,
      putSlip: async () => {},
    });

    // Upload a real image part so the route assigns a server-side slipKey.
    const form = new FormData();
    form.append("slip", new File([new Uint8Array([1, 2, 3, 4])], "slip.jpg", { type: "image/jpeg" }));
    const res = await paymentsRoutes.handle(
      new Request(`http://localhost/orders/${orderId}/slip`, { method: "POST", body: form }),
    );

    // CR-01: parked, NOT dropped — 202 awaiting_review (was a lossy rollback before).
    expect(res.status).toBe(202);
    expect((await res.json()) as { status: string; transRef: string }).toMatchObject({
      status: "awaiting_review",
      transRef: REF,
    });

    // The order really was cancelled by the sweep mid-verify.
    const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(o?.status).toBe("cancelled");

    // The verified payment is durable: awaiting_review with transRef/amount/slipKey intact.
    const [pay] = await db
      .select({
        status: payments.status,
        transRef: payments.transRef,
        amountSatang: payments.amountSatang,
        slipKey: payments.slipKey,
      })
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "awaiting_review")))
      .limit(1);
    expect(pay).toBeDefined();
    expect(pay?.transRef).toBe(REF);
    expect(pay?.amountSatang).toBe(expectedAmount);
    expect(pay?.slipKey).toMatch(new RegExp(`^slips/${orderId}/.+\\.jpg$`));

    // Stock was released exactly ONCE by the cancel and the parked review never
    // re-charged it — reserved is back to 0, never negative, never double-charged.
    expect(await reservedPlants(roundId, varietyId)).toBe(0);

    // Dedup UNIQUE(trans_ref) is still intact: a second slip reusing this transRef
    // is rejected by the partial unique index (the verified transRef persisted).
    // Wrap the drizzle insert in a thunk so bun's expect sees a real promise.
    await expect(
      (async () => {
        await db.insert(payments).values({ orderId, status: "awaiting_review", transRef: REF });
      })(),
    ).rejects.toThrow();
  });
});
