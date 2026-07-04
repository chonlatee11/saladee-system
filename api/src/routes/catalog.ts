// Public (no-auth) catalog reads — the customer-facing surface Phase-2 LIFF
// consumes (01-04, INV-08 / SALE-04 / SALE-01 / SALE-02 / D-03 / D-11 / D-20).
//
//   GET /catalog             — OPEN (D-03): every OPEN round's sellable varieties,
//                              grouped BY variety so one variety surfaces all the
//                              rounds/modes it sells in (SALE-04). Per (variety,
//                              round): availability = quota_plants − reserved_plants,
//                              soldOut + label "หมดรอบนี้" when availability <= 0
//                              (INV-08), the derived saleMode ("preorder" if the
//                              round's harvest_date is in the future else "ready" —
//                              SALE-01/02 / D-11), and the resolved b2c/b2b tiered
//                              prices incl. whole-baht derived pack prices.
//   GET /catalog/rounds/:id   — OPEN: the same surface scoped to a single round
//                              (round-centric: its varieties). 404 if the round
//                              does not exist.
//
// Reads expose ONLY catalog fields (variety/sale_unit/round/price/stock) — never
// customers/orders (T-01-15). Price resolution reuses the 01-03 rule (a row dated
// for today wins, else the effective_date IS NULL round default). No role guard is
// mounted — the catalog is public (D-03). DI: makeCatalogRoutes(db) mirrors peers.
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  boxComponents,
  boxes,
  prices,
  roundStock,
  rounds,
  saleUnits,
  varieties,
} from "../db/schema";
import { deriveUnitPriceSatang } from "../services/pricing";
import { boxAvailability } from "../services/reservation";

type CatalogDb = PostgresJsDatabase<typeof schema>;
type Tier = "b2c" | "b2b";

const SOLD_OUT_LABEL = "หมดรอบนี้"; // INV-08

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

type SaleUnitRow = typeof saleUnits.$inferSelect;
type PriceRow = typeof prices.$inferSelect;

/** Derived sale mode: a round harvested in the future is pre-order (SALE-01); a
 *  round already harvested (or with no harvest date yet scheduled) is ready-to-ship
 *  once available (SALE-02). Compared as YYYY-MM-DD strings (D-11). */
function saleModeFor(harvestDate: string | null, today: string): "preorder" | "ready" {
  if (harvestDate && harvestDate > today) return "preorder";
  return "ready";
}

/** Resolve the effective price for (tier) among the pre-filtered rows for a
 *  (round, variety): a row dated for `today` wins, else the NULL-date default. */
function resolveTierPrice(rows: PriceRow[], tier: Tier, today: string): PriceRow | null {
  const candidates = rows.filter(
    (r) => r.tier === tier && (r.effectiveDate === null || r.effectiveDate === today),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((r) => r.effectiveDate === today) ??
    candidates.find((r) => r.effectiveDate === null) ??
    null
  );
}

/** Shape a resolved tier price + its derived whole-baht pack prices (INV-04). */
function tierPricePayload(row: PriceRow | null, units: SaleUnitRow[]) {
  if (!row) return null;
  return {
    pricePerKgSatang: row.pricePerKgSatang,
    effectiveDate: row.effectiveDate,
    packs: units.map((u) => ({
      saleUnitId: u.id,
      kind: u.kind,
      label: u.label,
      gramsPerUnit: u.gramsPerUnit,
      unitPriceSatang: deriveUnitPriceSatang(row.pricePerKgSatang, u.gramsPerUnit),
    })),
  };
}

