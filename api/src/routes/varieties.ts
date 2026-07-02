// Varieties + sale_units staff CRUD (01-03, INV-01/INV-03, D-22 / D-03).
//
//   GET    /varieties        — OPEN (D-03): list active+inactive varieties, each
//                              with its sale_units (packs incl. 250g/500g, INV-03).
//   GET    /varieties/:id     — OPEN: one variety + its sale_units.
//   POST   /varieties         — staff (owner|admin): create a variety + a list of
//                              sale_units in one transaction.
//   PUT    /varieties/:id      — staff: patch variety fields.
//   DELETE /varieties/:id      — staff: soft-delete (active=false) — never a hard
//                              delete, since sale_units/round_stock/prices/orders
//                              carry FKs to the variety.
//
// DI: makeVarietiesRoutes(db) injects the database so the endpoints test against
// an injected pool (mirrors makeOrdersRoutes/makeHealthRoutes). The default
// `varietiesRoutes` binds the runtime db and is what index.ts composes. Writes
// are gated by requireRole("owner","admin") as a per-route beforeHandle; the GET
// reads carry NO guard (public catalog, D-03).
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { saleUnits, varieties } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// A sale unit: 'pack' with grams_per_unit 250/500 is the fixed-weight pack (INV-03).
const SaleUnitBody = t.Object({
  kind: t.Union([t.Literal("kg"), t.Literal("bag"), t.Literal("pack"), t.Literal("plant")]),
  label: t.String({ minLength: 1 }),
  gramsPerUnit: t.Integer({ minimum: 1 }),
  plantsPerUnit: t.Integer({ minimum: 1 }),
});

const CreateVarietyBody = t.Object({
  name: t.String({ minLength: 1 }),
  category: t.Optional(t.String()),
  description: t.Optional(t.String()),
  imageUrl: t.Optional(t.String()),
  avgGramsPerPlant: t.Integer({ minimum: 1 }), // D-22 / CROP-01 seam
  saleUnits: t.Optional(t.Array(SaleUnitBody)),
});

const UpdateVarietyBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  category: t.Optional(t.String()),
  description: t.Optional(t.String()),
  imageUrl: t.Optional(t.String()),
  avgGramsPerPlant: t.Optional(t.Integer({ minimum: 1 })),
  active: t.Optional(t.Boolean()),
});

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

export function makeVarietiesRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // OPEN reads (D-03) — no guard.
      .get("/varieties", async () => {
        const vs = await database.select().from(varieties);
        if (vs.length === 0) return [];
        const units = await database
          .select()
          .from(saleUnits)
          .where(
            inArray(
              saleUnits.varietyId,
              vs.map((v) => v.id),
            ),
          );
        return vs.map((v) => ({ ...v, saleUnits: units.filter((u) => u.varietyId === v.id) }));
      })
      .get(
        "/varieties/:id",
        async ({ params, set }) => {
          const [v] = await database
            .select()
            .from(varieties)
            .where(eq(varieties.id, params.id))
            .limit(1);
          if (!v) {
            set.status = 404;
            return { error: "variety_not_found" };
          }
          const units = await database
            .select()
            .from(saleUnits)
            .where(eq(saleUnits.varietyId, v.id));
          return { ...v, saleUnits: units };
        },
        { params: IdParams },
      )
      // Staff writes (owner|admin) — requireRole beforeHandle.
      .post(
        "/varieties",
        async ({ body, set }) => {
          const created = await database.transaction(async (tx) => {
            const [v] = await tx
              .insert(varieties)
              .values({
                name: body.name,
                category: body.category ?? null,
                description: body.description ?? null,
                imageUrl: body.imageUrl ?? null,
                avgGramsPerPlant: body.avgGramsPerPlant,
              })
              .returning();
            if (!v) throw new Error("variety insert returned no row");
            let units: (typeof saleUnits.$inferSelect)[] = [];
            if (body.saleUnits && body.saleUnits.length > 0) {
              units = await tx
                .insert(saleUnits)
                .values(
                  body.saleUnits.map((u) => ({
                    varietyId: v.id,
                    kind: u.kind,
                    label: u.label,
                    gramsPerUnit: u.gramsPerUnit,
                    plantsPerUnit: u.plantsPerUnit,
                  })),
                )
                .returning();
            }
            return { ...v, saleUnits: units };
          });
          set.status = 201;
          return created;
        },
        { body: CreateVarietyBody, beforeHandle: staff },
      )
      .put(
        "/varieties/:id",
        async ({ params, body, set }) => {
          const patch: Partial<typeof varieties.$inferInsert> = {};
          if (body.name !== undefined) patch.name = body.name;
          if (body.category !== undefined) patch.category = body.category;
          if (body.description !== undefined) patch.description = body.description;
          if (body.imageUrl !== undefined) patch.imageUrl = body.imageUrl;
          if (body.avgGramsPerPlant !== undefined) patch.avgGramsPerPlant = body.avgGramsPerPlant;
          if (body.active !== undefined) patch.active = body.active;
          if (Object.keys(patch).length === 0) {
            set.status = 400;
            return { error: "no_fields" };
          }
          const [v] = await database
            .update(varieties)
            .set(patch)
            .where(eq(varieties.id, params.id))
            .returning();
          if (!v) {
            set.status = 404;
            return { error: "variety_not_found" };
          }
          return v;
        },
        { params: IdParams, body: UpdateVarietyBody, beforeHandle: staff },
      )
      .delete(
        "/varieties/:id",
        async ({ params, set }) => {
          // Soft-delete: FK'd by sale_units/round_stock/prices/order_lines.
          const [v] = await database
            .update(varieties)
            .set({ active: false })
            .where(eq(varieties.id, params.id))
            .returning({ id: varieties.id });
          if (!v) {
            set.status = 404;
            return { error: "variety_not_found" };
          }
          return { id: v.id, active: false };
        },
        { params: IdParams, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const varietiesRoutes = makeVarietiesRoutes();
