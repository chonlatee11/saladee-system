// Tiny down-migration runner (Pitfall 3: drizzle-kit has no built-in `down`).
// Convention: each NNNN_name.sql has a hand-written NNNN_name.down.sql; this
// runner executes the down file whose path is passed as argv[2], against the
// DIRECT/unpooled connection (same endpoint drizzle-kit migrate uses — Pitfall 2).
// Source: drizzle-team discussion #1339 (no built-in down).
//
// Usage: bun run src/lib/migrate-down.ts drizzle/0000_init.down.sql
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error(
    JSON.stringify({ level: "fatal", msg: "migrate-down: missing down-SQL path (argv[2])" }),
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error(JSON.stringify({ level: "fatal", msg: "migrate-down: DATABASE_URL_DIRECT unset" }));
  process.exit(1);
}

const sql = postgres(url, { prepare: false });
await sql.file(file);
await sql.end();
console.log(JSON.stringify({ level: "info", msg: "migrate-down applied", file }));
