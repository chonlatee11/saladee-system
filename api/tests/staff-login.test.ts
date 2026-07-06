// PLAT-03 / D-07 / T-01-22 / T-01-23 — the real staff login. POST /auth/staff
// now looks up the users row BY EMAIL and verifies the submitted password against
// the STORED password_hash (Bun.password.verify), issuing a session carrying the
// row's stored role. The Phase-0 forgery path (trusting a CLIENT-SUPPLIED hash to
// mint an admin token) is closed. Both "unknown email" and "wrong password" return
// an identical 401 invalid_credentials (no user-enumeration signal). Raced against
// the REAL PostgreSQL 17 container (:55432) via the makeAuthRoutes(db) DI factory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";
import { requireRole, verifySession } from "../src/plugins/auth.plugin";
import { makeAuthRoutes } from "../src/routes/auth";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeAuthRoutes>;

function login(body: unknown): Promise<Response> {
  return routes.handle(
    new Request("http://localhost/auth/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Insert a staff users row with a real Argon2id hash; returns its id + email. */
async function seedStaff(role: "owner" | "admin" | "grower" | "packer", password: string) {
  const email = `staff-${crypto.randomUUID()}@example.com`;
  const passwordHash = await Bun.password.hash(password);
  const [row] = await db.insert(users).values({ email, passwordHash, role }).returning({
    id: users.id,
  });
  if (!row) throw new Error("seedStaff: insert returned no row");
  return { id: row.id, email };
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeAuthRoutes(db);
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");
});

afterAll(async () => {
  await client?.end();
});

describe("POST /auth/staff — real users lookup + stored-hash verify (PLAT-03/D-07)", () => {
  test("correct email+password → 200, session carries the stored role and passes requireRole", async () => {
    const { email } = await seedStaff("admin", "s3cret-pw");
    const res = await login({ email, password: "s3cret-pw" });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(typeof token).toBe("string");

    const session = await verifySession(token);
    expect(session.role).toBe("admin");

    // The minted session must pass the owner|admin gate (end-to-end PLAT-03).
    const guard = requireRole("owner", "admin");
    const result = await guard({ headers: { authorization: `Bearer ${token}` }, set: {} });
    expect(result).toBeUndefined(); // undefined ⇒ authorized
  });

  test("session role is the ROW's role, not a request-supplied one (grower stays grower)", async () => {
    const { email } = await seedStaff("grower", "grow-pw");
    // Even if the client tries to smuggle a role, the handler ignores it.
    const res = await login({ email, password: "grow-pw", role: "admin" });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const session = await verifySession(token);
    expect(session.role).toBe("grower"); // NOT admin — role comes from the row

    const adminGate = requireRole("owner", "admin");
    const denied = await adminGate({ headers: { authorization: `Bearer ${token}` }, set: {} });
    expect(denied).toEqual({ error: "forbidden" }); // grower cannot pass the admin gate
  });

  test("correct email + WRONG password → 401 invalid_credentials", async () => {
    const { email } = await seedStaff("admin", "right-pw");
    const res = await login({ email, password: "wrong-pw" });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_credentials" });
  });

  test("unknown email → 401 invalid_credentials (identical to wrong-password: no enumeration)", async () => {
    const res = await login({ email: "nobody@example.com", password: "whatever" });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_credentials" });
  });

  test("forgery closed: a client-supplied passwordHash cannot mint a token", async () => {
    const { email } = await seedStaff("admin", "real-stored-pw");
    // The attacker submits the WRONG password AND a hash of that wrong password —
    // the Phase-0 scaffold would have verified wrong-vs-its-own-hash → true → admin
    // token. The real handler ignores the supplied hash and verifies against the
    // STORED hash of "real-stored-pw" → mismatch → 401. Forgery path is gone.
    const forgedHash = await Bun.password.hash("attacker-pw");
    const res = await login({ email, password: "attacker-pw", passwordHash: forgedHash });
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "invalid_credentials" });
  });
});
