// PLAT-03 / D-03 — the catalog + round write boundary. Every mutating catalog
// endpoint (varieties POST/PUT/DELETE, rounds POST + /stock + /status) is gated
// by requireRole("owner","admin"): 401 with no token, 403 with a packer session,
// 2xx with an admin session. Reads (GET /varieties, GET /rounds) stay OPEN (D-03),
// and the open POST /orders seam from 01-02 must still accept a token-less order
// (regression). Raced against the REAL PostgreSQL 17 test container (:55432) via
// the make*Routes(db) DI factories (mirrors makeOrdersRoutes/makeHealthRoutes).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeOrdersRoutes } from "../src/routes/orders";
import { makeRoundsRoutes } from "../src/routes/rounds";
import { makeVarietiesRoutes } from "../src/routes/varieties";
import { seedRound, seedSellableLine, seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let varietyRoutes: ReturnType<typeof makeVarietiesRoutes>;
let roundRoutes: ReturnType<typeof makeRoundsRoutes>;
let orderRoutes: ReturnType<typeof makeOrdersRoutes>;

let adminToken: string;
let packerToken: string;

/** Fire a request at one of the route apps with an optional Bearer token. */
function req(
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

const varietyBody = () => ({
  name: `พันธุ์ ${crypto.randomUUID()}`,
  avgGramsPerPlant: 120,
  saleUnits: [{ kind: "pack", label: "250g", gramsPerUnit: 250, plantsPerUnit: 2 }],
});
const roundBody = () => ({ name: `รอบ ${crypto.randomUUID()}` });

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  varietyRoutes = makeVarietiesRoutes(db);
  roundRoutes = makeRoundsRoutes(db);
  orderRoutes = makeOrdersRoutes(db);
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  adminToken = await issueSession(crypto.randomUUID(), "admin");
  packerToken = await issueSession(crypto.randomUUID(), "packer");
});

afterAll(async () => {
  await client?.end();
});

describe("varieties write boundary (PLAT-03/D-03)", () => {
  test("POST /varieties: 401 no token, 403 packer, 201 admin", async () => {
    expect((await req(varietyRoutes, "POST", "/varieties", { body: varietyBody() })).status).toBe(
      401,
    );
    expect(
      (await req(varietyRoutes, "POST", "/varieties", { token: packerToken, body: varietyBody() }))
        .status,
    ).toBe(403);
    const ok = await req(varietyRoutes, "POST", "/varieties", {
      token: adminToken,
      body: varietyBody(),
    });
    expect(ok.status).toBe(201);
  });

  test("PUT /varieties/:id: 401 no token, 403 packer, 200 admin", async () => {
    const id = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const body = { name: "ชื่อใหม่" };
    expect((await req(varietyRoutes, "PUT", `/varieties/${id}`, { body })).status).toBe(401);
    expect(
      (await req(varietyRoutes, "PUT", `/varieties/${id}`, { token: packerToken, body })).status,
    ).toBe(403);
    expect(
      (await req(varietyRoutes, "PUT", `/varieties/${id}`, { token: adminToken, body })).status,
    ).toBe(200);
  });

  test("DELETE /varieties/:id: 401 no token, 403 packer, 200 admin", async () => {
    const id = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    expect((await req(varietyRoutes, "DELETE", `/varieties/${id}`)).status).toBe(401);
    expect(
      (await req(varietyRoutes, "DELETE", `/varieties/${id}`, { token: packerToken })).status,
    ).toBe(403);
    expect(
      (await req(varietyRoutes, "DELETE", `/varieties/${id}`, { token: adminToken })).status,
    ).toBe(200);
  });

  test("GET /varieties + GET /varieties/:id are OPEN (no token → 200)", async () => {
    const id = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    expect((await req(varietyRoutes, "GET", "/varieties")).status).toBe(200);
    expect((await req(varietyRoutes, "GET", `/varieties/${id}`)).status).toBe(200);
  });
});

describe("rounds write boundary (PLAT-03/D-03)", () => {
  test("POST /rounds: 401 no token, 403 packer, 201 admin", async () => {
    expect((await req(roundRoutes, "POST", "/rounds", { body: roundBody() })).status).toBe(401);
    expect(
      (await req(roundRoutes, "POST", "/rounds", { token: packerToken, body: roundBody() })).status,
    ).toBe(403);
    expect(
      (await req(roundRoutes, "POST", "/rounds", { token: adminToken, body: roundBody() })).status,
    ).toBe(201);
  });

  test("POST /rounds/:id/stock: 401 no token, 403 packer, 200 admin", async () => {
    const roundId = await seedRound(db, `รอบ ${crypto.randomUUID()}`);
    const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const body = { varietyId, quotaPlants: 50 };
    expect((await req(roundRoutes, "POST", `/rounds/${roundId}/stock`, { body })).status).toBe(401);
    expect(
      (await req(roundRoutes, "POST", `/rounds/${roundId}/stock`, { token: packerToken, body }))
        .status,
    ).toBe(403);
    expect(
      (await req(roundRoutes, "POST", `/rounds/${roundId}/stock`, { token: adminToken, body }))
        .status,
    ).toBe(200);
  });

  test("PATCH /rounds/:id/status: 401 no token, 403 packer, 200 admin", async () => {
    const roundId = await seedRound(db, `รอบ ${crypto.randomUUID()}`);
    const body = { status: "closed" };
    expect((await req(roundRoutes, "PATCH", `/rounds/${roundId}/status`, { body })).status).toBe(
      401,
    );
    expect(
      (await req(roundRoutes, "PATCH", `/rounds/${roundId}/status`, { token: packerToken, body }))
        .status,
    ).toBe(403);
    expect(
      (await req(roundRoutes, "PATCH", `/rounds/${roundId}/status`, { token: adminToken, body }))
        .status,
    ).toBe(200);
  });

  test("GET /rounds + GET /rounds/:id are OPEN (no token → 200)", async () => {
    const roundId = await seedRound(db, `รอบ ${crypto.randomUUID()}`);
    expect((await req(roundRoutes, "GET", "/rounds")).status).toBe(200);
    expect((await req(roundRoutes, "GET", `/rounds/${roundId}`)).status).toBe(200);
  });
});

describe("regression: POST /orders stays OPEN (D-03)", () => {
  test("a token-less order still succeeds (201)", async () => {
    const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
    const res = await req(orderRoutes, "POST", "/orders", {
      body: {
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
      },
    });
    expect(res.status).toBe(201);
  });
});
