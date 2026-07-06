// Checkout helpers (02-08) — the pure, testable pieces of the 3-step wizard.
//
// SECURITY (T-02-30/T-02-31): nothing here computes or trusts money. The order
// body carries ONLY ids + qty + the delivery choice + consent flags; POST /orders
// re-resolves every price, re-computes the delivery fee, and re-enforces the
// freshness intersection server-side (02-04). The subtotal/total shown in the UI
// are DISPLAY-only, summed from the server-resolved unit prices (catalog) and the
// server fee (GET /delivery/quote) — never used to place the order.
import type { CartBoxLine, CartLine } from "../stores/cart";

/** The four delivery methods (matches the api DeliveryMethod union, 02-03). */
export type DeliveryMethod = "self" | "cold" | "on_demand" | "general";

/** Canonical method order + Thai labels (UI-SPEC delivery step). */
export const DELIVERY_METHODS: DeliveryMethod[] = ["self", "cold", "general", "on_demand"];

export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  self: "ส่งเอง (ในพื้นที่)",
  cold: "ส่งแบบแช่เย็น",
  general: "ขนส่งทั่วไป",
  on_demand: "ส่งด่วนตามสั่ง",
};

/** Delivery zones offered for the MVP (mirrors api/src/config/delivery.ts, D-12). */
export interface DeliveryZone {
  id: string;
  nameTh: string;
}
export const DELIVERY_ZONES: DeliveryZone[] = [
  { id: "samut_prakan", nameTh: "สมุทรปราการ (ส่งเอง)" },
  { id: "upcountry", nameTh: "ต่างจังหวัด (ขนส่งทั่วไป)" },
];

/** PDPA policy version stamped on the consent rows (PLAT-04 / D-25). */
export const POLICY_VERSION = "1.0";

/** The recipient fields collected at checkout (guest path). */
export interface CheckoutCustomer {
  name: string;
  phone: string;
  address: string;
}

/** The two independent PDPA consents (D-25/26). */
export interface CheckoutConsent {
  usage: boolean;
  marketing: boolean;
}

/** The GET /delivery/quote response shape the wizard consumes (02-03). */
export interface DeliveryQuote {
  allowedMethods: DeliveryMethod[];
  fees: Partial<Record<DeliveryMethod, number>>;
  deliveryDate: string | null;
}

/**
 * Whole-baht display from server satang (Phase-1 prices/fees are whole-baht, X.00).
 * DISPLAY-only — never fed back into the order.
 */
export function baht(satang: number): number {
  return Math.round(satang / 100);
}

/** True once the required usage consent is ticked (D-25 — gates the step-2 CTA). */
export function consentSatisfied(consent: CheckoutConsent): boolean {
  return consent.usage === true;
}

/** A guest checkout customer (buyer == recipient for the MVP). */
export interface GuestOrderCustomer {
  name: string;
  phone: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
}

/**
 * A logged-in member checkout customer: the customer id binds the order to the LINE
 * identity (history/detail/push, LINE-02 / D-19) while the recipient columns are
 * snapshotted just like the guest path (D-21). Still NO money field.
 */
export interface MemberOrderCustomer {
  customerId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
}

/** The POST /orders body — ids + qty + delivery choice + consent only (no money). */
export interface OrderBody {
  tier: "b2c";
  lines?: CartLine[];
  boxLines?: CartBoxLine[];
  customer: GuestOrderCustomer | MemberOrderCustomer;
  deliveryMethod: DeliveryMethod;
  deliveryZone: string;
  consent: { usage: boolean; marketing: boolean; policyVersion: string };
}

/**
 * Build the POST /orders body from the cart + delivery choice + consent + recipient.
 * The buyer and recipient are the same person for the guest LINE checkout (MVP): the
 * single collected name/phone/address maps to both. Empty line arrays are dropped so
 * the api's `minItems:1` schema is satisfied (a cart always has at least one kind).
 */
export function buildOrderBody(opts: {
  lines: CartLine[];
  boxLines: CartBoxLine[];
  deliveryMethod: DeliveryMethod;
  deliveryZone: string;
  customer: CheckoutCustomer;
  consent: CheckoutConsent;
  // When set (the logged-in member path), the order binds to this customer id so
  // it links to the LINE identity; when absent, the byte-identical guest body is
  // emitted (LINE-02 / D-19). Never a money field.
  customerId?: string;
}): OrderBody {
  const { lines, boxLines, deliveryMethod, deliveryZone, customer, consent, customerId } = opts;
  // The recipient columns are identical for both paths — the single collected
  // name/phone/address maps to the recipient (buyer == recipient for the MVP).
  const orderCustomer: GuestOrderCustomer | MemberOrderCustomer = customerId
    ? {
        customerId,
        recipientName: customer.name,
        recipientPhone: customer.phone,
        recipientAddress: customer.address,
      }
    : {
        name: customer.name,
        phone: customer.phone,
        recipientName: customer.name,
        recipientPhone: customer.phone,
        recipientAddress: customer.address,
      };
  const body: OrderBody = {
    tier: "b2c",
    customer: orderCustomer,
    deliveryMethod,
    deliveryZone,
    consent: { usage: consent.usage, marketing: consent.marketing, policyVersion: POLICY_VERSION },
  };
  if (lines.length > 0) body.lines = lines.map((l) => ({ ...l }));
  if (boxLines.length > 0) body.boxLines = boxLines.map((l) => ({ ...l }));
  return body;
}
