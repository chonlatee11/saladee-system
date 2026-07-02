#!/usr/bin/env bun
// Prod Neon smoke test — Criterion 2 (00-07): after applying migrations to the
// production Neon database, prove the schema actually exists and the DB answers.
//
// This connects on the DIRECT/unpooled URL with prepare:false (Pitfall 2) and checks:
//   1. SELECT 1                          → DB reachable
//   2. to_regclass('public.users')       → users table applied
//   3. the "role" enum has all 4 labels  → owner/admin/grower/packer
//
// Usage (from the api/ directory):
//     cd api
//     # 1. put your REAL Neon URLs in api/.env (DATABASE_URL pooled, DATABASE_URL_DIRECT unpooled)
//     # 2. apply migrations to prod on the DIRECT url:
//     DATABASE_URL_DIRECT="$DATABASE_URL_DIRECT" bun run db:migrate
//     # 3. verify:
//     bun run scripts/neon-smoke.ts
//
// Exit code 0 = schema present and DB reachable; non-zero = a check failed.

import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error("❌ FAIL: DATABASE_URL_DIRECT is not set (put the Neon DIRECT/unpooled URL in api/.env).");
  process.exit(1);
}
if (url.includes("-pooler")) {
  console.error(
    "❌ FAIL: DATABASE_URL_DIRECT looks like a POOLED url (contains '-pooler'). " +
      "Use the DIRECT/unpooled connection string here (migrations + admin checks).",
  );
  process.exit(1);
}

// Redact host for a safe log line (no user:pass).
const safeHost = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
})();
console.log(`Prod Neon smoke test → ${safeHost}`);

const sql = postgres(url, { prepare: false, max: 1 });
let ok = true;
try {
  const [{ one }] = await sql`SELECT 1 AS one`;
  if (one !== 1) throw new Error(`SELECT 1 returned ${one}`);
  console.log("  ✓ [1/3] SELECT 1 — database reachable");

  const [{ users }] = await sql`SELECT to_regclass('public.users') AS users`;
  if (!users) {
    console.error("  ❌ [2/3] users table NOT found — did `bun run db:migrate` run against this DB?");
    ok = false;
  } else {
    console.log("  ✓ [2/3] users table exists");
  }

  const labels = await sql<{ enumlabel: string }[]>`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'role'
    ORDER BY e.enumsortorder`;
  const got = labels.map((r) => r.enumlabel);
  const expected = ["owner", "admin", "grower", "packer"];
  const missing = expected.filter((r) => !got.includes(r));
  if (missing.length) {
    console.error(`  ❌ [3/3] role enum missing labels: ${missing.join(", ")} (got: ${got.join(", ") || "none"})`);
    ok = false;
  } else {
    console.log(`  ✓ [3/3] role enum has all labels: ${got.join(", ")}`);
  }
} catch (e) {
  console.error(`  ❌ query error: ${(e as Error).message}`);
  ok = false;
} finally {
  await sql.end({ timeout: 5 });
}

if (ok) {
  console.log("\n✅ PASS — Criterion 2 (prod Neon reachable + schema applied) verified.");
  process.exit(0);
} else {
  console.log("\n❌ FAIL — see checks above.");
  process.exit(1);
}
