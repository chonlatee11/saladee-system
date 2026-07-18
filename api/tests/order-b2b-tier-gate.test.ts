// BLOCKER-01 (v1.0 milestone audit) — the b2b (wholesale) tier WRITE gate.
//
// The wholesale tier was gated on every READ surface (GET /catalog, /b2b/:id/prices,
// /me/b2b/prices — D-08 / T-03-21, pinned by catalog.test.ts's "b2b (wholesale) tier
// gate — 03-13") but on NO write surface: POST /orders took `body.tier` verbatim and
// resolved wholesale prices from it, so any unauthenticated caller could transact at
// wholesale by POSTing {"tier":"b2b"}.
//
// These cases pin the invariant that the ONE approval rule (wholesaleVisible() in
// services/b2b.ts) now also guards the write path. Raced against the REAL PostgreSQL
// 17 test container (tests/docker-compose.pg.yml :55432), not a mock, via the
// makeOrdersRoutes(db) DI factory used by the other order tests.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers } from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { deriveUnitPriceSatang } from "../src/services/pricing";
import { seedPrice, seedSellableLine } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const KG_B2C = 20000; // 200 baht/kg retail
const KG_B2B = 12000; // 120 baht/kg wholesale — deliberately DIFFERENT from b2c so the
//                       201 assertion proves the b2b price was used, not a downgrade.
const GRAMS_PER_UNIT = 250;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;

function postOrder(body: unknown): Promise<Response> {
  return routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Same pattern as b2b-approval.test.ts — a customer at a given b2b_status. */
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

/** A sellable line carrying BOTH tier prices, so the approved path can really resolve
 *  a wholesale price (otherwise a 201 assertion would fail on `no_price` instead). */
async function arrange() {
  const seed = await seedSellableLine(db, {
    quotaPlants: 100,
    plantsPerUnit: 2,
    gramsPerUnit: GRAMS_PER_UNIT,
    pricePerKgSatang: KG_B2C,
  });
  await seedPrice(db, seed.roundId, seed.varietyId, "b2b", KG_B2B, null);
  return seed;
}

const GUEST = {
  name: "ลูกค้า A",
  phone: "0810000000",
  recipientName: "ผู้รับ A",
  recipientPhone: "0810000000",
  recipientAddress: "123 ถนนสลัด กรุงเทพ",
};

function cart(seed: { roundId: string; varietyId: string; saleUnitId: string }) {
  return [{ roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 }];
}

async function orderCount(): Promise<number> {
  const rows = await db.execute(sql`SELECT count(*)::int AS n FROM orders`);
  return (rows[0] as { n: number }).n;
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
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

describe("b2b tier WRITE gate — BLOCKER-01, D-08 / T-03-21 / INV-02", () => {
  test("guest body + tier=b2b → 403 not_b2b_approved, no order created", async () => {
    const seed = await arrange();
    const before = await orderCount();
    const res = await postOrder({ tier: "b2b", customer: GUEST, lines: cart(seed) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_b2b_approved");
    expect(await orderCount()).toBe(before); // fail closed: nothing persisted
  });

  test("pending-B2B member + tier=b2b → 403 not_b2b_approved", async () => {
    const seed = await arrange();
    const customerId = await seedCustomer("pending");
    const res = await postOrder({ tier: "b2b", customer: { customerId }, lines: cart(seed) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_b2b_approved");
  });

  test("rejected-B2B member + tier=b2b → 403 not_b2b_approved (same code, leaks nothing)", async () => {
    const seed = await arrange();
    const customerId = await seedCustomer("rejected");
    const res = await postOrder({ tier: "b2b", customer: { customerId }, lines: cart(seed) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("not_b2b_approved");
  });

  test("approved-B2B member + tier=b2b → 201 at the WHOLESALE price (no silent downgrade)", async () => {
    const seed = await arrange();
    const customerId = await seedCustomer("approved");
    const res = await postOrder({ tier: "b2b", customer: { customerId }, lines: cart(seed) });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; subtotalSatang: number };

    const expectedB2b = deriveUnitPriceSatang(KG_B2B, GRAMS_PER_UNIT);
    const expectedB2c = deriveUnitPriceSatang(KG_B2C, GRAMS_PER_UNIT);
    expect(expectedB2b).not.toBe(expectedB2c); // guard the guard: the rates must differ

    const rows = await db.execute(
      sql`SELECT unit_price_satang FROM order_lines WHERE order_id = ${created.id}`,
    );
    expect((rows[0] as { unit_price_satang: number }).unit_price_satang).toBe(expectedB2b);
    expect(created.subtotalSatang).toBe(expectedB2b);
  });

  test("control: same cart with tier=b2c + guest body → 201 (the gate did not widen)", async () => {
    const seed = await arrange();
    const res = await postOrder({ tier: "b2c", customer: GUEST, lines: cart(seed) });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { subtotalSatang: number };
    expect(created.subtotalSatang).toBe(deriveUnitPriceSatang(KG_B2C, GRAMS_PER_UNIT));
  });
});
