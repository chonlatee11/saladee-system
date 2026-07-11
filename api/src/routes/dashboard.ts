// Dashboard routes (Wave-2 owner-dashboard slice, 03-10 / ADM-01, D-23). Fills the
// 03-01 stub with ONE staff-gated at-a-glance aggregate GET. Every card is a
// server-side Drizzle aggregate (sql + groupBy / count) over EXISTING tables —
// this slice adds NO new stock counter and NEVER writes; it only reads the
// reservation state (round_stock), orders, forecast quota, and the overflow flags
// 03-06 raised. Money stays integer satang until the view formats it (D-13).
//
//   GET /dashboard?roundId — staff (owner|admin). roundId optional: omitted ⇒ the
//                            latest OPEN round is the "current" round. Returns the
//                            5 dashboard cards:
//                              1. salesTodaySatang / salesRoundSatang
//                              2. unpaidCount (orders awaiting payment this round)
//                              3. nearSoldOut[] (quota−reserved ≤ 20% of quota)
//                              4. nextRoundForecast[] (next round's quota_plants)
//                              5. subsDue / standingDue + overflowFlags[] (B2B card)
//                            hasOpenRound=false ⇒ the view shows the no-open-round
//                            empty state (UI-SPEC) — no round to summarise.
//
// RBAC (T-03-26): requireRole("owner","admin"); grower/packer/customer → 403, no
// token → 401. All SQL is Drizzle-parameterised (T-03-27) — no string concat.
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  orders,
  quotaOverflowFlags,
  roundStock,
  rounds,
  standingOrders,
  subscriptionOrders,
  subscriptionSkips,
  subscriptions,
  varieties,
} from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// Statuses that count as realised revenue (paid onward — a "created"/"awaiting_payment"
// order is not a sale yet, and "cancelled" never counts).
const SOLD_STATUSES = ["paid", "packing", "shipping", "done"] as const;
// Statuses that still owe payment (the "ค้างชำระ" card).
const UNPAID_STATUSES = ["created", "awaiting_payment"] as const;

const DashboardQuery = t.Object({
  roundId: t.Optional(t.String({ format: "uuid" })),
});

/** Sum an integer-satang column to a plain JS number (coalesce 0, cast bigint). */
function sumSatang(col: typeof orders.subtotalSatang) {
  return sql<number>`coalesce(sum(${col}), 0)::bigint`;
}

