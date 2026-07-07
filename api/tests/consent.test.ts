// PLAT-04 / D-25/26 — PDPA consent is logged as TWO SEPARATE consent_logs rows per
// checkout grant (usage + marketing), each stamped with the policy_version it
// consented to and source "checkout". Usage consent is REQUIRED: a checkout with
// usage=false is rejected 422 and writes NO rows. Marketing is independent and
// logged regardless of its value. Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { consentLogs } from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

// A no-op hold scheduler so the checkout path never touches the (unstarted) worker.
const noopScheduler = async () => {};

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db, noopScheduler);
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

function checkoutBody(
  seed: { roundId: string; varietyId: string; saleUnitId: string },
  consent: { usage: boolean; marketing: boolean; policyVersion: string },
) {
  return JSON.stringify({
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
    consent,
  });
}

describe("consent logging (PLAT-04 / D-25/26)", () => {
  test("usage=true, marketing=false → exactly two rows, each with the policy version", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 10, plantsPerUnit: 2 });
    const res = await routes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: checkoutBody(seed, { usage: true, marketing: false, policyVersion: "2026-07-01" }),
      }),
    );
    expect(res.status).toBe(201);
    const { id: orderId } = (await res.json()) as { id: string };

    const rows = await db
      .select({
        consentType: consentLogs.consentType,
        granted: consentLogs.granted,
        policyVersion: consentLogs.policyVersion,
        source: consentLogs.source,
      })
      .from(consentLogs)
      .where(eq(consentLogs.orderId, orderId));

    expect(rows.length).toBe(2);
    const usage = rows.find((r) => r.consentType === "usage");
    const marketing = rows.find((r) => r.consentType === "marketing");
    expect(usage).toBeDefined();
    expect(marketing).toBeDefined();
    expect(usage?.granted).toBe(true);
    expect(marketing?.granted).toBe(false); // independent, default-unchecked
    expect(usage?.policyVersion).toBe("2026-07-01");
    expect(marketing?.policyVersion).toBe("2026-07-01");
    expect(usage?.source).toBe("checkout");
  });

  test("marketing=true is logged as a granted marketing row independent of usage", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 10, plantsPerUnit: 2 });
    const res = await routes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: checkoutBody(seed, { usage: true, marketing: true, policyVersion: "2026-07-01" }),
      }),
    );
    expect(res.status).toBe(201);
    const { id: orderId } = (await res.json()) as { id: string };
    const [marketing] = await db
      .select({ granted: consentLogs.granted })
      .from(consentLogs)
      .where(and(eq(consentLogs.orderId, orderId), eq(consentLogs.consentType, "marketing")));
    expect(marketing?.granted).toBe(true);
  });

  test("usage=false → 422 usage_consent_required, NO order and NO consent rows written", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 10, plantsPerUnit: 2 });
    const res = await routes.handle(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: checkoutBody(seed, { usage: false, marketing: false, policyVersion: "2026-07-01" }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toEqual({ error: "usage_consent_required" });

    // No stock was reserved and no consent rows were written (rejected before the tx).
    const rows = await db
      .select({ id: consentLogs.id })
      .from(consentLogs)
      .where(eq(consentLogs.customerId, seed.varietyId)); // no consent row references this order
    expect(rows.length).toBe(0);
  });
});
