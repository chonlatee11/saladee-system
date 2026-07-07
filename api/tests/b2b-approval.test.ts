// CUST-02 / D-08 — B2B account approval + wholesale-price visibility gate. A B2B
// applicant starts `pending`; a staff member (owner/admin) approves or rejects.
// Only an APPROVED customer may see the b2b (wholesale) tier price — a pending or
// non-B2B customer is refused (403), so wholesale prices never leak to unapproved
// accounts (T-03-14). Every b2b endpoint is requireRole("owner","admin") (T-03-15):
// no token → 401, a customer session → 403. Raced against real PostgreSQL 17
// (:55432) via the makeB2bRoutes(db) DI factory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers, quotaOverflowFlags } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeB2bRoutes } from "../src/routes/b2b";
import { seedPrice, seedStockRow } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let b2bRoutes: ReturnType<typeof makeB2bRoutes>;
let admin: string;
let customerToken: string;

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

/** Insert a customer with an optional b2bStatus and return its id. */
async function seedCustomer(
  b2bStatus: "pending" | "approved" | "rejected" | null,
): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ name: `B2B ${crypto.randomUUID()}`, b2bStatus })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: insert returned no row");
  return row.id;
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  b2bRoutes = makeB2bRoutes(db);
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
  admin = await issueSession(crypto.randomUUID(), "admin");
  customerToken = await issueSession(crypto.randomUUID(), "customer");
});

afterAll(async () => {
  await client?.end();
});

describe("B2B approval (D-08 / CUST-02)", () => {
  test("pending → approve sets approved + b2bApprovedAt; appears no longer pending", async () => {
    const id = await seedCustomer("pending");

    const pendingBefore = await fire(b2bRoutes, "GET", "/b2b/pending", { token: admin });
    const listBefore = (await pendingBefore.json()) as { id: string }[];
    expect(listBefore.some((c) => c.id === id)).toBe(true);

    const res = await fire(b2bRoutes, "POST", `/b2b/${id}/approve`, { token: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { b2bStatus: string; b2bApprovedAt: string | null };
    expect(body.b2bStatus).toBe("approved");
    expect(body.b2bApprovedAt).not.toBeNull();

    const pendingAfter = await fire(b2bRoutes, "GET", "/b2b/pending", { token: admin });
    const listAfter = (await pendingAfter.json()) as { id: string }[];
    expect(listAfter.some((c) => c.id === id)).toBe(false);
  });

  test("pending → reject sets rejected", async () => {
    const id = await seedCustomer("pending");
    const res = await fire(b2bRoutes, "POST", `/b2b/${id}/reject`, { token: admin });
    expect(res.status).toBe(200);
    expect((await res.json()) as { b2bStatus: string }).toMatchObject({ b2bStatus: "rejected" });
  });

  test("credit-terms records free text (D-11, no credit-limit blocking)", async () => {
    const id = await seedCustomer("approved");
    const res = await fire(b2bRoutes, "PATCH", `/b2b/${id}/credit-terms`, {
      token: admin,
      body: { creditTerms: "เครดิต 30 วัน วางบิลทุกสิ้นเดือน" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { creditTerms: string }).toMatchObject({
      creditTerms: "เครดิต 30 วัน วางบิลทุกสิ้นเดือน",
    });
  });
});

describe("wholesale-price visibility gate (D-08 / T-03-14)", () => {
  test("approved customer sees the b2b tier price; pending customer is refused (403)", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 100);
    await seedPrice(db, roundId, varietyId, "b2b", 15000, null);

    const approved = await seedCustomer("approved");
    const okRes = await fire(
      b2bRoutes,
      "GET",
      `/b2b/${approved}/prices?roundId=${roundId}&varietyId=${varietyId}`,
      { token: admin },
    );
    expect(okRes.status).toBe(200);
    expect((await okRes.json()) as { tier: string; pricePerKgSatang: number }).toMatchObject({
      tier: "b2b",
      pricePerKgSatang: 15000,
    });

    const pending = await seedCustomer("pending");
    const gateRes = await fire(
      b2bRoutes,
      "GET",
      `/b2b/${pending}/prices?roundId=${roundId}&varietyId=${varietyId}`,
      { token: admin },
    );
    expect(gateRes.status).toBe(403);
  });
});

describe("RBAC gate — every b2b endpoint is staff-only (T-03-15)", () => {
  test("no token → 401", async () => {
    const res = await fire(b2bRoutes, "GET", "/b2b/pending");
    expect(res.status).toBe(401);
  });
  test("customer session → 403", async () => {
    const res = await fire(b2bRoutes, "GET", "/b2b/pending", { token: customerToken });
    expect(res.status).toBe(403);
  });
  test("admin session → 200", async () => {
    const res = await fire(b2bRoutes, "GET", "/b2b/pending", { token: admin });
    expect(res.status).toBe(200);
  });
});

describe("overflow flags read (D-10)", () => {
  test("GET /b2b/overflow-flags surfaces unresolved flags with the variety name", async () => {
    const { roundId, varietyId } = await seedStockRow(db, 50);
    await db
      .insert(quotaOverflowFlags)
      .values({ roundId, varietyId, shortfall: 30, source: "b2b" });

    const res = await fire(b2bRoutes, "GET", "/b2b/overflow-flags", { token: admin });
    expect(res.status).toBe(200);
    const flags = (await res.json()) as {
      varietyId: string;
      varietyName: string;
      shortfall: number;
      source: string;
    }[];
    const flag = flags.find((f) => f.varietyId === varietyId);
    expect(flag).toBeDefined();
    expect(flag?.shortfall).toBe(30);
    expect(flag?.source).toBe("b2b");
    expect(typeof flag?.varietyName).toBe("string");
  });
});

describe("standing-order CRUD (CUST-05)", () => {
  test("create standing order + items, list it, then cancel (soft)", async () => {
    const customerId = await seedCustomer("approved");
    const { varietyId } = await seedStockRow(db, 100);

    const createRes = await fire(b2bRoutes, "POST", "/b2b/standing-orders", {
      token: admin,
      body: { customerId, items: [{ varietyId, plantsPerRound: 40 }] },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      items: { varietyId: string; plantsPerRound: number }[];
    };
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.plantsPerRound).toBe(40);

    const listRes = await fire(b2bRoutes, "GET", "/b2b/standing-orders", { token: admin });
    const list = (await listRes.json()) as { id: string; active: boolean }[];
    expect(list.some((s) => s.id === created.id)).toBe(true);

    const cancelRes = await fire(b2bRoutes, "DELETE", `/b2b/standing-orders/${created.id}`, {
      token: admin,
    });
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()) as { active: boolean }).toMatchObject({ active: false });
  });
});
