// Slip-verify provider selection (D-01). Call sites import ONLY the SlipVerifier
// interface + the env-selected `slipVerifier` singleton from here — never a
// concrete vendor. Swapping SlipOK for another vendor is a one-line switch case,
// no payments.ts edit. Mirrors the env-driven selection discipline of env.ts.
import { env } from "../../env";
import { SlipOkAdapter } from "./slipok.adapter";
import type { SlipVerifier } from "./types";

/** Build the verifier for `provider` (default: env.SLIP_VERIFY_PROVIDER). */
export function makeSlipVerifier(provider: string = env.SLIP_VERIFY_PROVIDER): SlipVerifier {
  switch (provider) {
    case "slipok":
      return new SlipOkAdapter();
    default:
      throw new Error(`unknown SLIP_VERIFY_PROVIDER: ${provider}`);
  }
}

/** The runtime verifier — what payments.ts depends on by default. */
export const slipVerifier: SlipVerifier = makeSlipVerifier();

export type { SlipVerifier, SlipVerifyInput, SlipVerifyResult, SlipRejectReason } from "./types";
