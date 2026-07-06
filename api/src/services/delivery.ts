// Delivery fee + freshness-gating engine (DEL-01..04 / D-12/13/15).
//
// PURE, server-authoritative, config-driven — the same discipline as
// services/reservation.ts (boxAvailability) and services/pricing.ts: no DB, no
// I/O, integer satang everywhere, and the client NEVER supplies a fee. The
// checkout API (02-04) recomputes + snapshots these numbers onto the order and
// drives the QR amount (RESEARCH Pitfall 5), so /delivery/quote is display-only.
import type { DeliveryConfig } from "../config/delivery";

/** The four delivery methods (DEL-01): ส่งเอง / ขนส่งเย็น / Grab-Lalamove / ขนส่งทั่วไป. */
export type DeliveryMethod = "self" | "cold" | "on_demand" | "general";

/** Per-variety freshness class (schema `varieties.delivery_class`, D-13/D-24). */
export type DeliveryClass = "very_fresh" | "normal";

/** Canonical method order — used to keep intersection/fee output stable. */
const ALL_METHODS: DeliveryMethod[] = ["self", "cold", "on_demand", "general"];

/**
 * Which methods each freshness class permits (D-13/DEL-03). A very_fresh item can
 * only ship self-delivery or cold-chain; a normal item can use any method.
 */
export const ALLOWED_METHODS: Record<DeliveryClass, DeliveryMethod[]> = {
  very_fresh: ["self", "cold"],
  normal: ["self", "cold", "on_demand", "general"],
};

/**
 * A cart's allowed methods = the INTERSECTION of ALLOWED_METHODS across every
 * variety (and box component) in the cart — the strictest class wins (D-13). A
 * mixed [very_fresh, normal] cart collapses to ["self","cold"]. An empty cart is
 * unconstrained (all four). Output preserves the canonical ALL_METHODS order.
 */
export function allowedMethodsForCart(classes: DeliveryClass[]): DeliveryMethod[] {
  if (classes.length === 0) return [...ALL_METHODS];
  let allowed = new Set<DeliveryMethod>(ALL_METHODS);
  for (const c of classes) {
    const perClass = new Set(ALLOWED_METHODS[c]);
    allowed = new Set([...allowed].filter((m) => perClass.has(m)));
  }
  return ALL_METHODS.filter((m) => allowed.has(m));
}

/**
 * Flat fee for (zone × method) in integer satang, with the ฿500 free-shipping rule.
 * @throws Error("method_not_available_in_zone") when the zone has no fee for the
 *         method — the caller omits it from the quote / rejects it at checkout.
 *
 * Free-shipping (D-15): subtotal >= threshold AND method ∈ freeShippingMethods → 0.
 * on_demand/cold are never free even over ฿500 (they carry a real carrier cost).
 */
export function computeDeliveryFee(
  zoneId: string,
  method: DeliveryMethod,
  subtotalSatang: number,
  cfg: DeliveryConfig,
): number {
  const zone = cfg.zones.find((z) => z.id === zoneId);
  const base = zone?.fees[method];
  if (base == null) throw new Error("method_not_available_in_zone");
  if (
    subtotalSatang >= cfg.freeShippingThresholdSatang &&
    cfg.freeShippingMethods.includes(method)
  ) {
    return 0;
  }
  return base;
}
