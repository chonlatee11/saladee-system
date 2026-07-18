// Carrier delivery tracking (04-05 / DEL-05, D-22). Two layers:
//  (1) the carrier adapter seam (mirrors slip-verify): makeCarrierAdapter("manual")
//      returns the ManualCarrierAdapter (staff-entered values pass through); an
//      unknown provider throws — the one-line-swap discipline for a later Grab API.
//  (2) the admin tracking route: PATCH sets carrier + tracking_number + a defined
//      delivery_status enum and pushes a LINE Flex through the reused notify seam —
//      a member (line_user_id) gets exactly one push, a guest is skipped, a non-admin
//      is 403, an out-of-enum status is 422.
// Raced against real PostgreSQL 17 (:55432); the LINE client is mocked (no network).
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, orders } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeTrackingRoutes } from "../src/routes/tracking";
import { ManualCarrierAdapter, makeCarrierAdapter } from "../src/services/carrier";
import type { LinePush } from "../src/services/notify";
import { seedRound } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** A member has a line_user_id; a guest has none (skipped by the push guard). */
async function seedCustomer(isMember: boolean): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({
      isMember,
      name: `Cust ${crypto.randomUUID()}`,
      lineUserId: isMember ? `U${crypto.randomUUID().slice(0, 12)}` : null,
    })
    .returning({ id: customers.id, lineUserId: customers.lineUserId });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

async function seedOrder(customerId: string, roundId: string): Promise<string> {
  const [row] = await db
    .insert(orders)
    .values({ customerId, roundId, tier: "b2c", status: "paid", subtotalSatang: 20000, deliveryFeeSatang: 4000 })
    .returning({ id: orders.id });
  if (!row) throw new Error("seedOrder: no row");
  return row.id;
}

/** A DI-friendly mock LINE client (mirrors notify.test.ts) — no network call. */
function mockLine(): { line: LinePush; pushMessage: ReturnType<typeof mock> } {
  const pushMessage = mock(async () => ({}));
  return { line: { client: { pushMessage } }, pushMessage };
}

function fire(
  app: { handle: (r: Request) => Promise<Response> },
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 8 });
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

describe("carrier adapter seam (DEL-05, mirrors slip-verify)", () => {
  test('makeCarrierAdapter("manual") returns the ManualCarrierAdapter; staff values pass through', () => {
    const adapter = makeCarrierAdapter("manual");
    expect(adapter).toBeInstanceOf(ManualCarrierAdapter);
    expect(adapter.normalizeStatus("in_transit")).toBe("in_transit");
  });

  test("an unknown provider throws (fail fast, no silent fallback)", () => {
    expect(() => makeCarrierAdapter("grab")).toThrow();
  });

  test("normalizeStatus rejects a status outside the delivery_status enum", () => {
    const adapter = makeCarrierAdapter("manual");
    expect(() => adapter.normalizeStatus("teleported")).toThrow();
  });
});

describe("tracking route — PATCH sets carrier/number/status + pushes (D-22)", () => {
  test("a member order: PATCH persists the fields and fires exactly one Flex push", async () => {
    const { line, pushMessage } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const roundId = await seedRound(db);
    const custId = await seedCustomer(true);
    const orderId = await seedOrder(custId, roundId);

    const res = await fire(routes, "PATCH", `/tracking/${orderId}`, {
      token: admin,
      body: { carrier: "Grab", trackingNumber: "GRB-12345", deliveryStatus: "in_transit" },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        carrier: orders.carrier,
        trackingNumber: orders.trackingNumber,
        deliveryStatus: orders.deliveryStatus,
        trackingUpdatedAt: orders.trackingUpdatedAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(row?.carrier).toBe("Grab");
    expect(row?.trackingNumber).toBe("GRB-12345");
    expect(row?.deliveryStatus).toBe("in_transit");
    expect(row?.trackingUpdatedAt).not.toBeNull();

    // The reused notify seam pushed one Flex to the member's line_user_id.
    expect(pushMessage).toHaveBeenCalledTimes(1);
    const arg = pushMessage.mock.calls.at(0)?.at(0) as { to: string; messages: { type: string }[] };
    expect(arg.to).toMatch(/^U/);
    expect(arg.messages[0]?.type).toBe("flex");
  });

  test("a guest order (no line_user_id) is skipped silently — zero pushes", async () => {
    const { line, pushMessage } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const roundId = await seedRound(db);
    const custId = await seedCustomer(false);
    const orderId = await seedOrder(custId, roundId);

    const res = await fire(routes, "PATCH", `/tracking/${orderId}`, {
      token: admin,
      body: { carrier: "Lalamove", trackingNumber: "LLM-9", deliveryStatus: "delivered" },
    });
    expect(res.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledTimes(0);
  });

  test("GET /tracking/:orderId returns the order's tracking snapshot", async () => {
    const { line } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const roundId = await seedRound(db);
    const custId = await seedCustomer(true);
    const orderId = await seedOrder(custId, roundId);

    await fire(routes, "PATCH", `/tracking/${orderId}`, {
      token: admin,
      body: { carrier: "Grab", trackingNumber: "G-7", deliveryStatus: "handed_to_carrier" },
    });
    const getRes = await fire(routes, "GET", `/tracking/${orderId}`, { token: admin });
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { carrier: string; deliveryStatus: string };
    expect(got.carrier).toBe("Grab");
    expect(got.deliveryStatus).toBe("handed_to_carrier");
  });
});

describe("tracking route — RBAC + validation gates (T-04-15/16)", () => {
  test("a non-admin (customer) token → 403; no token → 401", async () => {
    const { line } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const customerToken = await issueSession(crypto.randomUUID(), "customer");
    const roundId = await seedRound(db);
    const orderId = await seedOrder(await seedCustomer(true), roundId);
    const body = { carrier: "Grab", trackingNumber: "X", deliveryStatus: "in_transit" };

    expect((await fire(routes, "PATCH", `/tracking/${orderId}`, { token: customerToken, body })).status).toBe(403);
    expect((await fire(routes, "PATCH", `/tracking/${orderId}`, { body })).status).toBe(401);
  });

  test("a delivery_status outside the enum → 422", async () => {
    const { line } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const roundId = await seedRound(db);
    const orderId = await seedOrder(await seedCustomer(true), roundId);

    const res = await fire(routes, "PATCH", `/tracking/${orderId}`, {
      token: admin,
      body: { carrier: "Grab", trackingNumber: "X", deliveryStatus: "lost_in_space" },
    });
    expect(res.status).toBe(422);
  });

  test("an unknown order id → 404", async () => {
    const { line } = mockLine();
    const routes = makeTrackingRoutes(db, line);
    const admin = await issueSession(crypto.randomUUID(), "admin");
    const res = await fire(routes, "PATCH", `/tracking/${crypto.randomUUID()}`, {
      token: admin,
      body: { carrier: "Grab", trackingNumber: "X", deliveryStatus: "in_transit" },
    });
    expect(res.status).toBe(404);
  });
});
