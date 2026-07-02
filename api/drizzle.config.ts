// drizzle-kit config — migrations use the DIRECT (unpooled) URL (Pitfall 2).
// drizzle-kit prepares statements and must NOT run through Neon's PgBouncer
// pooled endpoint; DATABASE_URL_DIRECT is the unpooled connection string
// (no `-pooler` in the host). Read straight from process.env so the same config
// works for CI/live migrate with an overridden DATABASE_URL_DIRECT.
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    "DATABASE_URL_DIRECT is required for drizzle-kit migrations (unpooled endpoint — Pitfall 2)",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
