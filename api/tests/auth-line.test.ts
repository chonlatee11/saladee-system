// LINE-02 — the real POST /auth/line. A LIFF client posts its idToken; the server
// verifies it against LINE's remote JWKS (ES256, iss=access.line.me,
// aud=LINE_LOGIN_CHANNEL_ID — Pitfall 4), then upserts a member `customers` row
// keyed on line_user_id=payload.sub and issues a CUSTOMER session (never a staff
// role — T-02-06). Raced against the REAL PostgreSQL 17 container (:55432) via the
// makeAuthRoutes(db) DI factory.
//
// The idToken is a REAL ES256 JWT we sign with a throwaway key; LINE's JWKS
// endpoint is stubbed via globalThis.fetch so the app's genuine verifyLineIdToken
// (jose) runs unchanged — we mock only the network, never the auth code.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { customers } from "../src/db/schema";
import { verifySession } from "../src/plugins/auth.plugin";
import { makeAuthRoutes } from "../src/routes/auth";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

// The aud the server enforces — read from the SAME env the app validated at boot.
const AUD = process.env.LINE_LOGIN_CHANNEL_ID ?? "";
const KID = "saladee-test-kid";
const JWKS_URL = "https://api.line.me/oauth2/v2.1/certs";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeAuthRoutes>;
let privateKey: CryptoKey;
let realFetch: typeof globalThis.fetch;

function postLine(body: unknown): Promise<Response> {
  return routes.handle(
    new Request("http://localhost/auth/line", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Sign a REAL ES256 idToken with our throwaway key (iss/aud match the server). */
function signIdToken(sub: string, name?: string, opts?: { expired?: boolean }) {
  const jwt = new SignJWT(name ? { name } : {})
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuer("https://access.line.me")
    .setAudience(AUD)
    .setSubject(sub)
    .setIssuedAt();
  jwt.setExpirationTime(opts?.expired ? "-1h" : "1h");
  return jwt.sign(privateKey);
}

beforeAll(async () => {
  // Throwaway ES256 keypair; publish the public JWK via the stubbed JWKS endpoint.
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256", use: "sig" };

  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(JWKS_URL)) {
      return Response.json({ keys: [jwk] });
    }
    return realFetch(input, init);
  }) as typeof globalThis.fetch;

  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeAuthRoutes(db);
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

afterEach(async () => {
  // Keep upsert-idempotency assertions honest across tests.
  await db.delete(customers).where(eq(customers.lineUserId, "Utest-idempotent"));
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await client?.end();
});

describe("POST /auth/line — server-verified LINE Login + member upsert (LINE-02)", () => {
  test("rejects a syntactically-broken idToken (401, no customer created)", async () => {
    const before = (await db.select({ id: customers.id }).from(customers)).length;
    const res = await postLine({ idToken: "not-a-real-jwt" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_id_token" });
    const after = (await db.select({ id: customers.id }).from(customers)).length;
    expect(after).toBe(before);
  });

  test("rejects an expired idToken signed by a valid key (401)", async () => {
    const idToken = await signIdToken("Uexpired", "หมดอายุ", { expired: true });
    const res = await postLine({ idToken });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_id_token" });
  });

  test("rejects an idToken minted for the WRONG audience (401 — Pitfall 4)", async () => {
    const wrong = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .setIssuer("https://access.line.me")
      .setAudience("some-other-channel")
      .setSubject("Uwrongaud")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const res = await postLine({ idToken: wrong });
    expect(res.status).toBe(401);
  });

  test("accepts a valid idToken, upserts ONE member, and issues a customer session", async () => {
    const sub = `Uvalid-${crypto.randomUUID()}`;
    const idToken = await signIdToken(sub, "สมชาย ผักสด");
    const res = await postLine({ idToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; customerId: string; lineUserId: string };
    expect(body.lineUserId).toBe(sub);
    expect(typeof body.token).toBe("string");
    expect(typeof body.customerId).toBe("string");

    // Exactly one member customer, keyed on line_user_id, name captured.
    const rows = await db.select().from(customers).where(eq(customers.lineUserId, sub));
    expect(rows.length).toBe(1);
    expect(rows[0]?.isMember).toBe(true);
    expect(rows[0]?.name).toBe("สมชาย ผักสด");
    expect(rows[0]?.id).toBe(body.customerId);

    // The session is a CUSTOMER session (never a staff role — T-02-06).
    const session = await verifySession(body.token);
    expect(session.sub).toBe(body.customerId);
    expect(session.role).toBe("customer");
  });

  test("re-login with the same line_user_id does NOT create a duplicate customer", async () => {
    const sub = "Utest-idempotent";
    const first = await postLine({ idToken: await signIdToken(sub, "รอบแรก") });
    const firstBody = (await first.json()) as { customerId: string };
    const second = await postLine({ idToken: await signIdToken(sub, "รอบสอง") });
    const secondBody = (await second.json()) as { customerId: string };

    expect(secondBody.customerId).toBe(firstBody.customerId);
    const rows = await db.select().from(customers).where(eq(customers.lineUserId, sub));
    expect(rows.length).toBe(1);
  });
});
