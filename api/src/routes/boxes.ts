// Mixed-salad box staff CRUD + the fixed BOM of component varieties (01-05,
// INV-07 / D-17 / D-18 / D-03).
//
//   GET    /boxes            — OPEN (D-03): list active boxes + their BOM.
//   GET    /boxes/:id         — OPEN: one box + its box_components BOM. 404 unknown.
//   POST   /boxes             — staff (owner|admin): create a box + its BOM
//                              (>=1 component, each { varietyId, plantsPerBox }),
//                              optional fixed_price_satang override (else price =
//                              sum of component prices at order/catalog time, D-18).
//   PUT    /boxes/:id         — staff: replace a box's fields + BOM.
//   DELETE /boxes/:id         — staff: soft-delete (active=false) so historical
//                              order_lines box_bom_json snapshots stay intact.
//
// A box is a fixed BOM (D-17); it carries NO round — availability/price are always
// resolved against a specific round's stock/prices (catalog & POST /orders). Writes
// are gated requireRole("owner","admin") (T-01-21); GET reads are public (D-03).
// DI: makeBoxesRoutes(db) mirrors makeRoundsRoutes/makeOrdersRoutes.
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { boxComponents, boxes } from "../db/schema";

import { requireRole } from "../plugins/auth.plugin";

type BoxesDb = PostgresJsDatabase<typeof schema>;

const ComponentBody = t.Object({
  varietyId: t.String({ format: "uuid" }),
  plantsPerBox: t.Integer({ minimum: 1 }), // >=1 plant per box (T-01 negative/zero guard)
});

const CreateBoxBody = t.Object({
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  imageUrl: t.Optional(t.String()),
  fixedPriceSatang: t.Optional(t.Integer({ minimum: 0 })), // D-18 override; else sum
  components: t.Array(ComponentBody, { minItems: 1 }), // fixed BOM, >=1 variety (D-17)
});

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

/** Load a box + its BOM components (shared by the GET reads). */
async function loadBoxWithComponents(database: BoxesDb, boxIds: string[]) {
  if (boxIds.length === 0) return new Map<string, (typeof boxComponents.$inferSelect)[]>();
  const comps = await database
    .select()
    .from(boxComponents)
    .where(inArray(boxComponents.boxId, boxIds));
  const byBox = new Map<string, (typeof boxComponents.$inferSelect)[]>();
  for (const c of comps) {
    const list = byBox.get(c.boxId) ?? [];
    list.push(c);
    byBox.set(c.boxId, list);
  }
  return byBox;
}

export function makeBoxesRoutes(database: BoxesDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // OPEN reads (D-03): active boxes with their BOM.
      .get("/boxes", async () => {
        const rows = await database.select().from(boxes).where(eq(boxes.active, true));
        const byBox = await loadBoxWithComponents(
          database,
          rows.map((b) => b.id),
        );
        return rows.map((b) => ({
          ...b,
          components: (byBox.get(b.id) ?? []).map((c) => ({
            varietyId: c.varietyId,
            plantsPerBox: c.plantsPerBox,
          })),
        }));
      })
      .get(
        "/boxes/:id",
        async ({ params, set }) => {
          const [b] = await database.select().from(boxes).where(eq(boxes.id, params.id)).limit(1);
          if (!b) {
            set.status = 404;
            return { error: "box_not_found" };
          }
          const comps = await database
            .select()
            .from(boxComponents)
            .where(eq(boxComponents.boxId, b.id));
          return {
            ...b,
            components: comps.map((c) => ({
              varietyId: c.varietyId,
              plantsPerBox: c.plantsPerBox,
            })),
          };
        },
        { params: IdParams },
      )
      // Staff writes (T-01-21): create a box + its fixed BOM in one transaction.
      .post(
        "/boxes",
        async ({ body, set }) => {
          const created = await database.transaction(async (tx) => {
            const [b] = await tx
              .insert(boxes)
              .values({
                name: body.name,
                description: body.description ?? null,
                imageUrl: body.imageUrl ?? null,
                fixedPriceSatang: body.fixedPriceSatang ?? null,
              })
              .returning();
            if (!b) throw new Error("box insert returned no row");
            await tx.insert(boxComponents).values(
              body.components.map((c) => ({
                boxId: b.id,
                varietyId: c.varietyId,
                plantsPerBox: c.plantsPerBox,
              })),
            );
            return b;
          });
          set.status = 201;
          return {
            ...created,
            components: body.components.map((c) => ({
              varietyId: c.varietyId,
              plantsPerBox: c.plantsPerBox,
            })),
          };
        },
        { body: CreateBoxBody, beforeHandle: staff },
      )
      // Staff: replace a box's fields + BOM wholesale.
      .put(
        "/boxes/:id",
        async ({ params, body, set }) => {
          const result = await database.transaction(async (tx) => {
            const [b] = await tx
              .update(boxes)
              .set({
                name: body.name,
                description: body.description ?? null,
                imageUrl: body.imageUrl ?? null,
                fixedPriceSatang: body.fixedPriceSatang ?? null,
              })
              .where(eq(boxes.id, params.id))
              .returning();
            if (!b) return null;
            // Replace the BOM: delete then re-insert the supplied components.
            await tx.delete(boxComponents).where(eq(boxComponents.boxId, b.id));
            await tx.insert(boxComponents).values(
              body.components.map((c) => ({
                boxId: b.id,
                varietyId: c.varietyId,
                plantsPerBox: c.plantsPerBox,
              })),
            );
            return b;
          });
          if (!result) {
            set.status = 404;
            return { error: "box_not_found" };
          }
          return {
            ...result,
            components: body.components.map((c) => ({
              varietyId: c.varietyId,
              plantsPerBox: c.plantsPerBox,
            })),
          };
        },
        { params: IdParams, body: CreateBoxBody, beforeHandle: staff },
      )
      // Staff: soft-delete (active=false) so historical order snapshots stay valid.
      .delete(
        "/boxes/:id",
        async ({ params, set }) => {
          const [b] = await database
            .update(boxes)
            .set({ active: false })
            .where(eq(boxes.id, params.id))
            .returning({ id: boxes.id });
          if (!b) {
            set.status = 404;
            return { error: "box_not_found" };
          }
          return { id: b.id, active: false };
        },
        { params: IdParams, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const boxesRoutes = makeBoxesRoutes();
