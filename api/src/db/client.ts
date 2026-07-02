// Runtime DB client (Pitfall 2: Neon PgBouncer transaction-mode).
// Source: neon.com/docs/connect/choose-connection + orm.drizzle.team/docs/connect-neon.
//
// The RUNTIME app talks to the POOLED endpoint (env.DATABASE_URL) with
// `prepare: false` — REQUIRED because Neon's pooled endpoint runs PgBouncer in
// transaction mode, which discards prepared statements between transactions and
// otherwise throws "prepared statement already exists" under concurrency (exactly
// during NFR-01 spikes). Migrations use the DIRECT/unpooled URL via drizzle.config.ts.
// Against dev Docker PG (no PgBouncer) `prepare: false` is harmless, so one config
// serves both environments.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export const sqlClient = postgres(env.DATABASE_URL, { prepare: false, max: 10 });
export const db = drizzle(sqlClient, { schema });
