// ORD-02 / D-19 — the order pipeline is an explicit transition table validated
// before any status write. OQ-1 decision (locked): shipping → cancelled is
// FORBIDDEN (plants have left the farm); TRANSITIONS.shipping = ["done"]. Pure
// unit test, no DB (analog: auth.test.ts).
import { describe, expect, test } from "bun:test";
import { canTransition, type OrderStatus, TRANSITIONS } from "../src/services/order-status";

describe("canTransition — legal edges accepted", () => {
  const legal: Array<[OrderStatus, OrderStatus]> = [
    ["created", "awaiting_payment"],
    ["created", "cancelled"],
    ["awaiting_payment", "paid"],
    ["awaiting_payment", "cancelled"],
    ["paid", "packing"],
    ["paid", "cancelled"],
    ["packing", "shipping"],
    ["packing", "cancelled"],
    ["shipping", "done"],
  ];
  for (const [from, to] of legal) {
    test(`${from} → ${to} is allowed`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
});

describe("canTransition — illegal edges rejected", () => {
  const illegal: Array<[OrderStatus, OrderStatus]> = [
    ["created", "paid"], // must go through awaiting_payment
    ["shipping", "cancelled"], // OQ-1: forbidden — not resellable in-round
    ["done", "packing"], // done is terminal
    ["done", "cancelled"], // cancel disallowed once done (D-08)
    ["cancelled", "created"], // cancelled is terminal
    ["paid", "done"], // cannot skip packing/shipping
  ];
  for (const [from, to] of illegal) {
    test(`${from} → ${to} is rejected`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }
});

describe("transition table invariants (OQ-1 / D-08)", () => {
  test("shipping maps to ['done'] only (no cancelled)", () => {
    expect(TRANSITIONS.shipping).toEqual(["done"]);
  });
  test("done and cancelled are terminal states", () => {
    expect(TRANSITIONS.done).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });
});
