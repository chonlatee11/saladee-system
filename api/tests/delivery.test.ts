// DEL-01..04 / D-12/13/15 — the pure delivery fee + freshness engine, no DB
// (analog: pricing.test.ts). Pins the server-authoritative contract the checkout
// slice (02-04) snapshots onto the order:
//   - zone × method flat fees (D-12)
//   - ฿500 free-shipping on self/general ONLY; on_demand/cold always charged (D-15)
//   - freshness intersection: very_fresh forces self/cold, mixed → strictest (D-13)
//   - an unavailable (zone, method) pair throws method_not_available_in_zone
//   - config validation fails on a negative fee or an unknown method key (fail-fast)
import { describe, expect, test } from "bun:test";
import {
  type DeliveryConfig,
  DeliveryConfigSchema,
  deliveryConfig,
  validateDeliveryConfig,
} from "../src/config/delivery";
import {
  ALLOWED_METHODS,
  type DeliveryClass,
  type DeliveryMethod,
  allowedMethodsForCart,
  computeDeliveryFee,
} from "../src/services/delivery";

const cfg = deliveryConfig;
const UNDER = 30000; // ฿300 — under the ฿500 free-shipping threshold
const OVER = 50000; // ฿500 — at/over the threshold

describe("computeDeliveryFee — zone × method flat matrix (D-12)", () => {
  // [zoneId, method, expected base satang] — under the free-shipping threshold.
  const matrix: Array<[string, DeliveryMethod, number]> = [
    ["samut_prakan", "self", 2000],
    ["samut_prakan", "cold", 5000],
    ["samut_prakan", "on_demand", 8000],
    ["samut_prakan", "general", 4000],
    ["upcountry", "cold", 12000],
    ["upcountry", "general", 6000],
  ];
  for (const [zone, method, expected] of matrix) {
    test(`${zone} × ${method} → ${expected} satang`, () => {
      expect(computeDeliveryFee(zone, method, UNDER, cfg)).toBe(expected);
    });
  }
});

describe("computeDeliveryFee — ฿500 free-shipping on self/general ONLY (D-15)", () => {
  test("self is free over ฿500", () => {
    expect(computeDeliveryFee("samut_prakan", "self", OVER, cfg)).toBe(0);
  });
  test("general is free over ฿500", () => {
    expect(computeDeliveryFee("samut_prakan", "general", OVER, cfg)).toBe(0);
    expect(computeDeliveryFee("upcountry", "general", OVER, cfg)).toBe(0);
  });
  test("on_demand is NEVER free even over ฿500", () => {
    expect(computeDeliveryFee("samut_prakan", "on_demand", OVER, cfg)).toBe(8000);
  });
  test("cold is NEVER free even over ฿500", () => {
    expect(computeDeliveryFee("samut_prakan", "cold", OVER, cfg)).toBe(5000);
    expect(computeDeliveryFee("upcountry", "cold", OVER, cfg)).toBe(12000);
  });
  test("self under ฿500 still charges the base", () => {
    expect(computeDeliveryFee("samut_prakan", "self", UNDER, cfg)).toBe(2000);
  });
  test("threshold is inclusive (exactly ฿500 qualifies)", () => {
    expect(computeDeliveryFee("samut_prakan", "self", 50000, cfg)).toBe(0);
    expect(computeDeliveryFee("samut_prakan", "self", 49999, cfg)).toBe(2000);
  });
});

describe("computeDeliveryFee — unavailable (zone, method) throws (D-12)", () => {
  test("upcountry has no self-delivery", () => {
    expect(() => computeDeliveryFee("upcountry", "self", UNDER, cfg)).toThrow(
      "method_not_available_in_zone",
    );
  });
  test("upcountry has no on_demand", () => {
    expect(() => computeDeliveryFee("upcountry", "on_demand", UNDER, cfg)).toThrow(
      "method_not_available_in_zone",
    );
  });
  test("unknown zone throws", () => {
    expect(() => computeDeliveryFee("mars", "self", UNDER, cfg)).toThrow(
      "method_not_available_in_zone",
    );
  });
});

describe("allowedMethodsForCart — freshness intersection (D-13/DEL-03)", () => {
  test("all-normal cart allows every method", () => {
    expect(allowedMethodsForCart(["normal", "normal"])).toEqual([
      "self",
      "cold",
      "on_demand",
      "general",
    ]);
  });
  test("very_fresh forces self/cold only", () => {
    expect(allowedMethodsForCart(["very_fresh"])).toEqual(["self", "cold"]);
  });
  test("mixed [very_fresh, normal] → strictest wins (self/cold)", () => {
    expect(allowedMethodsForCart(["very_fresh", "normal"])).toEqual(["self", "cold"]);
    expect(allowedMethodsForCart(["normal", "very_fresh", "normal"])).toEqual(["self", "cold"]);
  });
  test("empty cart is unconstrained (all four)", () => {
    expect(allowedMethodsForCart([])).toEqual(["self", "cold", "on_demand", "general"]);
  });
  test("ALLOWED_METHODS table matches DEL-03", () => {
    const veryFresh: DeliveryMethod[] = ["self", "cold"];
    const normal: DeliveryMethod[] = ["self", "cold", "on_demand", "general"];
    const classes: DeliveryClass[] = ["very_fresh", "normal"];
    expect(ALLOWED_METHODS[classes[0]]).toEqual(veryFresh);
    expect(ALLOWED_METHODS[classes[1]]).toEqual(normal);
  });
});

describe("delivery config validates at boot (fail-fast)", () => {
  test("the committed config is valid", () => {
    expect(validateDeliveryConfig(deliveryConfig).ok).toBe(true);
  });
  test("a negative zone fee fails validation", () => {
    const bad = {
      zones: [{ id: "z", nameTh: "z", fees: { self: -1 } }],
      freeShippingThresholdSatang: 50000,
      freeShippingMethods: ["self"],
    };
    expect(validateDeliveryConfig(bad).ok).toBe(false);
  });
  test("an unknown method key fails validation", () => {
    const bad = {
      zones: [{ id: "z", nameTh: "z", fees: { drone: 1000 } }],
      freeShippingThresholdSatang: 50000,
      freeShippingMethods: ["self"],
    };
    expect(validateDeliveryConfig(bad).ok).toBe(false);
  });
  test("a valid hand-built config passes", () => {
    const good: DeliveryConfig = {
      zones: [{ id: "z", nameTh: "โซนทดสอบ", fees: { self: 0, general: 3000 } }],
      freeShippingThresholdSatang: 50000,
      freeShippingMethods: ["self", "general"],
    };
    expect(validateDeliveryConfig(good).ok).toBe(true);
    // schema is exported for reuse by callers that validate other config sources
    expect(DeliveryConfigSchema).toBeDefined();
  });
});
