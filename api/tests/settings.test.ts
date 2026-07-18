// ADM-03 / D-22 — hot system-config settings, staff-editable, secret-safe.
//
// The settings API surfaces ONLY allow-listed hot values (hold window, haircut %,
// B2B quota ceiling, delivery zones/fees) read from the `settings` table, overlaid
// on env defaults. It is guarded by requireRole("owner","admin"). The critical
// security property (Pitfall 6 / T-03-31): NO secret (payee id, slip-verify key,
// LINE channel secret, JWT secret, R2 keys) EVER appears in the response, and the
// PUT body schema refuses any key outside the hot allow-list — so a secret can
// neither be read out of nor written into the settings table via this API.
// Raced against real PostgreSQL 17 via the makeSettingsRoutes(db) DI factory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { settings } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeSettingsRoutes } from "../src/routes/settings";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let settingsRoutes: ReturnType<typeof makeSettingsRoutes>;
let admin: string;
let customerToken: string;
let growerToken: string;

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
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  settingsRoutes = makeSettingsRoutes(db);
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
  growerToken = await issueSession(crypto.randomUUID(), "grower");
  await db.delete(settings);
});

afterAll(async () => {
  await client?.end();
});

describe("GET /settings — hot config, secret-absent (T-03-31 / Pitfall 6)", () => {
  test("admin reads the hot settings object with defaults", async () => {
    const res = await fire(settingsRoutes, "GET", "/settings", { token: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.holdWindowSeconds).toBe("number");
    expect(typeof body.haircutDefaultPct).toBe("number");
    expect(typeof body.b2bQuotaCeilingPct).toBe("number");
    expect(body.delivery).toBeDefined();
  });

  test("NO secret value or secret-named key ever appears in the response", async () => {
    const res = await fire(settingsRoutes, "GET", "/settings", { token: admin });
    const body = (await res.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    // (a) No live secret VALUE from env leaks into the payload (len>=10 avoids
    //     coincidental substring matches on short values).
    for (const secret of [
      process.env.LINE_CHANNEL_SECRET,
      process.env.JWT_SECRET,
      process.env.PROMPTPAY_PAYEE_ID,
      process.env.SLIP2GO_API_SECRET,
      process.env.SLIPOK_API_KEY,
      process.env.R2_SECRET_ACCESS_KEY,
      process.env.R2_ACCESS_KEY_ID,
    ]) {
      if (secret && secret.length >= 10) {
        expect(serialized.includes(secret)).toBe(false);
      }
    }

    // (b) No secret-shaped KEY is present anywhere in the object graph.
    const keyBlob = serialized.toLowerCase();
    for (const forbidden of ["payee", "secret", "token", "apikey", "api_key", "password", "jwt"]) {
      expect(keyBlob.includes(forbidden)).toBe(false);
    }
  });
});

describe("PUT /settings — upsert hot values, reject non-hot keys", () => {
  test("admin updates haircut % + B2B ceiling; GET reflects it (no redeploy)", async () => {
    const res = await fire(settingsRoutes, "PUT", "/settings", {
      token: admin,
      body: { haircutDefaultPct: 80, b2bQuotaCeilingPct: 75 },
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as { haircutDefaultPct: number; b2bQuotaCeilingPct: number };
    expect(after.haircutDefaultPct).toBe(80);
    expect(after.b2bQuotaCeilingPct).toBe(75);

    const get = await fire(settingsRoutes, "GET", "/settings", { token: admin });
    const body = (await get.json()) as { haircutDefaultPct: number };
    expect(body.haircutDefaultPct).toBe(80);
  });

  test("out-of-range haircut (>100) is rejected (422)", async () => {
    const res = await fire(settingsRoutes, "PUT", "/settings", {
      token: admin,
      body: { haircutDefaultPct: 150 },
    });
    expect(res.status).toBe(422);
  });

  test("a secret-shaped key in the body is refused by the schema (422)", async () => {
    const res = await fire(settingsRoutes, "PUT", "/settings", {
      token: admin,
      body: { promptpayPayeeId: "0812345678", slip2goApiSecret: "leaked" },
    });
    expect(res.status).toBe(422);
  });
});

describe("RBAC gate — settings is staff-only (T-03-33)", () => {
  test("no token → 401", async () => {
    const res = await fire(settingsRoutes, "GET", "/settings");
    expect(res.status).toBe(401);
  });
  test("customer session → 403", async () => {
    const res = await fire(settingsRoutes, "GET", "/settings", { token: customerToken });
    expect(res.status).toBe(403);
  });
  test("grower session → 403 (settings is owner/admin only)", async () => {
    const res = await fire(settingsRoutes, "PUT", "/settings", {
      token: growerToken,
      body: { haircutDefaultPct: 90 },
    });
    expect(res.status).toBe(403);
  });
});
