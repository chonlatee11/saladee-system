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
//                              SALE-01/02 / D-11), and the resolved tiered prices
//                              incl. whole-baht derived pack prices. The b2b
//                              (wholesale) tier is GATED (D-08 / T-03-21): only an
//                              approved-B2B customer bearer session receives it —
//                              anonymous and non-approved callers get b2b: null
//                              (key stays present; response shape unchanged).
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
import { type Session, verifySession } from "../plugins/auth.plugin";
import { wholesaleVisible } from "../services/b2b";
import { deriveUnitPriceSatang } from "../services/pricing";
import { boxAvailability } from "../services/reservation";

type CatalogDb = PostgresJsDatabase<typeof schema>;
type Tier = "b2c" | "b2b";

const SOLD_OUT_LABEL = "หมดรอบนี้"; // INV-08

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

/** Extract a Bearer token from either the lower- or upper-case Authorization header. */
function bearer(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

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
    showB2b: boolean,
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
        // D-08 / T-03-21: wholesale tier only for approved-B2B customer sessions.
        b2b: showB2b ? tierPricePayload(resolveTierPrice(relevant, "b2b", today), units) : null,
      },
    };
  }

  /** D-08 / T-03-21: wholesale is visible ONLY to an approved-B2B CUSTOMER session.
   *  Staff tokens and anonymous callers get false (staff read wholesale via the
   *  staff /prices routes, not the public catalog). Fail-closed. */
  async function showB2bFor(session: Session | null): Promise<boolean> {
    return (
      session !== null &&
      session.role === "customer" &&
      (await wholesaleVisible(database, session.sub))
    );
  }

  return (
    new Elysia()
      // Resolve an OPTIONAL session per request (missing/invalid token → null).
      // The catalog stays OPEN (D-03) — this is context, never a 401 gate.
      .derive(async ({ headers }) => {
        const token = bearer(headers);
        if (!token) return { session: null as Session | null };
        try {
          return { session: (await verifySession(token)) as Session | null };
        } catch {
          return { session: null as Session | null };
        }
      })
      // WR-01: every catalog response varies by the caller's session — b2b
      // wholesale prices are gated per Authorization (see showB2bFor). Mark the
      // response private + Vary so a shared cache (Caddy/Cloudflare) can never
      // serve an approved customer's wholesale prices to an anonymous caller.
      .onAfterHandle(({ set }) => {
        set.headers["cache-control"] = "private, no-store";
        set.headers.vary = "Authorization";
      })
      // OPEN (D-03): all open rounds' sellable varieties, grouped by variety.
      .get("/catalog", async ({ session }) => {
        const today = new Date().toISOString().slice(0, 10);
        const showB2b = await showB2bFor(session);
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
                showB2b,
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
                  // D-08 / T-03-21: wholesale box price gated like the variety tier.
                  priceSatang: {
                    b2c: priceForTier("b2c"),
                    b2b: showB2b ? priceForTier("b2b") : null,
                  },
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
        async ({ params, set, session }) => {
          const today = new Date().toISOString().slice(0, 10);
          const showB2b = await showB2bFor(session);
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
              const entry = roundEntry(s, round, vUnits, priceRows, today, showB2b);
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
