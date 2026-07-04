// Slip-verification seam (D-01). The swappable interface every call site depends
// on — SlipOK is one implementation (slipok.adapter.ts); an EasySlip/other vendor
// can be dropped in later without touching payments.ts. Pure types + a union; no
// DB, no HTTP (mirrors services/order-status.ts's pure-module style).
//
// The result union is deliberately narrow so the payments route can pattern-match
// on `status` exhaustively:
//   clean       → auto-transition the order to paid (D-05) via applyTransition
//   rejected    → persist a rejected payment row + surface the reason to the UI
//   unavailable → park the order in awaiting-review for admin manual-confirm (D-04)

/** What the caller hands the verifier: the slip image OR the QR string, plus the
 *  server-authoritative amount (satang) to compare against (D-03). */
export interface SlipVerifyInput {
  /** Compressed slip bytes — sent as SlipOK `files`. */
  image?: Uint8Array;
  /** The QR string read from the slip's lower-right — sent as SlipOK `data`. */
  qrPayload?: string;
  /** Order total (subtotal + delivery fee), in satang — the exact expected amount. */
  expectedAmountSatang: number;
}

/** The reasons a slip can be hard-rejected (never auto-paid). */
export type SlipRejectReason = "wrong_amount" | "wrong_payee" | "duplicate" | "not_a_slip";

/** Verifier outcome. `unavailable` is a soft failure → admin review, never a reject. */
export type SlipVerifyResult =
  | { status: "clean"; transRef: string; amountSatang: number; payeeOk: true; raw: unknown }
  | { status: "rejected"; reason: SlipRejectReason; raw: unknown }
  | { status: "unavailable"; raw?: unknown };

/** The seam. Call sites import ONLY this (index.ts picks the concrete vendor). */
export interface SlipVerifier {
  verify(input: SlipVerifyInput): Promise<SlipVerifyResult>;
}
