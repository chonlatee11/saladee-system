// Criterion 2: each migration applies (up), rolls back (down), and re-applies (up)
// cleanly against a real PostgreSQL 17 — no residue. Covers BOTH the Phase-0
// identity migration (0000_init) and the Phase-1 commerce migration (0001_commerce).
//
// We execute the generated up SQL and the hand-written down SQL directly (both
// via postgres.js `.file()`), symmetrically. This is deliberate: drizzle-kit's
// migrator records applied migrations in a journal table, so a second `migrate()`
// after a down would be a no-op and the tables would NOT reappear — which would
// make the up→down→up proof meaningless. Applying the SQL files directly proves
// each up/down pair is truly reversible and idempotent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Dedicated direct/unpooled URL for the ephemeral PG17 (tests/docker-compose.pg.yml).
const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const INIT_UP = "drizzle/0000_init.sql";
const INIT_DOWN = "drizzle/0000_init.down.sql";
const COMMERCE_UP = "drizzle/0001_commerce.sql";
const COMMERCE_DOWN = "drizzle/0001_commerce.down.sql";
const PRICES_DEFAULT_UP = "drizzle/0002_prices_default_uniq.sql";
const PRICES_DEFAULT_DOWN = "drizzle/0002_prices_default_uniq.down.sql";
const PAYMENTS_UP = "drizzle/0003_payments_delivery_consent.sql";
const PAYMENTS_DOWN = "drizzle/0003_payments_delivery_consent.down.sql";
const PHASE3_UP = "drizzle/0004_phase3.sql";
const PHASE3_DOWN = "drizzle/0004_phase3.down.sql";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

async function tableExists(qualified: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT to_regclass(${qualified}) AS reg`);
  return rows[0]?.reg !== null && rows[0]?.reg !== undefined;
}

async function enumExists(typname: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 AS ok FROM pg_type WHERE typname = ${typname}`);
  return rows.length > 0;
}

async function indexExists(indexname: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 AS ok FROM pg_indexes WHERE indexname = ${indexname}`,
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}`,
  );
  return rows.length > 0;
}

// Apply every up (identity → commerce → phase-3) or every down (phase-3 →
// identity) in the correct dependency order.
async function applyAllUp(): Promise<void> {
  await client.file(INIT_UP);
  await client.file(COMMERCE_UP);
  await client.file(PRICES_DEFAULT_UP);
  await client.file(PAYMENTS_UP);
  await client.file(PHASE3_UP);
}
async function applyAllDown(): Promise<void> {
  // Latest migration first (children before parents, enum types last). 0004's
  // child tables FK into varieties/customers/rounds/orders, so its down MUST run
  // before 0001's down drops those parents.
  await client.file(PHASE3_DOWN);
  await client.file(PAYMENTS_DOWN);
  await client.file(PRICES_DEFAULT_DOWN);
  await client.file(COMMERCE_DOWN);
  await client.file(INIT_DOWN);
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 1 });
  db = drizzle(client);
  // Clean slate in case a prior aborted run (or another test file) left residue.
  await applyAllDown().catch(() => {});
});

afterAll(async () => {
  await client?.end();
});

describe("migration up→down→up (Criterion 2)", () => {
  test("up: identity + all commerce tables and enums exist", async () => {
    await applyAllUp();
    // 0000_init
    expect(await tableExists("public.users")).toBe(true);
    expect(await enumExists("role")).toBe(true);
    // 0001_commerce — spot-check the load-bearing tables + representative enums
    expect(await tableExists("public.round_stock")).toBe(true);
    expect(await tableExists("public.orders")).toBe(true);
    expect(await tableExists("public.varieties")).toBe(true);
    expect(await tableExists("public.order_lines")).toBe(true);
    expect(await tableExists("public.back_in_stock_requests")).toBe(true);
    expect(await enumExists("order_status")).toBe(true);
    expect(await enumExists("tier")).toBe(true);
    // 0002_prices_default_uniq — the partial unique index enforcing one NULL-date
    // default per (round, variety, tier) (WR-01).
    expect(await indexExists("prices_default_uniq")).toBe(true);
    // 0003_payments_delivery_consent — new tables, dedup index, and enum.
    expect(await tableExists("public.payments")).toBe(true);
    expect(await tableExists("public.consent_logs")).toBe(true);
    expect(await indexExists("payments_trans_ref_idx")).toBe(true);
    expect(await enumExists("delivery_class")).toBe(true);
    // 0004_phase3 — new tables, enums, additive columns, and idempotency index.
    expect(await tableExists("public.planting_batches")).toBe(true);
    expect(await tableExists("public.harvest_logs")).toBe(true);
    expect(await tableExists("public.subscriptions")).toBe(true);
    expect(await tableExists("public.settings")).toBe(true);
    expect(await enumExists("subscription_status")).toBe(true);
    expect(await enumExists("b2b_status")).toBe(true);
    expect(await columnExists("varieties", "days_to_harvest")).toBe(true);
    expect(await columnExists("round_stock", "is_manual_override")).toBe(true);
    expect(await indexExists("subscription_orders_sub_round_idx")).toBe(true);
  });

  test("down: identity + commerce tables and enums are all gone", async () => {
    await applyAllDown();
    expect(await tableExists("public.users")).toBe(false);
    expect(await enumExists("role")).toBe(false);
    expect(await tableExists("public.round_stock")).toBe(false);
    expect(await tableExists("public.orders")).toBe(false);
    expect(await tableExists("public.varieties")).toBe(false);
    expect(await enumExists("order_status")).toBe(false);
    expect(await enumExists("tier")).toBe(false);
    // The partial index is gone with its table (0002 down runs before 0001 down).
    expect(await indexExists("prices_default_uniq")).toBe(false);
    // 0003 objects are gone too (down reverses cleanly, delivery_class type last).
    expect(await tableExists("public.payments")).toBe(false);
    expect(await tableExists("public.consent_logs")).toBe(false);
    expect(await enumExists("delivery_class")).toBe(false);
    // 0004 objects gone (children dropped before parents, enum types last).
    expect(await tableExists("public.planting_batches")).toBe(false);
    expect(await tableExists("public.subscriptions")).toBe(false);
    expect(await tableExists("public.settings")).toBe(false);
    expect(await enumExists("subscription_status")).toBe(false);
    expect(await enumExists("b2b_status")).toBe(false);
    // varieties table itself is gone, so its added column is gone with it.
    expect(await columnExists("varieties", "days_to_harvest")).toBe(false);
  });

  test("up again: full schema is back with no residue", async () => {
    await applyAllUp();
    expect(await tableExists("public.users")).toBe(true);
    expect(await tableExists("public.round_stock")).toBe(true);
    expect(await tableExists("public.orders")).toBe(true);
    expect(await enumExists("order_status")).toBe(true);
    // 0004 back with no residue (leaves the shared DB at full schema for the
    // rest of the suite, which inserts varieties carrying the new columns).
    expect(await tableExists("public.planting_batches")).toBe(true);
    expect(await columnExists("varieties", "days_to_harvest")).toBe(true);
  });
});
