// Hot system-config service (ADM-03 / D-22). The single place that reads and
// writes the operator-editable "hot" values — hold window, confidence haircut %,
// B2B quota ceiling %, and the delivery zones/fees config — persisted as
// allow-listed key/value rows in the `settings` table so they change WITHOUT a
// redeploy.
//
// SECURITY (Pitfall 6 / T-03-31): secrets NEVER pass through here. This module
// imports only NON-secret env fallbacks (HOLD_WINDOW_SECONDS / HAIRCUT_DEFAULT_PCT
// / B2B_QUOTA_CEILING_PCT) + the committed deliveryConfig, and only ever reads or
// writes the keys in HOT_KEYS. There is no code path by which PROMPTPAY_PAYEE_ID,
// SLIP2GO_API_SECRET, LINE_CHANNEL_SECRET, JWT_SECRET, or the R2 keys could be read
// out of, written into, or surfaced by the settings table — those live in env.ts
// alone. The route's PUT body schema (additionalProperties:false over HOT_KEYS)
// makes writing a secret-shaped key a 422, closing the boundary from both sides.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type DeliveryConfig, deliveryConfig } from "../config/delivery";
import { settings } from "../db/schema";
import type * as schema from "../db/schema";
import { env } from "../env";

type CatalogDb = PostgresJsDatabase<typeof schema>;

/** The camelCase hot field → its snake_case `settings.key`. This map IS the
 *  allow-list: only these four keys are ever read from or written to the table. */
export const HOT_KEYS = {
  holdWindowSeconds: "hold_window_seconds",
  haircutDefaultPct: "haircut_default_pct",
  b2bQuotaCeilingPct: "b2b_quota_ceiling_pct",
  delivery: "delivery",
  // ── Phase-4 loyalty economics + PDPA policy versioning (D-11 / owner-editable) ─
  // NON-secret hot config: how many points an order earns, the baht value of a
  // point when redeemed, and the current PDPA policy version/text the checkout
  // consent stamps. NEVER a secret-shaped key (settings API stays secret-free).
  loyaltyEarnRate: "loyalty_earn_rate",
  loyaltyPointBaht: "loyalty_point_baht",
  pdpaPolicyVersion: "pdpa_policy_version",
  pdpaPolicyText: "pdpa_policy_text",
} as const;

/** The hot config the API exposes and the admin edits (secrets are NOT here). */
export interface HotSettings {
  holdWindowSeconds: number;
  haircutDefaultPct: number;
  b2bQuotaCeilingPct: number;
  delivery: DeliveryConfig;
  loyaltyEarnRate: number; // points earned per 100 baht subtotal (D-11)
  loyaltyPointBaht: number; // baht value of 1 point on redeem (D-11)
  pdpaPolicyVersion: string; // current PDPA policy version the consent stamps
  pdpaPolicyText: string; // current PDPA policy copy (owner-editable)
}

/** A partial edit — any subset of the hot fields (mirrors the route's PUT body). */
export type HotSettingsPatch = Partial<HotSettings>;

/** Env-sourced defaults (all NON-secret). Used when a key has no override row. */
export function defaultHotSettings(): HotSettings {
  return {
    holdWindowSeconds: Number(env.HOLD_WINDOW_SECONDS),
    haircutDefaultPct: Number(env.HAIRCUT_DEFAULT_PCT),
    b2bQuotaCeilingPct: Number(env.B2B_QUOTA_CEILING_PCT),
    delivery: deliveryConfig,
    // Sensible loyalty economics defaults (D-11): 1 point per 100 baht subtotal,
    // 1 point worth 1 baht on redeem. PDPA policy seeds at "1.0" (owner edits later).
    loyaltyEarnRate: 1,
    loyaltyPointBaht: 1,
    pdpaPolicyVersion: "1.0",
    pdpaPolicyText: "",
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Read the current hot settings: the env defaults overlaid with any override rows
 * present in the `settings` table (allow-listed keys only). NEVER touches secrets.
 */
export async function getHotSettings(db: CatalogDb): Promise<HotSettings> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const d = defaultHotSettings();
  return {
    holdWindowSeconds: asNumber(map.get(HOT_KEYS.holdWindowSeconds), d.holdWindowSeconds),
    haircutDefaultPct: asNumber(map.get(HOT_KEYS.haircutDefaultPct), d.haircutDefaultPct),
    b2bQuotaCeilingPct: asNumber(map.get(HOT_KEYS.b2bQuotaCeilingPct), d.b2bQuotaCeilingPct),
    delivery: (map.get(HOT_KEYS.delivery) as DeliveryConfig | undefined) ?? d.delivery,
    loyaltyEarnRate: asNumber(map.get(HOT_KEYS.loyaltyEarnRate), d.loyaltyEarnRate),
    loyaltyPointBaht: asNumber(map.get(HOT_KEYS.loyaltyPointBaht), d.loyaltyPointBaht),
    pdpaPolicyVersion: asString(map.get(HOT_KEYS.pdpaPolicyVersion), d.pdpaPolicyVersion),
    pdpaPolicyText: asString(map.get(HOT_KEYS.pdpaPolicyText), d.pdpaPolicyText),
  };
}

/**
 * Upsert the provided hot fields into the `settings` table (jsonb value, keyed on
 * the config name). Only keys in HOT_KEYS are written — an unknown/secret key never
 * reaches here because the route's TypeBox body rejects it first, but iterating the
 * allow-list (not the input keys) is a belt-and-braces guard against injection.
 */
export async function setHotSettings(db: CatalogDb, patch: HotSettingsPatch): Promise<void> {
  const updates: { key: string; value: unknown }[] = [];
  for (const [field, key] of Object.entries(HOT_KEYS) as [keyof HotSettings, string][]) {
    const value = patch[field];
    if (value !== undefined) updates.push({ key, value });
  }
  if (updates.length === 0) return;
  for (const u of updates) {
    await db
      .insert(settings)
      .values({ key: u.key, value: u.value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: u.value, updatedAt: new Date() },
      });
  }
}
