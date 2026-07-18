// Manual carrier adapter (DEL-05, D-21). This phase has NO live carrier API: staff
// hand-enter the carrier name + waybill and pick the delivery_status, and this adapter
// simply validates + passes those values through. The seam (CarrierAdapter) means a
// real Grab/Lalamove adapter can replace this later with no tracking.ts rewrite.
import { type CarrierAdapter, DELIVERY_STATUSES, type DeliveryStatus, type TrackingInput, type TrackingRecord } from "./types";

function isDeliveryStatus(raw: string): raw is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(raw);
}

export class ManualCarrierAdapter implements CarrierAdapter {
  /** Manual entry: the staff-typed values pass straight through (no vendor call). */
  async recordTracking(input: TrackingInput): Promise<TrackingRecord> {
    return {
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      status: this.normalizeStatus(input.status),
    };
  }

  /** Manual status IS already our enum — validate it, throw on anything foreign so a
   *  bad value can never persist an out-of-enum status (T-04-16). */
  normalizeStatus(raw: string): DeliveryStatus {
    if (!isDeliveryStatus(raw)) {
      throw new Error(`unknown delivery status: ${raw}`);
    }
    return raw;
  }
}
