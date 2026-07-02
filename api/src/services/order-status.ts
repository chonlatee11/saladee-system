// Order status state machine (ORD-02 / D-19). An explicit transition table
// validated in the handler before any status write — no state-machine library
// (matches the MVP / no-over-engineering rule). Pure logic, no DB.
//
// OQ-1 decision (LOCKED): `shipping → cancelled` is FORBIDDEN. Once plants have
// left the farm they are not resellable in-round, so shipping only advances to
// `done`. This removes the release-ambiguity branch entirely. `done` and
// `cancelled` are terminal (D-08: cancel disallowed once done). The `cancelled`
// transition itself performs the guarded stock release in the SAME transaction
// as the status write (see services/reservation.ts release()); that wiring lives
// in the PATCH /orders/:id/status handler (01-02), not here.

export type OrderStatus =
  | "created"
  | "awaiting_payment"
  | "paid"
  | "packing"
  | "shipping"
  | "done"
  | "cancelled";

/** Legal next-states for each status. Empty array ⇒ terminal state. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["packing", "cancelled"],
  packing: ["shipping", "cancelled"],
  shipping: ["done"], // OQ-1: NO cancelled — plants already left the farm
  done: [], // terminal
  cancelled: [], // terminal (releases stock on entry, D-08)
};

/** True iff `from → to` is a legal status transition. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
