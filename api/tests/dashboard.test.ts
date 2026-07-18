// Owner-dashboard aggregate + RBAC (03-10 / ADM-01, D-23). ONE staff-gated GET
// /dashboard returns the 5 dashboard cards as SERVER-side aggregates over the
// existing tables (no new counter, read-only). This raced against real PostgreSQL
// 17 (:55432) via makeDashboardRoutes(db) DI — mirrors b2b-approval.test.ts.
//
//   • aggregate shape: seed a round with a paid order (today), an unpaid order, a
//     near-sold-out stock row, an overflow flag, an active standing order and an
//     active subscription → every card reflects the seeded state.
//   • money stays integer satang (T-13); near-sold-out uses quota−reserved.
//   • RBAC (T-03-26): no token → 401, customer → 403, admin → 200.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  customers,
  orders,
  quotaOverflowFlags,
  roundStock,
  standingOrders,
  subscriptions,
} from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeDashboardRoutes } from "../src/routes/dashboard";
import { seedRound, seedRoundStock, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let dashboardRoutes: ReturnType<typeof makeDashboardRoutes>;
let admin: string;
let customerToken: string;

interface DashboardBody {
  hasOpenRound: boolean;
  roundId: string | null;
  salesTodaySatang: number;
  salesRoundSatang: number;
  unpaidCount: number;
  nearSoldOut: { varietyId: string; variety: string; remaining: number }[];
  nextRoundForecast: { varietyId: string; variety: string; plants: number }[];
  subsDue: number;
  standingDue: number;
  overflowFlags: { varietyId: string; variety: string; shortfall: number; source: string }[];
}

function fire(
  app: { handle: (r: Request) => Promise<Response> },
  method: string,
  path: string,
  opts: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return app.handle(new Request(`http://localhost${path}`, { method, headers }));
}

async function seedCustomer(): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ name: `Cust ${crypto.randomUUID()}` })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

async function seedOrder(
  roundId: string,
  customerId: string,
  status: (typeof schema.orderStatusEnum.enumValues)[number],
  subtotalSatang: number,
): Promise<void> {
  await db.insert(orders).values({ roundId, customerId, tier: "b2c", status, subtotalSatang });
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  dashboardRoutes = makeDashboardRoutes(db);
  await client.file("drizzle/0002_prices_default_uniq.down.sql").catch(() => {});
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
  await client.file("drizzle/0002_prices_default_uniq.sql");
  admin = await issueSession(crypto.randomUUID(), "admin");
  customerToken = await issueSession(crypto.randomUUID(), "customer");
});

afterAll(async () => {
  await client?.end();
});

describe("GET /dashboard aggregate (ADM-01 / D-23)", () => {
  test("5 cards reflect the seeded round state; money is integer satang", async () => {
    const varietyId = await seedVariety(db, `V ${crypto.randomUUID()}`);
    const roundId = await seedRound(db, `R ${crypto.randomUUID()}`);
    // Near-sold-out: quota 100, reserve 90 ⇒ remaining 10 (≤ 20%).
    const stockId = await seedRoundStock(db, roundId, varietyId, 100);
    await db.update(roundStock).set({ reservedPlants: 90 }).where(eq(roundStock.id, stockId));

    const customerId = await seedCustomer();
    await seedOrder(roundId, customerId, "paid", 45000); // realised sale (today + round)
    await seedOrder(roundId, customerId, "awaiting_payment", 12000); // unpaid, not a sale

    // Overflow flag (unresolved) for this round.
    await db.insert(quotaOverflowFlags).values({ roundId, varietyId, shortfall: 25, source: "b2b" });
    // Active standing order + active subscription (both due this round).
    await db.insert(standingOrders).values({ customerId, active: true });
    await db
      .insert(subscriptions)
      .values({ customerId, packageCode: "M", packageValueSatang: 30000, frequency: "weekly" });

    const res = await fire(dashboardRoutes, "GET", `/dashboard?roundId=${roundId}`, { token: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;

    expect(body.hasOpenRound).toBe(true);
    expect(body.roundId).toBe(roundId);
    // Only the paid order counts (integer satang); the awaiting_payment one does not.
    expect(body.salesRoundSatang).toBe(45000);
    expect(body.salesTodaySatang).toBeGreaterThanOrEqual(45000);
    expect(body.unpaidCount).toBe(1);

    const near = body.nearSoldOut.find((n) => n.varietyId === varietyId);
    expect(near).toBeDefined();
    expect(near?.remaining).toBe(10);

    const flag = body.overflowFlags.find((f) => f.varietyId === varietyId);
    expect(flag).toBeDefined();
    expect(flag?.shortfall).toBe(25);
    expect(flag?.source).toBe("b2b");

    expect(body.standingDue).toBeGreaterThanOrEqual(1);
    expect(body.subsDue).toBeGreaterThanOrEqual(1);
  });

  test("no open round → hasOpenRound:false empty summary", async () => {
    // A random non-existent roundId resolves to no round.
    const res = await fire(dashboardRoutes, "GET", `/dashboard?roundId=${crypto.randomUUID()}`, {
      token: admin,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;
    expect(body.hasOpenRound).toBe(false);
    expect(body.roundId).toBeNull();
    expect(body.nearSoldOut).toHaveLength(0);
    expect(body.salesRoundSatang).toBe(0);
  });
});

describe("RBAC gate — dashboard is staff-only (T-03-26)", () => {
  test("no token → 401", async () => {
    const res = await fire(dashboardRoutes, "GET", "/dashboard");
    expect(res.status).toBe(401);
  });
  test("customer session → 403", async () => {
    const res = await fire(dashboardRoutes, "GET", "/dashboard", { token: customerToken });
    expect(res.status).toBe(403);
  });
  test("admin session → 200", async () => {
    const res = await fire(dashboardRoutes, "GET", "/dashboard", { token: admin });
    expect(res.status).toBe(200);
  });
});
