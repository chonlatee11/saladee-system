// PDPA consent logging (PLAT-04 / D-25/D-26). Two SEPARATE, independent
// consent_logs rows per grant — one "usage" (required to place the order) and one
// "marketing" (optional, default-unchecked) — each stamped with the policy_version
// the customer consented to and a source. This append-only trail is the audit
// record for PDPA withdrawal/reconsent: usage and marketing are logged as distinct
// rows so a later marketing withdrawal never touches the usage grant (D-26).
//
// Runs INSIDE the order transaction so consent is recorded atomically with the
// order, before any personal data is trusted (D-25). Pure DB write, no HTTP.
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { consentLogs } from "../db/schema";

// The transaction handle passed by `database.transaction(async (tx) => …)`
// (mirrors services/order-transition.ts).
type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

export interface LogConsentInput {
  customerId: string | null;
  orderId: string | null;
  /** Usage consent — REQUIRED; the caller rejects the order when this is false. */
  usageGranted: boolean;
  /** Marketing consent — INDEPENDENT; logged regardless of value (default false). */
  marketingGranted: boolean;
  policyVersion: string;
  source: string;
}

/**
 * Insert the two consent rows (usage + marketing) for one checkout grant. Both
 * carry the same policyVersion + source; `granted` reflects each input flag
 * independently. Returns nothing — the audit trail lives in consent_logs.
 */
export async function logConsent(tx: Tx, input: LogConsentInput): Promise<void> {
  await tx.insert(consentLogs).values([
    {
      customerId: input.customerId,
      orderId: input.orderId,
      consentType: "usage",
      granted: input.usageGranted,
      policyVersion: input.policyVersion,
      source: input.source,
    },
    {
      customerId: input.customerId,
      orderId: input.orderId,
      consentType: "marketing",
      granted: input.marketingGranted,
      policyVersion: input.policyVersion,
      source: input.source,
    },
  ]);
}
