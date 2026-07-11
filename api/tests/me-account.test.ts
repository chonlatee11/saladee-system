// CUST-02 / CUST-05 / SALE-03 (03-08 LIFF customer surface) — the self-service
// subscription + B2B endpoints the LIFF calls. Security is the point of these tests:
//   • Signup resolves packageValueSatang SERVER-side from the CODE — a client can
//     never inflate the box value (T-03-20 money surface).
//   • Every /me/* route is scoped to the SESSION customer — member A never sees or
//     acts on member B's subscription/standing order (T-03-20 IDOR).
//   • Wholesale price + standing-order create stay gated on b2b_status='approved'
//     (T-03-21) — a pending/B2C member is refused (403).
// Raced against real PostgreSQL 17 (:55432) via the make*Routes(db) DI factories.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeB2bRoutes } from "../src/routes/b2b";
import { makeSubscriptionsRoutes } from "../src/routes/subscriptions";
import { seedPrice, seedStockRow } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let subs: ReturnType<typeof makeSubscriptionsRoutes>;
let b2b: ReturnType<typeof makeB2bRoutes>;

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

/** A LINE member: a customer row WITH a line_user_id + a customer session for it. */
async function seedMember(
  b2bStatus: "pending" | "approved" | "rejected" | null = null,
): Promise<{ id: string; token: string }> {
  const [row] = await db
    .insert(customers)
    .values({ name: `Member ${crypto.randomUUID()}`, lineUserId: `U${crypto.randomUUID()}`, b2bStatus })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedMember: insert returned no row");
  return { id: row.id, token: await issueSession(row.id, "customer") };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  subs = makeSubscriptionsRoutes(db);
  b2b = makeB2bRoutes(db);
  await client.file("drizzle/0002_prices_default_uniq.down.sql").catch(() => {});
  await client.file("drizzle/0004_phase3.down.sql").catch(() => {});
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
  await client.file("drizzle/0004_phase3.sql");
  await client.file("drizzle/0002_prices_default_uniq.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("subscription signup (SALE-03 / D-12)", () => {
  test("member signs up: packageValueSatang is resolved SERVER-side from the CODE (T-03-20)", async () => {
    const m = await seedMember();
    const res = await fire(subs, "POST", "/me/subscriptions", {
      token: m.token,
      // A tampered client CANNOT send a money value — the body schema has none.
      body: { packageCode: "M", frequency: "weekly" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { packageCode: string; packageValueSatang: number; status: string };
    expect(body.packageCode).toBe("M");
    expect(body.packageValueSatang).toBe(50000); // ฿500, server map — not client-set
    expect(body.status).toBe("active");
  });

  test("guest (no token) → 401; a customer without a line_user_id → 403", async () => {
    const guestRes = await fire(subs, "POST", "/me/subscriptions", {
      body: { packageCode: "S", frequency: "weekly" },
    });
    expect(guestRes.status).toBe(401);

    // A customer session whose id is not a line-linked member → 403 (D-19).
    const orphan = await issueSession(crypto.randomUUID(), "customer");
    const orphanRes = await fire(subs, "GET", "/me/subscriptions", { token: orphan });
    expect(orphanRes.status).toBe(403);
  });

  test("list is scoped to the session member — never another member's (T-03-20 IDOR)", async () => {
    const a = await seedMember();
    const b = await seedMember();
    await fire(subs, "POST", "/me/subscriptions", {
      token: a.token,
      body: { packageCode: "L", frequency: "biweekly" },
    });
    const bList = await fire(subs, "GET", "/me/subscriptions", { token: b.token });
    expect(bList.status).toBe(200);
    const bBody = (await bList.json()) as { subscriptions: unknown[] };
    expect(bBody.subscriptions).toHaveLength(0); // B never sees A's subscription
  });
});

describe("B2B customer surface (CUST-02 / CUST-05)", () => {
  test("apply flips a B2C member null → pending; status is readable", async () => {
    const m = await seedMember(null);
    const before = await fire(b2b, "GET", "/me/b2b", { token: m.token });
    expect((await before.json()) as { b2bStatus: string | null }).toMatchObject({ b2bStatus: null });

    const apply = await fire(b2b, "POST", "/me/b2b/apply", { token: m.token });
    expect(apply.status).toBe(201);
    expect((await apply.json()) as { b2bStatus: string }).toMatchObject({ b2bStatus: "pending" });
  });

  test("wholesale price is refused until approved (T-03-21)", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 100);
    await seedPrice(db, roundId, varietyId, "b2b", 15000, null);

    const pending = await seedMember("pending");
    const refused = await fire(
      b2b,
      "GET",
      `/me/b2b/prices?roundId=${roundId}&varietyId=${varietyId}`,
      { token: pending.token },
    );
    expect(refused.status).toBe(403);

    const approved = await seedMember("approved");
    const ok = await fire(
      b2b,
      "GET",
      `/me/b2b/prices?roundId=${roundId}&varietyId=${varietyId}`,
      { token: approved.token },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { pricePerKgSatang: number }).toMatchObject({
      pricePerKgSatang: 15000,
    });
  });

  test("standing order: 403 unless approved; created for the SESSION customer (T-03-20)", async () => {
    const { varietyId } = await seedStockRow(db, 100);

    const pending = await seedMember("pending");
    const refused = await fire(b2b, "POST", "/me/standing-orders", {
      token: pending.token,
      body: { items: [{ varietyId, plantsPerRound: 10 }] },
    });
    expect(refused.status).toBe(403);

    const approved = await seedMember("approved");
    const created = await fire(b2b, "POST", "/me/standing-orders", {
      token: approved.token,
      body: { items: [{ varietyId, plantsPerRound: 10 }] },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { customerId: string; items: unknown[] };
    expect(body.customerId).toBe(approved.id); // session-scoped, not a client field
    expect(body.items).toHaveLength(1);

    // The approved member sees only their own standing order.
    const mine = await fire(b2b, "GET", "/me/standing-orders", { token: approved.token });
    const mineBody = (await mine.json()) as { standingOrders: { customerId: string }[] };
    expect(mineBody.standingOrders.every((o) => o.customerId === approved.id)).toBe(true);
  });
});