export function makeDashboardRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return new Elysia().get(
    "/dashboard",
    async ({ query }) => {
      // ── Resolve the "current" round ─────────────────────────────────────────
      // Explicit ?roundId wins; else the latest OPEN round. No open round ⇒ the
      // view renders the no-open-round empty state (nothing to summarise).
      let currentRound: { id: string; status: string } | undefined;
      if (query.roundId) {
        [currentRound] = await database
          .select({ id: rounds.id, status: rounds.status })
          .from(rounds)
          .where(eq(rounds.id, query.roundId))
          .limit(1);
      } else {
        [currentRound] = await database
          .select({ id: rounds.id, status: rounds.status })
          .from(rounds)
          .where(eq(rounds.status, "open"))
          .orderBy(desc(rounds.createdAt))
          .limit(1);
      }

      if (!currentRound) {
        return {
          hasOpenRound: false,
          roundId: null,
          salesTodaySatang: 0,
          salesRoundSatang: 0,
          unpaidCount: 0,
          nearSoldOut: [],
          nextRoundForecast: [],
          subsDue: 0,
          standingDue: 0,
          overflowFlags: [],
        };
      }
      const roundId = currentRound.id;

      // The next round to plan for = the newest round OTHER than the current one
      // (forecast quota_plants is the "ผลผลิตคาดรอบหน้า" card).
      const [nextRound] = await database
        .select({ id: rounds.id })
        .from(rounds)
        .where(ne(rounds.id, roundId))
        .orderBy(desc(rounds.createdAt))
        .limit(1);

      // ── Card 1: sales today (all rounds) + this round (all-time) ────────────
      const [salesToday] = await database
        .select({ total: sumSatang(orders.subtotalSatang) })
        .from(orders)
        .where(
          and(
            inArray(orders.status, [...SOLD_STATUSES]),
            sql`${orders.createdAt} >= date_trunc('day', now())`,
          ),
        );
      const [salesRound] = await database
        .select({ total: sumSatang(orders.subtotalSatang) })
        .from(orders)
        .where(and(eq(orders.roundId, roundId), inArray(orders.status, [...SOLD_STATUSES])));

      // ── Card 2: unpaid orders this round ────────────────────────────────────
      const [unpaid] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.roundId, roundId), inArray(orders.status, [...UNPAID_STATUSES])));

      // ── Card 3: near-sold-out this round (remaining ≤ 20% of quota) ──────────
      // Integer-safe threshold: (quota − reserved) * 5 ≤ quota  ⇔  remaining ≤ 20%.
      const nearSoldOut = await database
        .select({
          varietyId: roundStock.varietyId,
          variety: varieties.name,
          remaining: sql<number>`(${roundStock.quotaPlants} - ${roundStock.reservedPlants})::int`,
        })
        .from(roundStock)
        .innerJoin(varieties, eq(varieties.id, roundStock.varietyId))
        .where(
          and(
            eq(roundStock.roundId, roundId),
            sql`${roundStock.quotaPlants} > 0`,
            sql`(${roundStock.quotaPlants} - ${roundStock.reservedPlants}) * 5 <= ${roundStock.quotaPlants}`,
          ),
        )
        .orderBy(sql`(${roundStock.quotaPlants} - ${roundStock.reservedPlants})`);

      // ── Card 4: next-round forecast yield (quota_plants) ────────────────────
      const nextRoundForecast = nextRound
        ? await database
            .select({
              varietyId: roundStock.varietyId,
              variety: varieties.name,
              plants: roundStock.quotaPlants,
            })
            .from(roundStock)
            .innerJoin(varieties, eq(varieties.id, roundStock.varietyId))
            .where(eq(roundStock.roundId, nextRound.id))
            .orderBy(desc(roundStock.quotaPlants))
        : [];

      // ── Card 5: B2B / subscription due this round + overflow flags ──────────
      // standingDue = active recurring B2B baskets (reserved every round-open).
      const [standing] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(standingOrders)
        .where(eq(standingOrders.active, true));

      // subsDue = active subscriptions NOT skipped for this round and NOT already
      // generated an order for it (what round-open still owes a box to).
      const [subs] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, "active"),
            sql`not exists (select 1 from ${subscriptionSkips} where ${subscriptionSkips.subscriptionId} = ${subscriptions.id} and ${subscriptionSkips.roundId} = ${roundId})`,
            sql`not exists (select 1 from ${subscriptionOrders} where ${subscriptionOrders.subscriptionId} = ${subscriptions.id} and ${subscriptionOrders.roundId} = ${roundId})`,
          ),
        );

      const overflowFlags = await database
        .select({
          id: quotaOverflowFlags.id,
          varietyId: quotaOverflowFlags.varietyId,
          variety: varieties.name,
          shortfall: quotaOverflowFlags.shortfall,
          source: quotaOverflowFlags.source,
        })
        .from(quotaOverflowFlags)
        .innerJoin(varieties, eq(varieties.id, quotaOverflowFlags.varietyId))
        .where(and(eq(quotaOverflowFlags.roundId, roundId), isNull(quotaOverflowFlags.resolvedAt)));

      return {
        hasOpenRound: currentRound.status === "open",
        roundId,
        salesTodaySatang: Number(salesToday?.total ?? 0),
        salesRoundSatang: Number(salesRound?.total ?? 0),
        unpaidCount: unpaid?.count ?? 0,
        nearSoldOut,
        nextRoundForecast,
        subsDue: subs?.count ?? 0,
        standingDue: standing?.count ?? 0,
        overflowFlags,
      };
    },
    { query: DashboardQuery, beforeHandle: staff },
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const dashboardRoutes = makeDashboardRoutes();
