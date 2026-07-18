// Carrier-tracking seam (DEL-05, D-22). The swappable interface every call site
// depends on — ManualCarrierAdapter is one implementation (manual.adapter.ts); a
// real Grab/Lalamove API can be dropped in later WITHOUT touching tracking.ts
// (mirrors services/slip-verify/types.ts). Pure types + a union; no DB, no HTTP.
//
// This phase (D-21) is MANUAL entry only: staff type the carrier + waybill and pick
// the status, which the adapter passes through. A future vendor adapter would call
// its API in recordTracking() and map the vendor's status codes in normalizeStatus().

/** The delivery-status enum — mirrors the `delivery_status` pgEnum (schema.ts). The
 *  ONLY statuses a tracking transition may set (anything else is a 422). */
export type DeliveryStatus =
  | "pending"
  | "handed_to_carrier"
  | "in_transit"
  | "delivered"
  | "failed";

/** The canonical enum values, in forward-progress order (UI-SPEC binding palette). */
export const DELIVERY_STATUSES = [
  "pending",
  "handed_to_carrier",
  "in_transit",
  "delivered",
  "failed",
] as const satisfies readonly DeliveryStatus[];

/** What staff (or, later, a vendor webhook) hands the adapter. */
export interface TrackingInput {
  carrier: string;
  trackingNumber: string;
  status: DeliveryStatus;
}

/** The normalised tracking record the route persists onto the order. */
export interface TrackingRecord {
  carrier: string;
  trackingNumber: string;
  status: DeliveryStatus;
}

/** The seam. Call sites import ONLY this interface + the env-selected singleton
 *  (index.ts picks the concrete vendor) — never a concrete adapter class. */
export interface CarrierAdapter {
  /** Record the tracking entry. Manual: pass through. Vendor: call the carrier API. */
  recordTracking(input: TrackingInput): Promise<TrackingRecord>;
  /** Map a raw carrier status string to our delivery_status enum (throws if unknown). */
  normalizeStatus(raw: string): DeliveryStatus;
}