export function makeCatalogRoutes(database: CatalogDb = defaultDb) {
  /** Build the per-(variety,round) entry: availability, sold-out, mode, prices. */
  function roundEntry(
    stockRow: typeof roundStock.$inferSelect,
    round: typeof rounds.$inferSelect,
    units: SaleUnitRow[],
    priceRows: PriceRow[],
    today: string,
  ) {
    const availability = stockRow.quotaPlants - stockRow.reservedPlants;
    const soldOut = availability <= 0;
    const relevant = priceRows.filter(
      (p) => p.roundId === round.id && p.varietyId === stockRow.varietyId,
    );
    return {
      roundId: round.id,
      roundName: round.name,
      harvestDate: round.harvestDate,
      deliveryDate: round.deliveryDate,
      saleMode: saleModeFor(round.harvestDate, today),
      availability,
      soldOut,
      soldOutLabel: soldOut ? SOLD_OUT_LABEL : null,
      prices: {
        b2c: tierPricePayload(resolveTierPrice(relevant, "b2c", today), units),
        b2b: tierPricePayload(resolveTierPrice(relevant, "b2b", today), units),
      },
    };
  }

  return (
    new Elysia()
      // OPEN (D-03): all open rounds' sellable varieties, grouped by variety.
      .get("/catalog", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const openRounds = await database.select().from(rounds).where(eq(rounds.status, "open"));
        if (openRounds.length === 0) return { varieties: [], boxes: [] };
        const roundIds = openRounds.map((r) => r.id);
        const roundById = new Map(openRounds.map((r) => [r.id, r]));

        const stock = await database
          .select()
          .from(roundStock)
          .where(inArray(roundStock.roundId, roundIds));
        if (stock.length === 0) return { varieties: [], boxes: [] };

        const varietyIds = [...new Set(stock.map((s) => s.varietyId))];
        const vs = await database
          .select()
          .from(varieties)
          .where(and(inArray(varieties.id, varietyIds), eq(varieties.active, true)));
        if (vs.length === 0) return { varieties: [], boxes: [] };
        const activeVarietyIds = new Set(vs.map((v) => v.id));
        const varietyById = new Map(vs.map((v) => [v.id, v]));

        const units = await database
          .select()
          .from(saleUnits)
          .where(and(inArray(saleUnits.varietyId, varietyIds), eq(saleUnits.active, true)));
        const priceRows = await database
          .select()
          .from(prices)
          .where(
            and(
              inArray(prices.roundId, roundIds),
              inArray(prices.varietyId, varietyIds),
              or(isNull(prices.effectiveDate), eq(prices.effectiveDate, today)),
            ),
          );

        const result = vs.map((v) => {
          const vUnits = units.filter((u) => u.varietyId === v.id);
          const vRounds = stock
            .filter((s) => s.varietyId === v.id && roundById.has(s.roundId))
            .map((s) =>
              roundEntry(
                s,
                roundById.get(s.roundId) as typeof rounds.$inferSelect,
                vUnits,
                priceRows,
                today,
              ),
            );
          return {
            id: v.id,
            name: v.name,
            category: v.category,
            description: v.description,
            imageUrl: v.imageUrl,
            avgGramsPerPlant: v.avgGramsPerPlant,
            deliveryClass: v.deliveryClass, // D-13/D-24 care surface
            storageTips: v.storageTips, // D-24 (nullable)
            washingTips: v.washingTips, // D-24 (nullable)
            saleUnits: vUnits.map((u) => ({
              id: u.id,
              kind: u.kind,
              label: u.label,
              gramsPerUnit: u.gramsPerUnit,
              plantsPerUnit: u.plantsPerUnit,
            })),
            rounds: vRounds,
          };
        });
        // ── Boxes (01-05, INV-07): each active box + its per-round availability ──
        // A box is OFFERED in an open round only when every component has a stock row
        // there; its availability = min(floor((quota−reserved)/plantsPerBox)) across
        // components (the scarcest one governs), and its price is the fixed override
        // else the sum of component prices (D-18) per tier — all resolved server-side.
        const boxRows = await database.select().from(boxes).where(eq(boxes.active, true));
        const boxComps = boxRows.length
          ? await database
              .select()
              .from(boxComponents)
              .where(
                inArray(
                  boxComponents.boxId,
                  boxRows.map((b) => b.id),
                ),
              )
          : [];
        // roundId → (varietyId → stock counter), for the box availability lookup.
        const stockByRoundVariety = new Map<string, Map<string, (typeof stock)[number]>>();
        for (const s of stock) {
          let m = stockByRoundVariety.get(s.roundId);
          if (!m) {
            m = new Map();
            stockByRoundVariety.set(s.roundId, m);
          }
          m.set(s.varietyId, s);
        }
        const boxesOut = boxRows
          .map((b) => {
            const comps = boxComps.filter((c) => c.boxId === b.id);
            const bomComponents = comps.map((c) => ({
              varietyId: c.varietyId,
              plantsPerBox: c.plantsPerBox,
            }));
            const roundsOut = openRounds
              // Offer the box only in rounds where EVERY component is stocked.
              .filter((round) => {
                const m = stockByRoundVariety.get(round.id);
                return comps.length > 0 && comps.every((c) => m?.has(c.varietyId));
              })
              .map((round) => {
                const m = stockByRoundVariety.get(round.id) as Map<string, (typeof stock)[number]>;
                const stockMap = new Map(
                  comps.map((c) => {
                    const s = m.get(c.varietyId) as (typeof stock)[number];
                    return [
                      c.varietyId,
                      { quotaPlants: s.quotaPlants, reservedPlants: s.reservedPlants },
                    ];
                  }),
                );
                const availability = boxAvailability(bomComponents, stockMap);
                const soldOut = availability <= 0;
                const priceForTier = (tier: Tier): number | null => {
                  if (b.fixedPriceSatang !== null) return b.fixedPriceSatang;
                  let sum = 0;
                  for (const c of comps) {
                    const variety = varietyById.get(c.varietyId);
                    if (!variety) return null;
                    const relevant = priceRows.filter(
                      (p) => p.roundId === round.id && p.varietyId === c.varietyId,
                    );
                    const pr = resolveTierPrice(relevant, tier, today);
                    if (!pr) return null;
                    sum += deriveUnitPriceSatang(
                      pr.pricePerKgSatang,
                      c.plantsPerBox * variety.avgGramsPerPlant,
                    );
                  }
                  return sum;
                };
                return {
                  roundId: round.id,
                  roundName: round.name,
                  harvestDate: round.harvestDate,
                  deliveryDate: round.deliveryDate,
                  saleMode: saleModeFor(round.harvestDate, today),
                  availability,
                  soldOut,
                  soldOutLabel: soldOut ? SOLD_OUT_LABEL : null,
                  priceSatang: { b2c: priceForTier("b2c"), b2b: priceForTier("b2b") },
                };
              });
            return {
              id: b.id,
              name: b.name,
              description: b.description,
              imageUrl: b.imageUrl,
              fixedPriceSatang: b.fixedPriceSatang,
              components: bomComponents,
              rounds: roundsOut,
            };
          })
          // Only surface boxes actually offered in at least one open round.
          .filter((b) => b.rounds.length > 0);

        // Only surface varieties that actually sell in at least one open round.
        return {
          varieties: result.filter((v) => activeVarietyIds.has(v.id) && v.rounds.length > 0),
          boxes: boxesOut,
        };
      })
      // OPEN (D-03): the same surface scoped to one round (round-centric).
      .get(
        "/catalog/rounds/:id",
        async ({ params, set }) => {
          const today = new Date().toISOString().slice(0, 10);
          const [round] = await database
            .select()
            .from(rounds)
            .where(eq(rounds.id, params.id))
            .limit(1);
          if (!round) {
            set.status = 404;
            return { error: "round_not_found" };
          }
          const stock = await database
            .select()
            .from(roundStock)
            .where(eq(roundStock.roundId, round.id));
          const varietyIds = [...new Set(stock.map((s) => s.varietyId))];
          const vs =
            varietyIds.length > 0
              ? await database
                  .select()
                  .from(varieties)
                  .where(and(inArray(varieties.id, varietyIds), eq(varieties.active, true)))
              : [];
          const activeIds = new Set(vs.map((v) => v.id));
          const vById = new Map(vs.map((v) => [v.id, v]));
          const units =
            varietyIds.length > 0
              ? await database
                  .select()
                  .from(saleUnits)
                  .where(and(inArray(saleUnits.varietyId, varietyIds), eq(saleUnits.active, true)))
              : [];
          const priceRows =
            varietyIds.length > 0
              ? await database
                  .select()
                  .from(prices)
                  .where(
                    and(
                      eq(prices.roundId, round.id),
                      inArray(prices.varietyId, varietyIds),
                      or(isNull(prices.effectiveDate), eq(prices.effectiveDate, today)),
                    ),
                  )
              : [];

          const varietiesOut = stock
            .filter((s) => activeIds.has(s.varietyId))
            .map((s) => {
              const v = vById.get(s.varietyId) as typeof varieties.$inferSelect;
              const vUnits = units.filter((u) => u.varietyId === v.id);
              const entry = roundEntry(s, round, vUnits, priceRows, today);
              return {
                id: v.id,
                name: v.name,
                category: v.category,
                description: v.description,
                imageUrl: v.imageUrl,
                avgGramsPerPlant: v.avgGramsPerPlant,
                deliveryClass: v.deliveryClass, // D-13/D-24 care surface
                storageTips: v.storageTips, // D-24 (nullable)
                washingTips: v.washingTips, // D-24 (nullable)
                saleUnits: vUnits.map((u) => ({
                  id: u.id,
                  kind: u.kind,
                  label: u.label,
                  gramsPerUnit: u.gramsPerUnit,
                  plantsPerUnit: u.plantsPerUnit,
                })),
                availability: entry.availability,
                soldOut: entry.soldOut,
                soldOutLabel: entry.soldOutLabel,
                prices: entry.prices,
              };
            });

          return {
            round: {
              id: round.id,
              name: round.name,
              status: round.status,
              harvestDate: round.harvestDate,
              deliveryDate: round.deliveryDate,
              saleMode: saleModeFor(round.harvestDate, today),
            },
            varieties: varietiesOut,
          };
        },
        { params: IdParams },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const catalogRoutes = makeCatalogRoutes();
