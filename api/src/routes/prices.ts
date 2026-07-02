// Per-kg pricing staff CRUD + daily override + auto pack price + history
// (01-03, INV-02/INV-04, D-12..D-15, OQ-2 / D-03).
//
//   POST /prices             — staff (owner|admin): set price_per_kg_satang for
//                              (roundId, varietyId, tier). effectiveDate omitted =
//                              the NULL-date round default; a dated effectiveDate =
//                              a daily override. Both persist ⇒ price history.
//   PUT  /prices/:id          — staff: patch a price row's price_per_kg_satang.
//   GET  /prices             — OPEN (D-03): price history, filterable by
//                              ?roundId&varietyId&tier.
//   GET  /prices/resolve      — OPEN: resolve (roundId,varietyId,tier,date) → the
//                              dated override for that day if present, else the
//                              NULL-date default, PLUS the auto-derived whole-baht
//                              pack price for each of the variety's sale_units
//                              (deriveUnitPriceSatang — INV-04/D-13). This is the
//                              resolution the public catalog (01-04) reuses.
//
// Money is ALWAYS integer satang (t.Integer, no float). DI: makePricesRoutes(db)
// mirrors makeOrdersRoutes/makeVarietiesRoutes; writes are requireRole-gated.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { prices, saleUnits } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { deriveUnitPriceSatang } from "../services/pricing";

type CatalogDb = PostgresJsDatabase<typeof schema>;
type Tier = "b2c" | "b2b";

const CreatePriceBody = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  tier: t.Union([t.Literal("b2c"), t.Literal("b2b")]),
  pricePerKgSatang: t.Integer({ minimum: 0 }), // integer satang; negative/fractional → 422
  effectiveDate: t.Optional(t.String({ format: "date" })), // NULL default | dated override
});

const UpdatePriceBody = t.Object({
  pricePerKgSatang: t.Integer({ minimum: 0 }),
});

const HistoryQuery = t.Object({
  roundId: t.Optional(t.String({ format: "uuid" })),
  varietyId: t.Optional(t.String({ format: "uuid" })),
  tier: t.Optional(t.Union([t.Literal("b2c"), t.Literal("b2b")])),
});

const ResolveQuery = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  tier: t.Union([t.Literal("b2c"), t.Literal("b2b")]),
  date: t.Optional(t.String({ format: "date" })),
});

export function makePricesRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // Staff write: create a price row (default or dated override).
      .post(
        "/prices",
        async ({ body, set }) => {
          const [row] = await database
            .insert(prices)
            .values({
              roundId: body.roundId,
              varietyId: body.varietyId,
              tier: body.tier,
              pricePerKgSatang: body.pricePerKgSatang,
              effectiveDate: body.effectiveDate ?? null,
            })
            .returning();
          if (!row) throw new Error("price insert returned no row");
          set.status = 201;
          return row;
        },
        { body: CreatePriceBody, beforeHandle: staff },
      )
      .put(
        "/prices/:id",
        async ({ params, body, set }) => {
          const [row] = await database
            .update(prices)
            .set({ pricePerKgSatang: body.pricePerKgSatang })
            .where(eq(prices.id, params.id))
            .returning();
          if (!row) {
            set.status = 404;
            return { error: "price_not_found" };
          }
          return row;
        },
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          body: UpdatePriceBody,
          beforeHandle: staff,
        },
      )
      // OPEN read: price history (filterable). Retains the full set of rows (D-14).
      .get(
        "/prices",
        async ({ query }) => {
          const conds = [];
          if (query.roundId) conds.push(eq(prices.roundId, query.roundId));
          if (query.varietyId) conds.push(eq(prices.varietyId, query.varietyId));
          if (query.tier) conds.push(eq(prices.tier, query.tier as Tier));
          const base = database.select().from(prices);
          return conds.length > 0 ? base.where(and(...conds)) : base;
        },
        { query: HistoryQuery },
      )
      // OPEN read: resolve the effective price for a day + derive pack prices.
      .get(
        "/prices/resolve",
        async ({ query, set }) => {
          const date = query.date ?? new Date().toISOString().slice(0, 10);
          const tier = query.tier as Tier;
          // Dated-for-`date` wins; else the NULL-date default. DESC NULLS LAST ⇒
          // a dated row sorts before NULL (mirrors the orders.ts resolution / OQ-2).
          const [row] = await database
            .select({
              pricePerKgSatang: prices.pricePerKgSatang,
              effectiveDate: prices.effectiveDate,
            })
            .from(prices)
            .where(
              and(
                eq(prices.roundId, query.roundId),
                eq(prices.varietyId, query.varietyId),
                eq(prices.tier, tier),
                or(isNull(prices.effectiveDate), eq(prices.effectiveDate, date)),
              ),
            )
            .orderBy(sql`${prices.effectiveDate} DESC NULLS LAST`)
            .limit(1);
          if (!row) {
            set.status = 404;
            return { error: "no_price" };
          }
          const units = await database
            .select()
            .from(saleUnits)
            .where(eq(saleUnits.varietyId, query.varietyId));
          return {
            roundId: query.roundId,
            varietyId: query.varietyId,
            tier,
            date,
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
        },
        { query: ResolveQuery },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const pricesRoutes = makePricesRoutes();
