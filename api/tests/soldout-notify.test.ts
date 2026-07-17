// INV-08 / D-20 — the DATA-ONLY back-in-stock request endpoint. A customer can ask
// to be alerted when a sold-out variety/round returns; the request is STORED as a
// record only — no message is sent, and the engine never auto-substitutes (D-20).
// Raced against the REAL PostgreSQL 17 container (:55432) via makeStockRoutes(db).
//   - POST /stock/back-in-stock is OPEN (a customer can self-request) → 201 + row
//   - GET  /stock/back-in-stock is STAFF-ONLY (owner|admin) — it lists contacts
//     (T-01-16): 401 no token, 403 wrong role, 200 owner/admin
//   - submitting for a sold-out variety succeeds; the record persists and is listed
//   - no send / no substitution side effect: round_stock is unchanged (record-only)
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { roundStock, rounds } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeStockRoutes } from "../src/routes/stock";
import { seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeStockRoutes>;
let adminToken: string;
let packerToken: string;

function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return routes.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

/** Arrange a variety in an open round whose only stock row is fully reserved. */
async function arrangeSoldOut() {
  const varietyId = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
  const [r] = await db
    .insert(rounds)
    .values({ name: `รอบ ${crypto.randomUUID()}`, status: "open" })
    .returning({ id: rounds.id });
  if (!r) throw new Error("round insert returned no row");
  await db
    .insert(roundStock)
    .values({ roundId: r.id, varietyId, quotaPlants: 5, reservedPlants: 5 });
  return { varietyId, roundId: r.id };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeStockRoutes(db);
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
  adminToken = await issueSession(crypto.randomUUID(), "admin");
  packerToken = await issueSession(crypto.randomUUID(), "packer");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /stock/back-in-stock — data-only request record (INV-08/D-20)", () => {
  test("a customer request for a sold-out variety is stored and returns 201 (open, no token)", async () => {
    const { varietyId, roundId } = await arrangeSoldOut();
    const res = await req("POST", "/stock/back-in-stock", {
      body: { roundId, varietyId, contact: "line:U123" },
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; roundId: string; varietyId: string };
    expect(row.id).toBeString();
    expect(row.roundId).toBe(roundId);
    expect(row.varietyId).toBe(varietyId);
  });

  test("storing the request does NOT send or auto-substitute: round_stock is unchanged (D-20)", async () => {
    const { varietyId, roundId } = await arrangeSoldOut();
    await req("POST", "/stock/back-in-stock", {
      body: { roundId, varietyId, contact: "line:U999" },
    });
    const after = await db.execute(
      sql`SELECT quota_plants, reserved_plants FROM round_stock WHERE round_id = ${roundId} AND variety_id = ${varietyId}`,
    );
    const rowAfter = (after as unknown as { quota_plants: number; reserved_plants: number }[])[0];
    expect(rowAfter?.quota_plants).toBe(5);
    expect(rowAfter?.reserved_plants).toBe(5); // no substitution / no mutation
  });

  test("malformed ids are rejected by TypeBox (T-01-17) → 422", async () => {
    const res = await req("POST", "/stock/back-in-stock", {
      body: { roundId: "not-a-uuid", varietyId: "nope" },
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /stock/back-in-stock — staff-only list (T-01-16)", () => {
  test("no token → 401", async () => {
    const res = await req("GET", "/stock/back-in-stock");
    expect(res.status).toBe(401);
  });

  test("wrong role (packer) → 403", async () => {
    const res = await req("GET", "/stock/back-in-stock", { token: packerToken });
    expect(res.status).toBe(403);
  });

  test("admin lists the stored requests, including a just-submitted one", async () => {
    const { varietyId, roundId } = await arrangeSoldOut();
    const marker = `line:${crypto.randomUUID()}`;
    const post = await req("POST", "/stock/back-in-stock", {
      body: { roundId, varietyId, contact: marker },
    });
    expect(post.status).toBe(201);
    const res = await req("GET", "/stock/back-in-stock", { token: adminToken });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      roundId: string;
      varietyId: string;
      contact: string | null;
    }[];
    const mine = rows.find((x) => x.contact === marker);
    expect(mine).toBeDefined();
    expect(mine?.roundId).toBe(roundId);
    expect(mine?.varietyId).toBe(varietyId);
  });
});
