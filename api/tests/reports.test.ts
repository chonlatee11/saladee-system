// Sales-reports aggregate + RBAC (03-11 / MKT-04, D-24). ONE staff-gated GET
// /reports returns sales-by-channel series, best-sellers, repeat-customers and AOV
// as SERVER-side aggregates over the existing tables (read-only, integer satang).
// Races against real PostgreSQL 17 (:55432) via makeReportsRoutes(db) DI — mirrors
// dashboard.test.ts. Every assertion pins ?round to THIS test's round so the
// figures are deterministic regardless of other rows in the shared test DB.
//
//   • channel split: a subscription-generated order (present in subscription_orders)
//     counts as "subscription", not its tier; b2c/b2b are the tier otherwise.
//   • best-sellers rank by qty across order_lines; AOV = Σsubtotal/Σorders.
//   • money stays integer satang; RBAC (T-03-28): no token → 401, customer → 403.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  customers,
  orderLines,
  orders,
  subscriptionOrders,
  subscriptions,
} from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeReportsRoutes } from "../src/routes/reports";
import { seedRound, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let reportsRoutes: ReturnType<typeof makeReportsRoutes>;
let admin: string;
let customerToken: string;

interface SeriesRow {
  key: string;
  label: string;
  valueSatang: number;
  count: number;
}
interface BestSeller {
  varietyId: string;
  variety: string;
  qty: number;
  valueSatang: number;
}
interface ReportsBody {
  series: SeriesRow[];
  bestSellers: BestSeller[];
  repeatCustomers: number;
  aovSatang: number;
  totalSatang: number;
  orderCount: number;
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
  tier: "b2c" | "b2b",
  status: (typeof schema.orderStatusEnum.enumValues)[number],
  subtotalSatang: number,
): Promise<string> {
  const [row] = await db
    .insert(orders)
    .values({ roundId, customerId, tier, status, subtotalSatang })
    .returning({ id: orders.id });
  if (!row) throw new Error("seedOrder: no row");
  return row.id;
}

async function seedLine(
  orderId: string,
  varietyId: string,
  qty: number,
  unitPriceSatang: number,
): Promise<void> {
  await db.insert(orderLines).values({
    orderId,
    lineKind: "variety",
    varietyId,
    tier: "b2c",
    qty,
    unitPriceSatang,
    plantsDecremented: 0,
  });
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  reportsRoutes = makeReportsRoutes(db);
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

describe("GET /reports aggregate (MKT-04 / D-24)", () => {
  test("series-by-channel, best-sellers, repeat-customers, AOV reflect the seeded round", async () => {
    const roundId = await seedRound(db, `R ${crypto.randomUUID()}`);
    const varietyA = await seedVariety(db, `A ${crypto.randomUUID()}`);
    const varietyB = await seedVariety(db, `B ${crypto.randomUUID()}`);

    const cust1 = await seedCustomer();
    const cust2 = await seedCustomer();
    const cust3 = await seedCustomer();

    // B2C: two orders, cust1 repeats (2 realised orders in this round).
    const o1 = await seedOrder(roundId, cust1, "b2c", "paid", 45000);
    await seedLine(o1, varietyA, 3, 15000);
    const o3 = await seedOrder(roundId, cust1, "b2c", "paid", 20000);
    await seedLine(o3, varietyA, 1, 20000);

    // B2B: one order.
    const o2 = await seedOrder(roundId, cust2, "b2b", "paid", 100000);
    await seedLine(o2, varietyB, 2, 50000);

    // Subscription: a b2c-tier order tagged as a subscription order → "subscription".
    const o4 = await seedOrder(roundId, cust3, "b2c", "paid", 30000);
    await seedLine(o4, varietyA, 2, 15000);
    const [sub] = await db
      .insert(subscriptions)
      .values({
        customerId: cust3,
        packageCode: "M",
        packageValueSatang: 30000,
        frequency: "weekly",
      })
      .returning({ id: subscriptions.id });
    if (!sub) throw new Error("seed subscription: no row");
    await db.insert(subscriptionOrders).values({ subscriptionId: sub.id, roundId, orderId: o4 });

    // Not a sale yet — must be excluded from every figure.
    await seedOrder(roundId, cust2, "b2c", "awaiting_payment", 99999);

    const res = await fire(reportsRoutes, "GET", `/reports?round=${roundId}`, { token: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportsBody;

    // ── Series by channel ──────────────────────────────────────────────────
    const byKey = Object.fromEntries(body.series.map((s) => [s.key, s]));
    expect(byKey.b2c?.valueSatang).toBe(65000); // 45000 + 20000
    expect(byKey.b2c?.count).toBe(2);
    expect(byKey.b2b?.valueSatang).toBe(100000);
    expect(byKey.b2b?.count).toBe(1);
    expect(byKey.subscription?.valueSatang).toBe(30000); // o4 counts as subscription, not b2c
    expect(byKey.subscription?.count).toBe(1);
    expect(byKey.subscription?.label).toContain("สมาชิก"); // Thai channel label

    // ── Best-sellers: varietyA (3+1+2=6) outranks varietyB (2) ─────────────
    const a = body.bestSellers.find((b) => b.varietyId === varietyA);
    const b = body.bestSellers.find((b) => b.varietyId === varietyB);
    expect(a?.qty).toBe(6);
    expect(b?.qty).toBe(2);
    expect(body.bestSellers[0]?.varietyId).toBe(varietyA); // ranked by qty desc

    // ── Repeat customers: only cust1 has >1 realised order this round ───────
    expect(body.repeatCustomers).toBe(1);

    // ── AOV: (45000+20000+100000+30000) / 4 = 48750 ────────────────────────
    expect(body.totalSatang).toBe(195000);
    expect(body.orderCount).toBe(4);
    expect(body.aovSatang).toBe(48750);
  });

  test("channel filter narrows to a single channel", async () => {
    const roundId = await seedRound(db, `R ${crypto.randomUUID()}`);
    const cust = await seedCustomer();
    await seedOrder(roundId, cust, "b2c", "paid", 10000);
    await seedOrder(roundId, cust, "b2b", "paid", 70000);

    const res = await fire(reportsRoutes, "GET", `/reports?round=${roundId}&channel=b2b`, {
      token: admin,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportsBody;
    expect(body.totalSatang).toBe(70000);
    expect(body.orderCount).toBe(1);
    expect(body.series.every((s) => s.key === "b2b")).toBe(true);
  });

  test("empty range → zeroed summary, no series", async () => {
    const res = await fire(reportsRoutes, "GET", `/reports?round=${crypto.randomUUID()}`, {
      token: admin,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportsBody;
    expect(body.series).toHaveLength(0);
    expect(body.bestSellers).toHaveLength(0);
    expect(body.repeatCustomers).toBe(0);
    expect(body.aovSatang).toBe(0);
    expect(body.totalSatang).toBe(0);
  });
});

describe("RBAC gate — reports is staff-only (T-03-28)", () => {
  test("no token → 401", async () => {
    const res = await fire(reportsRoutes, "GET", "/reports");
    expect(res.status).toBe(401);
  });
  test("customer session → 403", async () => {
    const res = await fire(reportsRoutes, "GET", "/reports", { token: customerToken });
    expect(res.status).toBe(403);
  });
  test("admin session → 200", async () => {
    const res = await fire(reportsRoutes, "GET", "/reports", { token: admin });
    expect(res.status).toBe(200);
  });
});
