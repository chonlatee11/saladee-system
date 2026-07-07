// SALE-03 / D-12 / OQ3 — the deterministic subscription box-fill proof. A
// subscription is a package BY VALUE (S/M/L satang); fillBox() is a PURE function
// that fills the box from the varieties available in a round up to (or as close as
// possible below) the package value, using an EXPLICIT deterministic order so the
// same availability + target always yields the same box (OQ3 — resolved to a tested
// pure fn). No DB, no clock, no randomness.
import { describe, expect, test } from "bun:test";
import { type FillCandidate, fillBox } from "../src/services/subscription";

// A convenience to arrange a candidate; availableUnits = plants orderable this round.
function cand(
  varietyId: string,
  unitPriceSatang: number,
  availableUnits: number,
  varietyName = varietyId,
): FillCandidate {
  return { varietyId, varietyName, unitPriceSatang, availableUnits };
}

describe("fillBox() — deterministic value-fill (D-12 / OQ3)", () => {
  test("fills a single variety up to the package value without overshooting", () => {
    // 100 baht/plant, plenty of stock, 500 baht package → exactly 5 plants = 500 baht.
    const box = fillBox([cand("a", 10000, 10)], 50000);
    expect(box.totalSatang).toBe(50000);
    expect(box.lines).toEqual([
      { varietyId: "a", varietyName: "a", units: 5, unitPriceSatang: 10000, lineValueSatang: 50000 },
    ]);
  });

  test("never overshoots the target — leftover budget under the cheapest unit is left unfilled", () => {
    // 240 baht/plant, target 500 baht → floor(50000/24000)=2 plants = 480 baht (< target).
    const box = fillBox([cand("a", 24000, 10)], 50000);
    expect(box.totalSatang).toBe(48000);
    expect(box.lines[0]?.units).toBe(2);
  });

  test("deterministic order: the deepest-stock variety is filled first (freshness/stock depth desc)", () => {
    // Both 100 baht/plant; B has more stock depth → B is chosen first and fills the box.
    const box = fillBox([cand("a", 10000, 3), cand("b", 10000, 10)], 50000);
    expect(box.lines).toHaveLength(1);
    expect(box.lines[0]?.varietyId).toBe("b");
    expect(box.totalSatang).toBe(50000);
  });

  test("uses multiple varieties to fill the remaining budget after the first is capped", () => {
    // Equal depth (10) → price desc tiebreak: A (300b) first, then B (100b) fills remainder.
    // target 800b: A → floor(80000/30000)=2 (=600b), remainder 200b → B → 2 (=200b) = 800b.
    const box = fillBox([cand("a", 30000, 10), cand("b", 10000, 10)], 80000);
    expect(box.totalSatang).toBe(80000);
    const byId = Object.fromEntries(box.lines.map((l) => [l.varietyId, l.units]));
    expect(byId).toEqual({ a: 2, b: 2 });
    // A (higher price) sorts before B under the equal-depth tiebreak.
    expect(box.lines[0]?.varietyId).toBe("a");
  });

  test("skips sold-out (0 available) and unpriced (0 satang) varieties", () => {
    const box = fillBox(
      [cand("soldout", 10000, 0), cand("noprice", 0, 10), cand("ok", 10000, 10)],
      30000,
    );
    expect(box.lines).toHaveLength(1);
    expect(box.lines[0]?.varietyId).toBe("ok");
    expect(box.totalSatang).toBe(30000);
  });

  test("empty availability yields an empty box worth 0", () => {
    const box = fillBox([], 50000);
    expect(box.lines).toEqual([]);
    expect(box.totalSatang).toBe(0);
  });
});
