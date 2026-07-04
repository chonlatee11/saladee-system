// WR-04 — POST /boxes and PUT /boxes/:id validate the BOM BEFORE any insert, so a
// duplicate component (violates box_components_box_variety_idx) or a non-existent
// varietyId (violates the box_components FK) returns a clean 400 on this staff
// write instead of an uncaught Postgres 500. Exercised against REAL PostgreSQL 17
// (:55432) via the makeBoxesRoutes(db) DI factory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeBoxesRoutes } from "../src/routes/boxes";
import { seedVariety } from "./seed";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeBoxesRoutes>;
let admin: string;

function postBox(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return routes.handle(
    new Request("http://localhost/boxes", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function putBox(id: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return routes.handle(
    new Request(`http://localhost/boxes/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeBoxesRoutes(db);
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  admin = await issueSession(crypto.randomUUID(), "admin");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /boxes — BOM validation (WR-04)", () => {
  test("valid BOM → 201", async () => {
    const v1 = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const v2 = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const res = await postBox(
      {
        name: `กล่อง ${crypto.randomUUID()}`,
        components: [
          { varietyId: v1, plantsPerBox: 2 },
          { varietyId: v2, plantsPerBox: 3 },
        ],
      },
      admin,
    );
    expect(res.status).toBe(201);
  });

  test("duplicate component varietyId → 400 duplicate_component (not a 500)", async () => {
    const v1 = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const res = await postBox(
      {
        name: `กล่อง ${crypto.randomUUID()}`,
        components: [
          { varietyId: v1, plantsPerBox: 2 },
          { varietyId: v1, plantsPerBox: 4 },
        ],
      },
      admin,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "duplicate_component" });
  });

  test("non-existent component varietyId → 400 invalid_component (not a 500)", async () => {
    const res = await postBox(
      {
        name: `กล่อง ${crypto.randomUUID()}`,
        components: [{ varietyId: crypto.randomUUID(), plantsPerBox: 2 }],
      },
      admin,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_component" });
  });
});

describe("PUT /boxes/:id — BOM validation (WR-04)", () => {
  test("replacing with a duplicate component → 400 duplicate_component", async () => {
    const v1 = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const v2 = await seedVariety(db, `พันธุ์ ${crypto.randomUUID()}`);
    const created = await postBox(
      {
        name: `กล่อง ${crypto.randomUUID()}`,
        components: [{ varietyId: v1, plantsPerBox: 2 }],
      },
      admin,
    );
    const { id } = (await created.json()) as { id: string };
    const res = await putBox(
      id,
      {
        name: "updated",
        components: [
          { varietyId: v2, plantsPerBox: 1 },
          { varietyId: v2, plantsPerBox: 2 },
        ],
      },
      admin,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "duplicate_component" });
  });
});
