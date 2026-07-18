// D-17 / NFR-04 — a LINE member can opt out of marketing, and the opt-out is an
// APPEND-ONLY consent_logs row (marketing, granted=false) stamped with the current
// pdpaPolicyVersion. The broadcast audience filter (04-06, latest-row-per-customer)
// must then EXCLUDE them. A pdpaPolicyVersion bump makes getConsentStatus signal
// needsReconsent so the next order re-collects consent. Every route is member-gated
// (guest → 403, missing token → 401). Raced against real PostgreSQL 17 (:55432).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { consentLogs, customers } from "../src/db/schema";
import { issueSession } from "../src/plugins/auth.plugin";
import { makeMeOrdersRoutes } from "../src/routes/me-orders";
import { resolveAudience } from "../src/services/broadcast";
import { getConsentStatus } from "../src/services/consent";
import { defaultHotSettings, setHotSettings } from "../src/services/settings";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeMeOrdersRoutes>;

function fire(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Response> {
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

/** A LINE member (customer row WITH a line_user_id) + a customer session for it. */
async function seedMember(): Promise<{ id: string; lineUserId: string; token: string }> {
  const lineUserId = `U${crypto.randomUUID()}`;
  const [row] = await db
    .insert(customers)
    .values({ name: `Member ${crypto.randomUUID()}`, lineUserId, isMember: true })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedMember: insert returned no row");
  return { id: row.id, lineUserId, token: await issueSession(row.id, "customer") };
}

/** Append a marketing consent_logs row at an explicit timestamp + policy version. */
async function seedMarketingConsent(
  customerId: string,
  granted: boolean,
  policyVersion: string,
  createdAt: Date,
): Promise<void> {
  await db.insert(consentLogs).values({
    customerId,
    consentType: "marketing",
    granted,
    policyVersion,
    createdAt,
    source: "checkout",
  });
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeMeOrdersRoutes(db);
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
});

afterAll(async () => {
  await client?.end();
});

describe("marketing opt-out (D-17 / NFR-04, append-only)", () => {
  test("opt-out appends a granted=false marketing row; prior rows untouched", async () => {
    const currentVersion = defaultHotSettings().pdpaPolicyVersion;
    const m = await seedMember();
    // A prior granted marketing row (already consented at the current version).
    await seedMarketingConsent(m.id, true, currentVersion, new Date("2026-07-01T00:00:00Z"));

    const before = await db
      .select({ id: consentLogs.id })
      .from(consentLogs)
      .where(and(eq(consentLogs.customerId, m.id), eq(consentLogs.consentType, "marketing")));
    expect(before.length).toBe(1);

    const res = await fire("POST", "/me/marketing-opt-out", { token: m.token });
    expect(res.status).toBe(200);

    const after = await db
      .select({ granted: consentLogs.granted, policyVersion: consentLogs.policyVersion })
      .from(consentLogs)
      .where(and(eq(consentLogs.customerId, m.id), eq(consentLogs.consentType, "marketing")));
    // A NEW row was APPENDED (never an UPDATE): count grew by one.
    expect(after.length).toBe(2);
    // The prior granted=true row is still present (untouched).
    expect(after.some((r) => r.granted === true)).toBe(true);
    // The new row is granted=false, stamped with the current policy version.
    const denied = after.filter((r) => r.granted === false);
    expect(denied.length).toBe(1);
    expect(denied[0]?.policyVersion).toBe(currentVersion);
  });

  test("after opt-out the broadcast audience excludes the member", async () => {
    const m = await seedMember();
    await seedMarketingConsent(m.id, true, "1.0", new Date("2026-07-01T00:00:00Z"));
    // Reachable + granted → currently in the audience.
    let audience = await resolveAudience(db, { type: "all" });
    expect(audience).toContain(m.lineUserId);

    const res = await fire("POST", "/me/marketing-opt-out", { token: m.token });
    expect(res.status).toBe(200);

    // The latest marketing row is now granted=false → excluded (Pitfall 3).
    audience = await resolveAudience(db, { type: "all" });
    expect(audience).not.toContain(m.lineUserId);
  });

  test("consent-status: needsReconsent flips true after a pdpaPolicyVersion bump", async () => {
    const currentVersion = defaultHotSettings().pdpaPolicyVersion;
    const m = await seedMember();
    // Consented at the current version → no re-consent needed yet.
    await seedMarketingConsent(m.id, true, currentVersion, new Date("2026-07-02T00:00:00Z"));

    const ok = await fire("GET", "/me/consent-status", { token: m.token });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      currentPolicyVersion: string;
      latestMarketingGranted: boolean;
      needsReconsent: boolean;
    };
    expect(okBody.currentPolicyVersion).toBe(currentVersion);
    expect(okBody.latestMarketingGranted).toBe(true);
    expect(okBody.needsReconsent).toBe(false);

    // The owner bumps the PDPA policy version → the member must re-consent next order.
    const bumped = `${currentVersion}-next-${crypto.randomUUID().slice(0, 6)}`;
    await setHotSettings(db, { pdpaPolicyVersion: bumped });
    try {
      const res = await fire("GET", "/me/consent-status", { token: m.token });
      const body = (await res.json()) as { currentPolicyVersion: string; needsReconsent: boolean };
      expect(body.currentPolicyVersion).toBe(bumped);
      expect(body.needsReconsent).toBe(true);
    } finally {
      // Restore the default so sibling tests see the seed version.
      await setHotSettings(db, { pdpaPolicyVersion: currentVersion });
    }
  });

  test("opt-out + consent-status reject a guest (403) and a missing token (401)", async () => {
    // A customer session whose id is not a line-linked member → 403 (D-19 gate).
    const orphan = await issueSession(crypto.randomUUID(), "customer");
    expect((await fire("POST", "/me/marketing-opt-out", { token: orphan })).status).toBe(403);
    expect((await fire("GET", "/me/consent-status", { token: orphan })).status).toBe(403);

    // No token at all → 401.
    expect((await fire("POST", "/me/marketing-opt-out")).status).toBe(401);
    expect((await fire("GET", "/me/consent-status")).status).toBe(401);
  });
});
