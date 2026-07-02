// INV-04 / D-13 — pack unit price is derived from the per-kg price and rounded UP
// to whole baht, computed purely in integer satang (no float money). Pure unit
// test, no DB (analog: auth.test.ts). Every output must be a multiple of 100.
import { describe, expect, test } from "bun:test";
import { deriveUnitPriceSatang } from "../src/services/pricing";

describe("deriveUnitPriceSatang — ceil to whole baht (integer satang)", () => {
  // [pricePerKgSatang, gramsPerUnit, expectedSatang]
  const cases: Array<[number, number, number]> = [
    [12000, 250, 3000], // 12000*250/1000 = 3000 satang exact → 30.00 baht
    [18000, 500, 9000], // 18000*500/1000 = 9000 satang → 90.00 baht
    [11100, 250, 2800], // 2775 satang → ceil to 2800 (28.00 baht) — rounds UP
    [12000, 1000, 12000], // a full kg → 120.00 baht
    [10000, 333, 3400], // 3330 satang → ceil to 3400 (34.00 baht) — rounds UP
    [9990, 250, 2500], // 2497.5 satang → ceil to 2500 (25.00 baht) — rounds UP
  ];

  for (const [kg, grams, expected] of cases) {
    test(`(${kg} satang/kg, ${grams} g) → ${expected} satang`, () => {
      const out = deriveUnitPriceSatang(kg, grams);
      expect(out).toBe(expected);
      expect(out % 100).toBe(0); // always a whole baht (multiple of 100 satang)
      expect(Number.isInteger(out)).toBe(true);
    });
  }
});
