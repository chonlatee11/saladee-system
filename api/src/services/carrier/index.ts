// Carrier adapter selection (DEL-05, D-21). Call sites import ONLY the CarrierAdapter
// interface + the env-selected `carrierAdapter` singleton from here — never a concrete
// vendor. Swapping manual entry for a real Grab/Lalamove API is a one-line switch case,
// no tracking.ts edit. Mirrors the env-driven selection discipline of slip-verify/index.ts.
import { env } from "../../env";
import { ManualCarrierAdapter } from "./manual.adapter";
import type { CarrierAdapter } from "./types";

/** Build the adapter for `provider` (default: env.CARRIER_PROVIDER). */
export function makeCarrierAdapter(provider: string = env.CARRIER_PROVIDER): CarrierAdapter {
  switch (provider) {
    case "manual":
      return new ManualCarrierAdapter();
    // Later-phase seam — a real vendor adapter plugs in with NO route rework:
    // case "grab":     return new GrabCarrierAdapter();
    // case "lalamove": return new LalamoveCarrierAdapter();
    default:
      throw new Error(`unknown CARRIER_PROVIDER: ${provider}`);
  }
}

/** The runtime adapter — what tracking.ts depends on by default. */
export const carrierAdapter: CarrierAdapter = makeCarrierAdapter();

export { ManualCarrierAdapter } from "./manual.adapter";
export type { CarrierAdapter, DeliveryStatus, TrackingInput, TrackingRecord } from "./types";
export { DELIVERY_STATUSES } from "./types";
