// Crop-yield forecast — PURE, deterministic, DB-free compute (CROP-03 / D-02 / D-05).
//
// These three functions are the whole forecasting kernel. They take variety
// parameters + a batch's plant date/count and return derived dates/quantities.
// They are deliberately side-effect-free and hold NO database handle so:
//   1. they unit-test trivially (tests/forecast.test.ts), and
//   2. 03-05's publish step (computeDraftQuota → round_stock.quota_plants) can
//      reuse them unchanged when it sums batch forecasts into a round.
// Correctness of stock is a DATABASE property (reservation.ts guarded UPDATE);
// forecasting is only the sizing input that FEEDS quota_plants — never a
// reservation decision. Keep it pure.
//
// Date arithmetic uses the UTC accessors (getUTCDate/setUTCDate) on purpose: the
// batch plant_date is stored as timestamptz and every derived date must be
// timezone-stable so the same input yields the same output on any host/CI box.
// setUTCDate handles month/year rollover (e.g. 2026-07-06 + 45d → 2026-08-20).

/**
 * Projected harvest date for a batch = plantDate + daysToHarvest (D-07 seam).
 * @param plantDate    the day the batch was sown.
 * @param daysToHarvest per-variety days-to-harvest (CROP-01 param).
 * @returns a NEW Date (input is never mutated).
 */
export function projectedHarvestDate(plantDate: Date, daysToHarvest: number): Date {
  const d = new Date(plantDate.getTime());
  d.setUTCDate(d.getUTCDate() + daysToHarvest);
  return d;
}

/**
 * Forecast sellable plants from a batch = plantCount × survivalPct%, floored.
 * The floor is the CONSERVATIVE haircut (D-02): we never round up a forecast that
 * feeds sellable quota, so the shop can never advertise more plants than the
 * survival rate justifies (oversell-safety starts at the forecast). Per-variety
 * survivalPct is 0–100.
 *   forecastPlants(200, 90) = 180 ; forecastPlants(201, 90) = 180 (floored, not 181).
 */
export function forecastPlants(plantCount: number, survivalPct: number): number {
  return Math.floor((plantCount * survivalPct) / 100);
}

/**
 * Best-before date for a harvested lot = harvestDate + shelfLifeDays (D-05 / INV-10).
 * Computed automatically from the per-variety shelf life so traceability
 * (1 batch = 1 lot) never relies on a hand-typed expiry.
 * @returns a NEW Date (input is never mutated).
 */
export function bestBefore(harvestDate: Date, shelfLifeDays: number): Date {
  const d = new Date(harvestDate.getTime());
  d.setUTCDate(d.getUTCDate() + shelfLifeDays);
  return d;
}
