// Boot-time environment validation (D-10, RESEARCH Pattern 1).
// The schema is the single source of truth for config; nothing reads process.env
// by key elsewhere. A missing/malformed required var aborts boot with a precise,
// structured error naming the offending variable — no secret value is ever logged.
import { type Static, Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const EnvSchema = t.Object({
  NODE_ENV: t.Union([t.Literal("development"), t.Literal("production"), t.Literal("test")]),
  PORT: t.String({ default: "3000" }),
  // Runtime queries: Neon pooled (-pooler) in prod / Docker PG in dev.
  DATABASE_URL: t.String({ minLength: 1 }),
  // Migrations: Neon direct/unpooled endpoint (RESEARCH Pitfall 2).
  DATABASE_URL_DIRECT: t.String({ minLength: 1 }),
  LINE_CHANNEL_SECRET: t.String({ minLength: 1 }),
  LINE_CHANNEL_ACCESS_TOKEN: t.String({ minLength: 1 }),
  LINE_LOGIN_CHANNEL_ID: t.String({ minLength: 1 }), // aud for idToken verify
  JWT_SECRET: t.String({ minLength: 32 }),
  R2_ACCOUNT_ID: t.String({ minLength: 1 }),
  R2_ACCESS_KEY_ID: t.String({ minLength: 1 }),
  R2_SECRET_ACCESS_KEY: t.String({ minLength: 1 }),
  R2_BUCKET: t.String({ minLength: 1 }),
});

export type Env = Static<typeof EnvSchema>;

export interface ValidateEnvResult {
  ok: boolean;
  errors: string[];
}

/**
 * Pure validation: apply schema defaults, then Value.Check the source.
 * Returns a structured result instead of exiting, so tests can exercise it
 * without killing the test process. The module-load side effect below is what
 * actually aborts boot in production.
 */
export function validateEnv(source: Record<string, unknown>): ValidateEnvResult {
  const candidate = Value.Default(EnvSchema, { ...source }) as Record<string, unknown>;
  if (Value.Check(EnvSchema, candidate)) {
    return { ok: true, errors: [] };
  }
  const errors = [...Value.Errors(EnvSchema, candidate)].map((e) => `${e.path}: ${e.message}`);
  return { ok: false, errors };
}

/** Validate process.env at module load; abort boot on failure (D-10 fail-fast). */
function loadEnv(): Env {
  const result = validateEnv(process.env as Record<string, unknown>);
  if (!result.ok) {
    // Structured fatal line to stderr — lists which vars are wrong, never values.
    console.error(JSON.stringify({ level: "fatal", msg: "invalid env", errors: result.errors }));
    process.exit(1);
  }
  return Value.Cast(EnvSchema, { ...process.env });
}

export const env: Env = loadEnv();
