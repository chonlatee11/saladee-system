// Pack unit-price derivation (INV-04 / D-12 / D-13). Pure computation — no DB.
//
// Money is integer satang end-to-end (1 baht = 100 satang); there is no float
// money anywhere. A pack's price is derived from the per-kg price and its weight,
// then rounded UP to a whole baht (D-13), so the result is always a multiple of
// 100 satang. The handler snapshots this onto order_lines.unit_price_satang.
//
//   raw satang for the unit = price_per_kg_satang * grams_per_unit / 1000
//   unit price (whole baht) = ceil(raw / 100) * 100

/**
 * Derive a pack's unit price, in integer satang, rounded UP to a whole baht.
 * @param pricePerKgSatang per-kilogram price in integer satang
 * @param gramsPerUnit     the pack weight in grams
 * @returns unit price in integer satang — always a multiple of 100 (whole baht)
 */
export function deriveUnitPriceSatang(pricePerKgSatang: number, gramsPerUnit: number): number {
  const rawSatang = (pricePerKgSatang * gramsPerUnit) / 1000;
  return Math.ceil(rawSatang / 100) * 100;
}
