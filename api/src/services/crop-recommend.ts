// Demand-driven planting recommendation (04-07 / CROP-07 / D-23/24/25).
//
// This closes the demand→supply loop on the PROVEN forecast kernel. forecast.ts
// projects sellable plants FROM a plant count (plantCount × survivalPct%, floored —
// the conservative haircut). CROP-07 is the INVERSE: given the plants a round must
// SELL (its trailing demand), how many must we PLANT so the survival haircut still
// leaves enough? That is plantsToMeetDemand — ceil(demand × 100 / survivalPct) —
// the arithmetic inverse of forecastPlants. We MUST NOT invent a second yield
// formula: this is the same survival authority, run backwards.
//
// The demand SIGNAL (computeDemandRecommendation) is a trailing average over the
// last N rounds of:
//   • realised sales  — Σ order_lines.plants_decremented on SOLD_STATUSES orders
//                        (mirrors reports.ts SOLD_STATUSES), per variety, and
//   • unmet demand    — back_in_stock_requests per variety, converted to a plant
//                        estimate by a CONFIGURABLE heuristic (default one pack-
//                        equivalent per request). Counting unmet demand means a
//                        stockout never UNDERCOUNTS how much the round should plant.
// Every figure is a Drizzle PARAMETERISED `sql` aggregate (reports.ts whereFrag
// idiom) — user input is bound, NEVER string-concatenated (T-04-23).
//
// The compute is on-demand (A2/NFR-08 — cheaper than a scheduled job); the route
// layer gates it to owner|admin|grower and the admin applies the result as a
// prefill (D-25 — the recommendation never silently overwrites the mix).
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";

export type CropRecommendDb = PostgresJsDatabase<typeof schema>;

// Statuses that count as realised demand (paid onward). Mirrors reports.ts:36 /
// dashboard.ts — a created/awaiting_payment order is not demand yet, cancelled never.
const SOLD_STATUSES = ["paid", "packing", "shipping", "done"] as const;

// Trailing window: how many recent rounds of realised-sales history to average over.
// A weekly round → ~4 rounds ≈ a month of demand. Configurable per call (D-23).
export const DEFAULT_N_ROUNDS = 4;

// Unmet-demand heuristic (A6, D-23): each back-in-stock request is worth this many
// plants of demand — default one pack-equivalent (the common 2-plants/pack unit).
// Tunable per call so the owner can dial the stockout weighting.
export const DEFAULT_PLANTS_PER_REQUEST = 2;

export interface DemandRecommendationOptions {
  /** Trailing window of recent rounds to average demand over (default DEFAULT_N_ROUNDS). */
  nRounds?: number;
  /** Plants of demand per back-in-stock request (default DEFAULT_PLANTS_PER_REQUEST). */
  plantsPerRequest?: number;
}

export interface DemandRecommendationItem {
  varietyId: string;
  varietyName: string;
  survivalPct: number;
  /** Trailing-avg demand plants (realised sales + unmet), rounded. */
  demandPlants: number;
  /** Plants to sow so the survival haircut still meets demandPlants. */
  recommendedPlants: number;
}

export interface DemandRecommendation {
  /** True when fewer than nRounds of realised-sales history exist (drives the UI empty state). */
  noData: boolean;
  nRounds: number;
  /** Distinct rounds of realised-sales history the average was taken over (≤ nRounds). */
  roundsConsidered: number;
  items: DemandRecommendationItem[];
}

/**
 * PURE inverse of forecast.ts forecastPlants (survival haircut), DB-free so it
 * unit-tests trivially and can be reused anywhere.
 *   forecastPlants(200, 90) = floor(200×90/100) = 180  (sell this many)
 *   plantsToMeetDemand(180, 90) = ceil(180×100/90) = 200  (plant this many)
 * Rounds UP (ceil): we must never plant too FEW to meet demand after the haircut.
 * survivalPct is 1–100; a non-positive survival is clamped to 1 to stay finite.
 */
export function plantsToMeetDemand(demandPlants: number, survivalPct: number): number {
  if (demandPlants <= 0) return 0;
  const pct = survivalPct > 0 ? survivalPct : 1;
  return Math.ceil((demandPlants * 100) / pct);
}

