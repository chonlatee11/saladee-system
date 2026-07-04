import { describe, expect, test } from "bun:test";
import { validateEnv } from "../src/env";

// A complete, valid env source (dummy but schema-satisfying values).
const complete = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://user:pass@localhost:5432/saladee",
  DATABASE_URL_DIRECT: "postgres://user:pass@localhost:5432/saladee",
  LINE_CHANNEL_SECRET: "dummy-line-channel-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "dummy-line-access-token",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
  JWT_SECRET: "0123456789abcdef0123456789abcdef", // 32 chars
  R2_ACCOUNT_ID: "dummy-account",
  R2_ACCESS_KEY_ID: "dummy-key-id",
  R2_SECRET_ACCESS_KEY: "dummy-secret",
  R2_BUCKET: "saladee-uploads",
  // Phase-2: the only new REQUIRED key (SLIPOK_*/HOLD/PROVIDER all have defaults).
  PROMPTPAY_PAYEE_ID: "0812345678",
} as const;

describe("validateEnv (boot-time env validation)", () => {
  test("a complete env returns { ok: true }", () => {
    const result = validateEnv({ ...complete });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing DATABASE_URL fails and the error names DATABASE_URL", () => {
    const { DATABASE_URL, ...missing } = complete;
    const result = validateEnv(missing);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });

  test("JWT_SECRET shorter than 32 chars fails and the error names JWT_SECRET", () => {
    const result = validateEnv({ ...complete, JWT_SECRET: "tooshort" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
  });

  test("PORT is optional and defaults to 3000 when absent", () => {
    const { PORT, ...noPort } = complete;
    const result = validateEnv(noPort);
    expect(result.ok).toBe(true);
  });

  test("missing PROMPTPAY_PAYEE_ID fails (fail-fast, no default)", () => {
    const { PROMPTPAY_PAYEE_ID, ...missing } = complete;
    const result = validateEnv(missing);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("PROMPTPAY_PAYEE_ID"))).toBe(true);
  });

  test("SLIPOK_* and HOLD_WINDOW_SECONDS are optional (defaults) — env still valid", () => {
    // The SlipOK creds are not provisioned yet (env gap); they default to "" so
    // boot never fails, while 02-06 validates them non-empty before calling out.
    const result = validateEnv({ ...complete });
    expect(result.ok).toBe(true);
  });
});
