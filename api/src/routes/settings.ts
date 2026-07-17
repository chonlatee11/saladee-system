// Settings routes (ADM-03 / D-22). Staff-gated GET/PUT over the "hot" system config
// (hold window, haircut %, B2B quota ceiling, delivery zones/fees) that the operator
// edits from web-admin WITHOUT a redeploy. Delegates persistence to
// services/settings.ts, which reads/writes ONLY allow-listed keys.
//
// SECURITY (Pitfall 6 / T-03-31, T-03-33):
//  - requireRole("owner","admin") guards both verbs (grower/packer/customer → 403).
//  - The PUT body schema is a closed object (additionalProperties:false) over the
//    four hot fields, so a secret-shaped key (payee id, slip-verify secret, …) is a
//    422 — a secret can be neither written into nor read out of the settings table.
//    Secrets stay in env.ts and are NEVER referenced by this file.
import { Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { DeliveryConfigSchema } from "../config/delivery";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { type HotSettingsPatch, getHotSettings, setHotSettings } from "../services/settings";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// Closed patch schema: only the four hot fields, each bounded. `additionalProperties:
// false` means an unknown key (a secret-shaped field) fails validation → 422. We
// validate with Value.Check directly (NOT Elysia's body schema) because Elysia's
// body coercion silently STRIPS unknown properties before validation, which would
// let a secret-shaped key slip through as a no-op 200. Checking the raw parsed body
// ourselves keeps the boundary closed from the write side.
const HotSettingsPatchSchema = t.Object(
  {
    holdWindowSeconds: t.Optional(t.Integer({ minimum: 1 })),
    haircutDefaultPct: t.Optional(t.Integer({ minimum: 0, maximum: 100 })),
    b2bQuotaCeilingPct: t.Optional(t.Integer({ minimum: 0, maximum: 100 })),
    delivery: t.Optional(DeliveryConfigSchema),
    // ── Phase-4 loyalty economics (04-03 / D-11, owner-editable) ────────────────
    // NON-secret hot config: points earned per 100 baht subtotal, and the baht value
    // of one point on redeem. Still a CLOSED schema — a secret-shaped key stays a 422.
    loyaltyEarnRate: t.Optional(t.Number({ minimum: 0 })),
    loyaltyPointBaht: t.Optional(t.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export function makeSettingsRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return new Elysia()
    .get("/settings", async () => getHotSettings(database), { beforeHandle: staff })
    .put(
      "/settings",
      async ({ body, set }) => {
        // Reject any unknown/secret-shaped key or out-of-range value with 422.
        if (!Value.Check(HotSettingsPatchSchema, body ?? {})) {
          set.status = 422;
          return { error: "invalid_settings_body" };
        }
        await setHotSettings(database, body as HotSettingsPatch);
        return getHotSettings(database);
      },
      { beforeHandle: staff },
    );
}

// Default instance bound to the runtime db — composed in index.ts.
export const settingsRoutes = makeSettingsRoutes();
