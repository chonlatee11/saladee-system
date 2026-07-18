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
  // Public base URL for PRODUCT-IMAGE marketing assets (D-26). Unlike slips (which
  // stay on the private signed-URL path), product photos are public: the upload
  // stores a stable public URL of the form `${R2_PUBLIC_BASE_URL}/${key}` in the DB
  // so the store/LIFF/Flex render them directly. Env-driven (the R2 public bucket
  // domain / custom domain is provisioned per-shop); the default keeps boot working
  // and — when empty — the stored URL is the key path alone (dev/test).
  R2_PUBLIC_BASE_URL: t.String({ default: "" }),
  // Comma-separated CORS allowlist for cross-origin browser reads (e.g. the
  // Cloudflare Pages web/ origin). Env-driven, NOT hardcoded in the composition:
  // to change the deployed web origin, override this env var — do not edit code.
  // The default keeps boot working without a new GitHub secret.
  // web-admin origins added (Pitfall 6): the Phase-3 desktop staff app runs on its
  // own Cloudflare Pages host + a distinct Vite dev port (5174) — without them the
  // browser preflight blocks every admin mutation. Override the env var to change
  // deployed origins; never edit code.
  CORS_ORIGINS: t.String({
    default:
      "https://saladee-web.pages.dev,https://saladee-admin.pages.dev,http://localhost:5173,http://localhost:5174,http://localhost:3000",
  }),
  // ── Phase-2 payments/slip/hold config (RESEARCH 220-227) ────────────────────
  // Slip-verification adapter selection + credentials. SLIP_VERIFY_PROVIDER picks
  // the adapter (02-06): "slip2go" (default) or "slipok". Credentials default to ""
  // because the concrete secret is provisioned per-shop in prod — env-driven, never
  // logged (Phase-0 D-15); each adapter parks the order for admin review if its
  // outbound call fails (D-04), so a missing secret degrades safely, never oversells.
  SLIP_VERIFY_PROVIDER: t.String({ default: "slip2go" }),
  // Slip2Go bearer secret (Authorization: Bearer). From the Slip2Go "API Connect" menu.
  SLIP2GO_API_SECRET: t.String({ default: "" }),
  // SlipOK (legacy alternative — still selectable via SLIP_VERIFY_PROVIDER=slipok).
  SLIPOK_BRANCH_ID: t.String({ default: "" }),
  SLIPOK_API_KEY: t.String({ default: "" }),
  // The PromptPay payee (phone or national id) embedded in the merchant QR (D-02).
  // Required — the app must refuse to start without a payee to bill (fail-fast).
  PROMPTPAY_PAYEE_ID: t.String({ minLength: 1 }),
  // QR hold window before pg-boss expires an unpaid order (seconds). 30 min default.
  HOLD_WINDOW_SECONDS: t.String({ default: "1800" }),
  // ── Phase-3 crop/B2B config (kept as strings like PORT/HOLD_WINDOW_SECONDS —
  //    env values are strings; consumers parse via Number() and enforce 0–100) ──
  // Fallback confidence haircut when a variety has no per-variety survival_pct (D-02).
  HAIRCUT_DEFAULT_PCT: t.String({ default: "90" }),
  // Ceiling (% of a round's quota) that B2B + subscription reservations may take,
  // leaving headroom for B2C (D-10). 100 = no reserved ceiling.
  B2B_QUOTA_CEILING_PCT: t.String({ default: "100" }),
  // ── Phase-4 carrier adapter selection (DEL-05) ──────────────────────────────
  // Picks the delivery-carrier adapter (mirrors SLIP_VERIFY_PROVIDER): "manual"
  // (default — staff hand-enters the waybill) with a "grab"/"lalamove" seam later.
  // Env-driven, one-line swap; call sites import only the env-selected singleton.
  CARRIER_PROVIDER: t.String({ default: "manual" }),
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
