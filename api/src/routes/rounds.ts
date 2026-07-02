// Selling-rounds staff CRUD + the per-variety sellable-quota counter (01-03,
// INV-05 / D-09/D-10 / D-03).
//
//   GET   /rounds            — OPEN (D-03): list rounds.
//   GET   /rounds/:id         — OPEN: one round + its round_stock rows.
//   POST  /rounds             — staff (owner|admin): create a round (name, optional
//                              cutoff_at / harvest_date / delivery_date; status
//                              defaults 'open').
//   POST  /rounds/:id/stock    — staff: upsert a per-variety quota_plants (INV-05
//                              the manual sellable quantity) into round_stock.
//   PATCH /rounds/:id/status   — staff: flip status open ↔ closed (D-09).
//
// DI: makeRoundsRoutes(db) mirrors makeOrdersRoutes/makeVarietiesRoutes. Writes
// are gated by requireRole("owner","admin") beforeHandle; GET reads carry no guard.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { roundStock, rounds } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

const CreateRoundBody = t.Object({
  name: t.String({ minLength: 1 }),
  cutoffAt: t.Optional(t.String({ format: "date-time" })), // D-10 request-time cut-off
  harvestDate: t.Optional(t.String({ format: "date" })),
  deliveryDate: t.Optional(t.String({ format: "date" })),
  status: t.Optional(t.Union([t.Literal("open"), t.Literal("closed")])),
});

const StockBody = t.Object({
  varietyId: t.String({ format: "uuid" }),
  quotaPlants: t.Integer({ minimum: 0 }), // INV-05: negative/fractional rejected (T-01-12)
});

const RoundStatusBody = t.Object({
  status: t.Union([t.Literal("open"), t.Literal("closed")]),
});

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

export function makeRoundsRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // OPEN reads (D-03).
      .get("/rounds", async () => database.select().from(rounds))
      .get(
        "/rounds/:id",
        async ({ params, set }) => {
          const [r] = await database.select().from(rounds).where(eq(rounds.id, params.id)).limit(1);
          if (!r) {
            set.status = 404;
            return { error: "round_not_found" };
          }
          const stock = await database
            .select()
            .from(roundStock)
            .where(eq(roundStock.roundId, r.id));
          return { ...r, stock };
        },
        { params: IdParams },
      )
      // Staff writes.
      .post(
        "/rounds",
        async ({ body, set }) => {
          const [r] = await database
            .insert(rounds)
            .values({
              name: body.name,
              status: body.status ?? "open",
              cutoffAt: body.cutoffAt ? new Date(body.cutoffAt) : null,
              harvestDate: body.harvestDate ?? null,
              deliveryDate: body.deliveryDate ?? null,
            })
            .returning();
          if (!r) throw new Error("round insert returned no row");
          set.status = 201;
          return r;
        },
        { body: CreateRoundBody, beforeHandle: staff },
      )
      .post(
        "/rounds/:id/stock",
        async ({ params, body, set }) => {
          const [r] = await database
            .select({ id: rounds.id })
            .from(rounds)
            .where(eq(rounds.id, params.id))
            .limit(1);
          if (!r) {
            set.status = 404;
            return { error: "round_not_found" };
          }
          // Upsert the per-(round,variety) quota (unique round_stock_round_variety_idx).
          const [row] = await database
            .insert(roundStock)
            .values({
              roundId: params.id,
              varietyId: body.varietyId,
              quotaPlants: body.quotaPlants,
            })
            .onConflictDoUpdate({
              target: [roundStock.roundId, roundStock.varietyId],
              set: { quotaPlants: body.quotaPlants },
            })
            .returning();
          set.status = 200;
          return row;
        },
        { params: IdParams, body: StockBody, beforeHandle: staff },
      )
      .patch(
        "/rounds/:id/status",
        async ({ params, body, set }) => {
          const [r] = await database
            .update(rounds)
            .set({ status: body.status })
            .where(eq(rounds.id, params.id))
            .returning();
          if (!r) {
            set.status = 404;
            return { error: "round_not_found" };
          }
          return r;
        },
        { params: IdParams, body: RoundStatusBody, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const roundsRoutes = makeRoundsRoutes();
