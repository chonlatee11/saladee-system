// CROP-03 pure-compute unit tests for the forecast kernel (services/forecast.ts).
// No DB, no Elysia — the whole point of keeping forecast pure is that these run as
// fast deterministic unit tests and 03-05's publish can reuse the same functions.
// Dates are constructed with Date.UTC(...) so the UTC-based arithmetic in
// forecast.ts is asserted timezone-independently (CI-stable).
import { describe, expect, test } from "bun:test";
import { bestBefore, forecastPlants, projectedHarvestDate } from "../src/services/forecast";

const iso = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

describe("projectedHarvestDate (plantDate + daysToHarvest, D-07)", () => {
  test("2026-07-06 + 45 days = 2026-08-20 (month rollover)", () => {
    expect(iso(projectedHarvestDate(new Date(Date.UTC(2026, 6, 6)), 45))).toBe("2026-08-20");
  });

  test("crosses a year boundary", () => {
    expect(iso(projectedHarvestDate(new Date(Date.UTC(2026, 11, 20)), 30))).toBe("2027-01-19");
  });

  test("does not mutate the input date", () => {
    const plant = new Date(Date.UTC(2026, 6, 6));
    projectedHarvestDate(plant, 45);
    expect(iso(plant)).toBe("2026-07-06");
  });
});

describe("forecastPlants (plantCount × survivalPct%, floored — D-02)", () => {
  test("forecastPlants(200, 90) = 180", () => {
    expect(forecastPlants(200, 90)).toBe(180);
  });

  test("forecastPlants(201, 90) = 180 (conservative floor, never 181)", () => {
    expect(forecastPlants(201, 90)).toBe(180);
  });

  test("100% survival returns the full count", () => {
    expect(forecastPlants(200, 100)).toBe(200);
  });

  test("0% survival returns 0", () => {
    expect(forecastPlants(200, 0)).toBe(0);
  });
});

describe("bestBefore (harvestDate + shelfLifeDays, D-05)", () => {
  test("harvest 2026-08-20 + 7-day shelf life = 2026-08-27", () => {
    expect(iso(bestBefore(new Date(Date.UTC(2026, 7, 20)), 7))).toBe("2026-08-27");
  });

  test("does not mutate the input date", () => {
    const harvest = new Date(Date.UTC(2026, 7, 20));
    bestBefore(harvest, 7);
    expect(iso(harvest)).toBe("2026-08-20");
  });
});
