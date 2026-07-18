// MKT-03 / LINE-04 — broadcast audience is filtered to marketing-CONSENTED, LINE-
// reachable customers only (PDPA / NFR-04, Pitfall 3), and a large audience is split
// into ≤500-id multicast chunks (Pitfall 7). Raced against real PostgreSQL 17 (:55432).
//
// The consent trail is APPEND-ONLY: a withdrawal is a NEW granted=false row. So the
// audience query must keep only the LATEST marketing row per customer — a customer who
// granted then withdrew must NOT receive a broadcast.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { consentLogs, customers } from "../src/db/schema";
import { chunk, resolveAudience } from "../src/services/broadcast";

const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
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

/** Insert a customer, return id. */
async function seedCustomer(lineUserId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ isMember: true, lineUserId })
    .returning({ id: customers.id });
  if (!row) throw new Error("seedCustomer: no row");
  return row.id;
}

/** Append a marketing consent_logs row at an explicit timestamp (ordering control). */
async function seedMarketingConsent(
  customerId: string,
  granted: boolean,
  createdAt: Date,
): Promise<void> {
  await db.insert(consentLogs).values({
    customerId,
    consentType: "marketing",
    granted,
    policyVersion: "2026-07-01",
    createdAt,
  });
}

describe("resolveAudience — latest marketing consent + line_user_id only (Pitfall 3)", () => {
  test("only a granted, LINE-reachable customer is in the audience", async () => {
    const t0 = new Date("2026-07-01T00:00:00Z");
    const t1 = new Date("2026-07-05T00:00:00Z");

    // A: granted once, has line_user_id → INCLUDED.
    const a = await seedCustomer("U_granted_A");
    await seedMarketingConsent(a, true, t0);

    // B: granted then WITHDREW (newer non-granted row) → EXCLUDED (latest-row filter).
    const b = await seedCustomer("U_withdrew_B");
    await seedMarketingConsent(b, true, t0);
    await seedMarketingConsent(b, false, t1);

    // C: granted but NO line_user_id → EXCLUDED (unreachable).
    const c = await seedCustomer(null);
    await seedMarketingConsent(c, true, t0);

    const audience = await resolveAudience(db, { type: "all" });

    expect(audience).toContain("U_granted_A");
    expect(audience).not.toContain("U_withdrew_B"); // withdrawal wins (latest row)
    expect(audience).toHaveLength(1); // only A (C has no line id)
  });

  test("a customer who later RE-granted (newest row granted) is included again", async () => {
    const t0 = new Date("2026-07-01T00:00:00Z");
    const t1 = new Date("2026-07-05T00:00:00Z");
    const t2 = new Date("2026-07-09T00:00:00Z");

    const d = await seedCustomer("U_regranted_D");
    await seedMarketingConsent(d, true, t0);
    await seedMarketingConsent(d, false, t1);
    await seedMarketingConsent(d, true, t2); // newest = granted

    const audience = await resolveAudience(db, { type: "all" });
    expect(audience).toContain("U_regranted_D");
  });
});

describe("chunk — ≤500 multicast batches (Pitfall 7)", () => {
  test("an audience over 500 splits into ≤500-id batches", () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `U_${i}`);
    const batches = chunk(ids, 500);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(500);
    expect(batches[2]).toHaveLength(1);
    // no batch exceeds the cap, and every id is preserved exactly once
    expect(batches.every((b) => b.length <= 500)).toBe(true);
    expect(batches.flat()).toHaveLength(1001);
  });

  test("an empty audience yields zero batches", () => {
    expect(chunk([], 500)).toHaveLength(0);
  });
});
