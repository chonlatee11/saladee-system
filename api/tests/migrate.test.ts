// Criterion 2: the migration applies (up), rolls back (down), and re-applies (up)
// cleanly against a real PostgreSQL 17 — no residue.
//
// We execute the generated up SQL and the hand-written down SQL directly (both
// via postgres.js `.file()`), symmetrically. This is deliberate: drizzle-kit's
// migrator records applied migrations in a journal table, so a second `migrate()`
// after a down would be a no-op and `users` would NOT reappear — which would make
// the up→down→up proof meaningless. Applying the SQL files directly proves the
// 0000_init.sql / 0000_init.down.sql pair is truly reversible and idempotent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Dedicated direct/unpooled URL for the ephemeral PG17 (tests/docker-compose.pg.yml).
const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const UP_SQL = "drizzle/0000_init.sql";
const DOWN_SQL = "drizzle/0000_init.down.sql";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

async function usersTableExists(): Promise<boolean> {
  const rows = await db.execute(sql`SELECT to_regclass('public.users') AS reg`);
  return rows[0]?.reg !== null && rows[0]?.reg !== undefined;
}

async function roleEnumExists(): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 AS ok FROM pg_type WHERE typname = 'role'`);
  return rows.length > 0;
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 1 });
  db = drizzle(client);
  // Clean slate in case a prior aborted run left residue.
  await client.file(DOWN_SQL).catch(() => {});
});

afterAll(async () => {
  await client?.end();
});

describe("migration up→down→up (Criterion 2)", () => {
  test("up: users table + role enum exist after applying 0000_init.sql", async () => {
    await client.file(UP_SQL);
    expect(await usersTableExists()).toBe(true);
    expect(await roleEnumExists()).toBe(true);
  });

  test("down: users table + role enum are gone after applying 0000_init.down.sql", async () => {
    await client.file(DOWN_SQL);
    expect(await usersTableExists()).toBe(false);
    expect(await roleEnumExists()).toBe(false);
  });

  test("up again: schema is back with no residue", async () => {
    await client.file(UP_SQL);
    expect(await usersTableExists()).toBe(true);
    expect(await roleEnumExists()).toBe(true);
  });
});
