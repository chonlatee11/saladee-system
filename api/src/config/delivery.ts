// Delivery zone × method flat-rate config (D-12). Committed + TypeBox-validated at
// boot, exactly like env.ts: the schema is the single source of truth, the config
// is checked at module load, and a malformed value (negative fee, unknown method
// key) aborts boot with a structured error. Admin edits this file via git/redeploy
// for the MVP; a DB-backed editable table is deferred to Phase 3 (RESEARCH OQ3).
// All money is integer satang.
import { type Static, Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// Fees keyed ONLY by the four known methods; additionalProperties:false makes an
// unknown method key fail validation (D-12 guardrail). Each fee is a non-negative
// integer satang — a negative fee fails boot.
const FeesSchema = t.Object(
  {
    self: t.Optional(t.Integer({ minimum: 0 })),
    cold: t.Optional(t.Integer({ minimum: 0 })),
    on_demand: t.Optional(t.Integer({ minimum: 0 })),
    general: t.Optional(t.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const ZoneSchema = t.Object({
  id: t.String({ minLength: 1 }),
  nameTh: t.String({ minLength: 1 }),
  fees: FeesSchema,
});

const MethodLiteral = t.Union([
  t.Literal("self"),
  t.Literal("cold"),
  t.Literal("on_demand"),
  t.Literal("general"),
]);

export const DeliveryConfigSchema = t.Object({
  zones: t.Array(ZoneSchema, { minItems: 1 }),
  freeShippingThresholdSatang: t.Integer({ minimum: 0 }),
  freeShippingMethods: t.Array(MethodLiteral),
});

export type DeliveryConfig = Static<typeof DeliveryConfigSchema>;

// The committed config (D-12). Two seed zones per D-12: local self-delivery in
// สมุทรปราการ (all four methods) and up-country (carrier methods only, no self /
// on-demand). Free shipping over ฿500 (50000 satang) applies to self/general only.
const rawConfig: DeliveryConfig = {
  zones: [
    {
      id: "samut_prakan",
      nameTh: "สมุทรปราการ (ส่งเอง)",
      fees: { self: 2000, cold: 5000, on_demand: 8000, general: 4000 },
    },
    {
      id: "upcountry",
      nameTh: "ต่างจังหวัด (ขนส่งทั่วไป)",
      fees: { cold: 12000, general: 6000 },
    },
  ],
  freeShippingThresholdSatang: 50000, // ฿500 (D-15)
  freeShippingMethods: ["self", "general"], // on_demand/cold never free (D-15)
};

export interface ValidateConfigResult {
  ok: boolean;
  errors: string[];
}

/**
 * Pure validation: returns a structured result instead of exiting, so tests can
 * exercise the negative/unknown-key cases without killing the test process. The
 * module-load side effect below is what actually aborts boot in production.
 */
export function validateDeliveryConfig(source: unknown): ValidateConfigResult {
  if (Value.Check(DeliveryConfigSchema, source)) return { ok: true, errors: [] };
  const errors = [...Value.Errors(DeliveryConfigSchema, source)].map(
    (e) => `${e.path}: ${e.message}`,
  );
  return { ok: false, errors };
}

/** Validate the committed config at module load; abort boot on failure (fail-fast). */
function loadDeliveryConfig(): DeliveryConfig {
  const result = validateDeliveryConfig(rawConfig);
  if (!result.ok) {
    console.error(
      JSON.stringify({ level: "fatal", msg: "invalid delivery config", errors: result.errors }),
    );
    process.exit(1);
  }
  return rawConfig;
}

export const deliveryConfig: DeliveryConfig = loadDeliveryConfig();
