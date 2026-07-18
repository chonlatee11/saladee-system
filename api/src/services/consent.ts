// PDPA consent logging (PLAT-04 / D-25/D-26). Two SEPARATE, independent
// consent_logs rows per grant — one "usage" (required to place the order) and one
// "marketing" (optional, default-unchecked) — each stamped with the policy_version
// the customer consented to and a source. This append-only trail is the audit
// record for PDPA withdrawal/reconsent: usage and marketing are logged as distinct
// rows so a later marketing withdrawal never touches the usage grant (D-26).
//
// Runs INSIDE the order transaction so consent is recorded atomically with the
// order, before any personal data is trusted (D-25). Pure DB write, no HTTP.
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { consentLogs } from "../db/schema";
import { getHotSettings } from "./settings";

type ConsentDb = PostgresJsDatabase<typeof schema>;

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

// ── Marketing opt-out + version-aware consent status (D-17 / PDPA, 04-10) ───────

export interface OptOutMarketingInput {
  customerId: string;
  /** The current pdpaPolicyVersion the withdrawal is stamped with (settings). */
  policyVersion: string;
  /** Where the withdrawal was captured (e.g. "opt_out"). */
  source: string;
}

/**
 * Withdraw marketing consent by APPENDING one marketing consent_logs row with
 * granted=false (D-17). This NEVER updates an existing row and NEVER touches the
 * usage grant — the broadcast audience filter (04-06) reads the latest marketing
 * row per customer, so a fresh granted=false row is enough to exclude them.
 */
export async function optOutMarketing(tx: Tx, input: OptOutMarketingInput): Promise<void> {
  await tx.insert(consentLogs).values({
    customerId: input.customerId,
    orderId: null,
    consentType: "marketing",
    granted: false,
    policyVersion: input.policyVersion,
    source: input.source,
  });
}

export interface ConsentStatus {
  /** The current PDPA policy version (settings, owner-editable). */
  currentPolicyVersion: string;
  /** The member's LATEST marketing grant value (false if never / withdrawn). */
  latestMarketingGranted: boolean;
  /** True when the member has no marketing row at the current policy version —
   *  the checkout must re-collect consent before the next order proceeds. */
  needsReconsent: boolean;
}

/**
 * Report the member's marketing consent posture against the CURRENT policy version.
 * Reads pdpaPolicyVersion from settings and the member's latest marketing row; when
 * that row's policy_version is not the current one (or there is no row), the member
 * must re-consent on their next order (PDPA versioning).
 */
export async function getConsentStatus(
  db: ConsentDb,
  customerId: string,
): Promise<ConsentStatus> {
  const { pdpaPolicyVersion } = await getHotSettings(db);
  const [latest] = await db
    .select({ granted: consentLogs.granted, policyVersion: consentLogs.policyVersion })
    .from(consentLogs)
    .where(and(eq(consentLogs.customerId, customerId), eq(consentLogs.consentType, "marketing")))
    .orderBy(desc(consentLogs.createdAt))
    .limit(1);
  const latestMarketingGranted = latest?.granted ?? false;
  const needsReconsent = !(latest !== undefined && latest.policyVersion === pdpaPolicyVersion);
  return { currentPolicyVersion: pdpaPolicyVersion, latestMarketingGranted, needsReconsent };
}
