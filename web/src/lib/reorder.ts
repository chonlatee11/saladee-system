// Reorder → cart application (02-09, D-20). Pure glue between the member reorder
// response (POST /me/orders/:id/reorder) and the client cart store, extracted here
// so it is unit-testable DOM-free (bun test) and the OrderHistoryView stays thin.
//
// The server has already RE-PRICED every line at the current open round and flagged
// items now sold-out/absent; this only loads the fully-available proposed cart
// (ids + qty — never money, T-02-17) and surfaces the unavailable warning so the
// customer confirms before paying (D-20). It never places an order.
import type { CartBoxLine, CartLine, useCart } from "../stores/cart";

/** The reorder response shape (subset consumed by the cart hand-off). */
export interface ReorderResponse {
  cart: { lines: CartLine[]; boxLines: CartBoxLine[] };
  hasUnavailable: boolean;
}

/** The D-20 warning shown when one or more reordered items is now unavailable. */
export const REORDER_UNAVAILABLE_MESSAGE =
  "บางรายการไม่มีในรอบนี้หรือขายหมดแล้ว — โปรดตรวจสอบก่อนชำระเงิน";

/**
 * Load a reorder's proposed cart into the store (replacing the current cart) and
 * return the D-20 warning message when any item was flagged unavailable, else null.
 */
export function applyReorderToCart(
  res: ReorderResponse,
  cart: ReturnType<typeof useCart>,
): { message: string | null } {
  cart.clear();
  for (const line of res.cart.lines) cart.add(line);
  for (const box of res.cart.boxLines) cart.addBox(box);
  return { message: res.hasUnavailable ? REORDER_UNAVAILABLE_MESSAGE : null };
}