/**
 * Compute the per-variety planting recommendation from trailing demand.
 *
 * Aggregate shape (all parameterised — reports.ts whereFrag idiom, never concat):
 *   recent_rounds = the last `nRounds` rounds (by created_at) that have realised sales.
 *   sales         = Σ plants_decremented per variety on SOLD_STATUSES orders in them.
 *   unmet         = back_in_stock_requests per variety in them × plantsPerRequest.
 *   demandPlants  = round((sales + unmet) / roundsConsidered)   ← trailing average.
 *   recommended   = plantsToMeetDemand(demandPlants, variety.survival_pct).
 * A variety with no realised sales AND no requests is omitted (nothing to recommend).
 * noData = fewer than `nRounds` distinct rounds of realised-sales history exist.
 */
export async function computeDemandRecommendation(
  db: CropRecommendDb,
  opts: DemandRecommendationOptions = {},
): Promise<DemandRecommendation> {
  const nRounds = opts.nRounds && opts.nRounds > 0 ? opts.nRounds : DEFAULT_N_ROUNDS;
  const plantsPerRequest =
    opts.plantsPerRequest && opts.plantsPerRequest > 0
      ? opts.plantsPerRequest
      : DEFAULT_PLANTS_PER_REQUEST;

  // How many distinct rounds of realised-sales history exist at all (for no-data).
  const availRows = (await db.execute(sql`
    select count(*)::int as n
    from (
      select distinct o.round_id
      from orders o
      where o.status::text in ${[...SOLD_STATUSES]}
    ) t
  `)) as unknown as { n: number }[];
  const availableRounds = Number(availRows[0]?.n ?? 0);
  const roundsConsidered = Math.min(availableRounds, nRounds);
  const noData = availableRounds < nRounds;

  // Nothing to average over yet — return the empty, no-data recommendation.
  if (roundsConsidered === 0) {
    return { noData, nRounds, roundsConsidered: 0, items: [] };
  }

  const rows = (await db.execute(sql`
    with recent_rounds as (
      select o.round_id, max(r.created_at) as created_at
      from orders o
      join rounds r on r.id = o.round_id
      where o.status::text in ${[...SOLD_STATUSES]}
      group by o.round_id
      order by created_at desc
      limit ${roundsConsidered}
    ),
    sales as (
      select ol.variety_id as variety_id,
             coalesce(sum(ol.plants_decremented), 0)::bigint as sales_plants
      from order_lines ol
      join orders o on o.id = ol.order_id
      where o.status::text in ${[...SOLD_STATUSES]}
        and o.round_id in (select round_id from recent_rounds)
        and ol.variety_id is not null
      group by ol.variety_id
    ),
    unmet as (
      select b.variety_id as variety_id, count(*)::int as requests
      from back_in_stock_requests b
      where b.round_id in (select round_id from recent_rounds)
      group by b.variety_id
    )
    select v.id           as variety_id,
           v.name         as variety_name,
           v.survival_pct as survival_pct,
           coalesce(s.sales_plants, 0)::bigint as sales_plants,
           coalesce(u.requests, 0)::int        as requests
    from varieties v
    left join sales s on s.variety_id = v.id
    left join unmet u on u.variety_id = v.id
    where s.variety_id is not null or u.variety_id is not null
    order by v.name asc
  `)) as unknown as {
    variety_id: string;
    variety_name: string;
    survival_pct: number;
    sales_plants: string;
    requests: number;
  }[];

  const items: DemandRecommendationItem[] = rows.map((r) => {
    const salesPlants = Number(r.sales_plants);
    const requests = Number(r.requests);
    const totalDemand = salesPlants + requests * plantsPerRequest;
    // Trailing average over the rounds we actually considered, rounded to a plant.
    const demandPlants = Math.round(totalDemand / roundsConsidered);
    const survivalPct = Number(r.survival_pct);
    return {
      varietyId: r.variety_id,
      varietyName: r.variety_name,
      survivalPct,
      demandPlants,
      recommendedPlants: plantsToMeetDemand(demandPlants, survivalPct),
    };
  });

  return { noData, nRounds, roundsConsidered, items };
}
