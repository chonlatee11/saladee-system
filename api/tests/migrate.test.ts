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

// Apply every up (identity → commerce) or every down (commerce → identity) in
// the correct dependency order.
async function applyAllUp(): Promise<void> {
  await client.file(INIT_UP);
  await client.file(COMMERCE_UP);
}
async function applyAllDown(): Promise<void> {
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
  });

  test("up again: full schema is back with no residue", async () => {
    await applyAllUp();
    expect(await tableExists("public.users")).toBe(true);
    expect(await tableExists("public.round_stock")).toBe(true);
    expect(await tableExists("public.orders")).toBe(true);
    expect(await enumExists("order_status")).toBe(true);
  });
});
