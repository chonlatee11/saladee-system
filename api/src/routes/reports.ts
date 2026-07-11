// Sales reports / analytics aggregate (Wave-2 reports slice, 03-11 / MKT-04, D-24).
// Fills the 03-01 stub with ONE staff-gated aggregate GET /reports. Every figure is
// a server-side, Drizzle-PARAMETERISED aggregate (T-03-29 — never string concat)
// over the EXISTING commerce tables (orders, order_lines, subscription_orders,
// varieties): this slice adds NO new stock counter and NEVER writes. Money stays
// integer satang until the view formats it (D-13). CSV export is built client-side
// from this shaped JSON via papaparse (MVP client is enough — A5).
//
//   GET /reports?from&to&channel&product&round — staff (owner|admin). Returns:
//     • series:[{key,label,valueSatang,count}]  — realised sales grouped by CHANNEL
//       (b2c / b2b / subscription). channel = subscription when the order was
//       generated for a subscription (present in subscription_orders), else the
//       order's tier. Feeds the fixed channel↔color chart palette (UI-SPEC).
//     • bestSellers:[{varietyId,variety,qty,valueSatang}] — top varieties by qty.
//     • repeatCustomers:number — customers with >1 realised order in range.
//     • aovSatang:number — average order value (Σsubtotal / Σorders), integer satang.
//     • totalSatang / orderCount — the range totals the AOV derives from.
//   Filters (all optional, all parameterised): from/to (inclusive day range),
//   channel (b2c|b2b|subscription), product (varietyId — orders containing it),
//   round (roundId).
//
// RBAC (T-03-28): requireRole("owner","admin"); grower/packer/customer → 403,
// no token → 401. Only realised statuses (paid onward) count as sales — a
// created/awaiting_payment order is not a sale yet, cancelled never counts.
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// Statuses that count as realised revenue (paid onward). Mirrors dashboard.ts.
const SOLD_STATUSES = ["paid", "packing", "shipping", "done"] as const;

// Stable channel → Thai label. Keys match the fixed channel↔color chart palette
// (B2C green / B2B blue / Subscription amber — UI-SPEC §Chart categorical palette).
const CHANNEL_LABEL: Record<string, string> = {
  b2c: "ค้าปลีก (B2C)",
  b2b: "ค้าส่ง (B2B)",
  subscription: "สมาชิก (Subscription)",
};

const ReportsQuery = t.Object({
  from: t.Optional(t.String({ format: "date" })), // inclusive start day
  to: t.Optional(t.String({ format: "date" })), // inclusive end day
  channel: t.Optional(
    t.Union([t.Literal("b2c"), t.Literal("b2b"), t.Literal("subscription")]),
  ),
  product: t.Optional(t.String({ format: "uuid" })), // varietyId filter
  round: t.Optional(t.String({ format: "uuid" })),
});

type ReportsQueryType = typeof ReportsQuery.static;

/**
 * Build the shared WHERE fragment (alias `o` = orders). Every filter is bound as a
 * parameter (T-03-29 — no string interpolation of user input). Channels are kept
 * DISJOINT: a b2c/b2b filter excludes subscription-generated orders so the three
 * channels never double-count the same order.
 */
function whereFrag(q: ReportsQueryType): SQL {
  // Drizzle expands a JS array into a `(…)` tuple, so `in` (not `= ANY`) is the
  // valid form for the realised-status filter.
  const c: SQL[] = [sql`o.status::text in ${[...SOLD_STATUSES]}`];
  if (q.from) c.push(sql`o.created_at >= ${q.from}::date`);
  if (q.to) c.push(sql`o.created_at < (${q.to}::date + interval '1 day')`);
  if (q.round) c.push(sql`o.round_id = ${q.round}`);
  if (q.channel === "subscription") {
    c.push(sql`exists (select 1 from subscription_orders so where so.order_id = o.id)`);
  } else if (q.channel === "b2c" || q.channel === "b2b") {
    c.push(sql`o.tier::text = ${q.channel}`);
    c.push(sql`not exists (select 1 from subscription_orders so where so.order_id = o.id)`);
  }
  if (q.product) {
    c.push(
      sql`exists (select 1 from order_lines ol where ol.order_id = o.id and ol.variety_id = ${q.product})`,
    );
  }
  return sql.join(c, sql` and `);
}

export function makeReportsRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return new Elysia().get(
    "/reports",
    async ({ query }) => {
      const where = whereFrag(query);

      // ── Sales by channel (b2c / b2b / subscription) ─────────────────────────
      // Channel is derived per order in the inner select, then grouped in the
      // outer — grouping by a bare column (not a subquery) keeps Postgres happy.
      const seriesRows = (await database.execute(sql`
        select channel as key,
               coalesce(sum(subtotal_satang), 0)::bigint as value_satang,
               count(*)::int as count
        from (
          select o.id,
                 o.subtotal_satang,
                 case
                   when exists (select 1 from subscription_orders so where so.order_id = o.id)
                     then 'subscription'
                   else o.tier::text
                 end as channel
          from orders o
          where ${where}
        ) t
        group by channel
        order by value_satang desc
      `)) as unknown as { key: string; value_satang: string; count: number }[];

      // ── Best-sellers: top varieties by quantity sold (value alongside) ──────
      const bestRows = (await database.execute(sql`
        select ol.variety_id as variety_id,
               coalesce(v.name, ol.variety_name) as variety,
               sum(ol.qty)::int as qty,
               coalesce(sum(coalesce(ol.unit_price_satang, 0) * ol.qty), 0)::bigint as value_satang
        from order_lines ol
        join orders o on o.id = ol.order_id
        left join varieties v on v.id = ol.variety_id
        where ${where} and ol.variety_id is not null
        group by ol.variety_id, coalesce(v.name, ol.variety_name)
        order by qty desc, value_satang desc
        limit 20
      `)) as unknown as {
        variety_id: string;
        variety: string | null;
        qty: number;
        value_satang: string;
      }[];

      // ── Repeat customers: customers with >1 realised order in range ─────────
      const repeatRows = (await database.execute(sql`
        select count(*)::int as repeat_customers
        from (
          select o.customer_id
          from orders o
          where ${where}
          group by o.customer_id
          having count(*) > 1
        ) t
      `)) as unknown as { repeat_customers: number }[];

      // ── AOV: Σsubtotal / Σorders (integer satang) ───────────────────────────
      const totalsRows = (await database.execute(sql`
        select coalesce(sum(o.subtotal_satang), 0)::bigint as total,
               count(*)::int as orders
        from orders o
        where ${where}
      `)) as unknown as { total: string; orders: number }[];

      const totalSatang = Number(totalsRows[0]?.total ?? 0);
      const orderCount = Number(totalsRows[0]?.orders ?? 0);
      const aovSatang = orderCount > 0 ? Math.round(totalSatang / orderCount) : 0;

      return {
        series: seriesRows.map((r) => ({
          key: r.key,
          label: CHANNEL_LABEL[r.key] ?? r.key,
          valueSatang: Number(r.value_satang),
          count: Number(r.count),
        })),
        bestSellers: bestRows.map((r) => ({
          varietyId: r.variety_id,
          variety: r.variety ?? "—",
          qty: Number(r.qty),
          valueSatang: Number(r.value_satang),
        })),
        repeatCustomers: Number(repeatRows[0]?.repeat_customers ?? 0),
        aovSatang,
        totalSatang,
        orderCount,
      };
    },
    { query: ReportsQuery, beforeHandle: staff },
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const reportsRoutes = makeReportsRoutes();
