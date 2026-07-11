// Crop-planning routes (Wave-2 CROP slice, 03-04). Fills the 03-01 stub with the
// grower-gated variety-param / planting-batch / planting-mix endpoints. Every
// route closes over the injected db (makeCropRoutes(db) DI, mirrors varieties.ts)
// and is guarded by requireRole("owner","admin","grower") — a packer or customer
// session can never reach these (D-19 / T-03-07). Reads are guarded too: crop
// planning is staff-internal, not a public catalog.
//
// Computed fields (harvest date + expected plants) are NOT stored — they are
// derived on read via the pure forecast.ts kernel from the batch's variety
// params, so a param edit re-projects every batch without a data migration.
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  plantingBatches,
  plantingMixItems,
  plantingMixTemplates,
  varieties,
} from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { createBatchesFromMix } from "../services/crop";
import { forecastPlants, projectedHarvestDate } from "../services/forecast";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// ── TypeBox schemas (V5 input validation, T-03-09) ────────────────────────────
const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

// Variety yield params (CROP-01 / D-01). survivalPct is a percentage 0–100;
// the day/window/shelf counts are positive integers.
const VarietyParamsBody = t.Object({
  daysToHarvest: t.Integer({ minimum: 1 }),
  survivalPct: t.Integer({ minimum: 0, maximum: 100 }),
  harvestWindowDays: t.Integer({ minimum: 1 }),
  shelfLifeDays: t.Integer({ minimum: 1 }),
});

const PlantingBatchBody = t.Object({
  varietyId: t.String({ format: "uuid" }),
  plantDate: t.String({ minLength: 1 }), // ISO date/date-time; parsed + range-checked below
  plantCount: t.Integer({ minimum: 0 }),
  bed: t.Optional(t.Union([t.String(), t.Null()])),
});

const PlantingBatchPatchBody = t.Object({
  plantDate: t.Optional(t.String({ minLength: 1 })),
  plantCount: t.Optional(t.Integer({ minimum: 0 })),
  bed: t.Optional(t.Union([t.String(), t.Null()])),
});

const MixItemBody = t.Object({
  varietyId: t.String({ format: "uuid" }),
  plantCount: t.Integer({ minimum: 0 }),
});
const MixTemplateBody = t.Object({
  name: t.String({ minLength: 1 }),
  items: t.Array(MixItemBody, { minItems: 1 }),
});
const MixTemplatePatchBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  active: t.Optional(t.Boolean()),
  items: t.Optional(t.Array(MixItemBody, { minItems: 1 })),
});
const CreateBatchesBody = t.Object({ plantDate: t.String({ minLength: 1 }) });

/** Parse an ISO date string → Date; returns null on an invalid/NaN date (→ 422). */
function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function makeCropRoutes(database: CatalogDb = defaultDb) {
  const grower = requireRole("owner", "admin", "grower");

  return (
    new Elysia()
      // ── Variety yield params (CROP-01) ──────────────────────────────────────
      .put(
        "/crop/varieties/:id/params",
        async ({ params, body, set }) => {
          const [v] = await database
            .update(varieties)
            .set({
              daysToHarvest: body.daysToHarvest,
              survivalPct: body.survivalPct,
              harvestWindowDays: body.harvestWindowDays,
              shelfLifeDays: body.shelfLifeDays,
            })
            .where(eq(varieties.id, params.id))
            .returning();
          if (!v) {
            set.status = 404;
            return { error: "variety_not_found" };
          }
          return v;
        },
        { params: IdParams, body: VarietyParamsBody, beforeHandle: grower },
      )

      // ── Planting batches (CROP-02/03) ───────────────────────────────────────
      // GET returns each batch with a computed projected harvest date + expected
      // plants, derived from its variety params via forecast.ts (never stored).
      .get(
        "/crop/planting-batches",
        async () => {
          const rows = await database
            .select({
              batch: plantingBatches,
              daysToHarvest: varieties.daysToHarvest,
              survivalPct: varieties.survivalPct,
              varietyName: varieties.name,
            })
            .from(plantingBatches)
            .innerJoin(varieties, eq(plantingBatches.varietyId, varieties.id));
          return rows.map((r) => ({
            ...r.batch,
            varietyName: r.varietyName,
            projectedHarvestDate: projectedHarvestDate(
              r.batch.plantDate,
              r.daysToHarvest,
            ).toISOString(),
            expectedPlants: forecastPlants(r.batch.plantCount, r.survivalPct),
          }));
        },
        { beforeHandle: grower },
      )
      .post(
        "/crop/planting-batches",
        async ({ body, set }) => {
          const plantDate = parseDate(body.plantDate);
          if (!plantDate) {
            set.status = 422;
            return { error: "invalid_plant_date" };
          }
          // Look up the variety's params to compute + return the derived fields.
          const [v] = await database
            .select({
              daysToHarvest: varieties.daysToHarvest,
              survivalPct: varieties.survivalPct,
            })
            .from(varieties)
            .where(eq(varieties.id, body.varietyId))
            .limit(1);
          if (!v) {
            set.status = 404;
            return { error: "variety_not_found" };
          }
          const [batch] = await database
            .insert(plantingBatches)
            .values({
              varietyId: body.varietyId,
              plantDate,
              plantCount: body.plantCount,
              bed: body.bed ?? null,
            })
            .returning();
          if (!batch) throw new Error("planting batch insert returned no row");
          set.status = 201;
          return {
            ...batch,
            projectedHarvestDate: projectedHarvestDate(
              batch.plantDate,
              v.daysToHarvest,
            ).toISOString(),
            expectedPlants: forecastPlants(batch.plantCount, v.survivalPct),
          };
        },
        { body: PlantingBatchBody, beforeHandle: grower },
      )
      .patch(
        "/crop/planting-batches/:id",
        async ({ params, body, set }) => {
          const patch: Partial<typeof plantingBatches.$inferInsert> = {};
          if (body.plantDate !== undefined) {
            const d = parseDate(body.plantDate);
            if (!d) {
              set.status = 422;
              return { error: "invalid_plant_date" };
            }
            patch.plantDate = d;
          }
          if (body.plantCount !== undefined) patch.plantCount = body.plantCount;
          if (body.bed !== undefined) patch.bed = body.bed;
          if (Object.keys(patch).length === 0) {
            set.status = 400;
            return { error: "no_fields" };
          }
          const [batch] = await database
            .update(plantingBatches)
            .set(patch)
            .where(eq(plantingBatches.id, params.id))
            .returning();
          if (!batch) {
            set.status = 404;
            return { error: "batch_not_found" };
          }
          return batch;
        },
        { params: IdParams, body: PlantingBatchPatchBody, beforeHandle: grower },
      )
      .delete(
        "/crop/planting-batches/:id",
        async ({ params, set }) => {
          // planting_batches has no `active` column (frozen schema) and only feeds
          // forecast compute (not orders), so a batch is hard-deleted. A batch that
          // has been harvest-confirmed is FK'd by harvest_logs — that delete raises
          // a FK violation, surfaced as 409 (delete the lot first).
          try {
            const [batch] = await database
              .delete(plantingBatches)
              .where(eq(plantingBatches.id, params.id))
              .returning({ id: plantingBatches.id });
            if (!batch) {
              set.status = 404;
              return { error: "batch_not_found" };
            }
            return { id: batch.id, deleted: true };
          } catch {
            set.status = 409;
            return { error: "batch_has_harvest_log" };
          }
        },
        { params: IdParams, beforeHandle: grower },
      )

      // ── Planting-mix templates (CROP-06 / D-06) ─────────────────────────────
      .get(
        "/crop/mix-templates",
        async () => {
          const templates = await database.select().from(plantingMixTemplates);
          if (templates.length === 0) return [];
          const items = await database
            .select()
            .from(plantingMixItems)
            .where(
              inArray(
                plantingMixItems.templateId,
                templates.map((tpl) => tpl.id),
              ),
            );
          return templates.map((tpl) => ({
            ...tpl,
            items: items.filter((it) => it.templateId === tpl.id),
          }));
        },
        { beforeHandle: grower },
      )
      .post(
        "/crop/mix-templates",
        async ({ body, set }) => {
          const created = await database.transaction(async (tx) => {
            const [tpl] = await tx
              .insert(plantingMixTemplates)
              .values({ name: body.name })
              .returning();
            if (!tpl) throw new Error("mix template insert returned no row");
            const items = await tx
              .insert(plantingMixItems)
              .values(
                body.items.map((it) => ({
                  templateId: tpl.id,
                  varietyId: it.varietyId,
                  plantCount: it.plantCount,
                })),
              )
              .returning();
            return { ...tpl, items };
          });
          set.status = 201;
          return created;
        },
        { body: MixTemplateBody, beforeHandle: grower },
      )
      .patch(
        "/crop/mix-templates/:id",
        async ({ params, body, set }) => {
          const updated = await database.transaction(async (tx) => {
            const patch: Partial<typeof plantingMixTemplates.$inferInsert> = {};
            if (body.name !== undefined) patch.name = body.name;
            if (body.active !== undefined) patch.active = body.active;
            let tpl: typeof plantingMixTemplates.$inferSelect | undefined;
            if (Object.keys(patch).length > 0) {
              [tpl] = await tx
                .update(plantingMixTemplates)
                .set(patch)
                .where(eq(plantingMixTemplates.id, params.id))
                .returning();
            } else {
              [tpl] = await tx
                .select()
                .from(plantingMixTemplates)
                .where(eq(plantingMixTemplates.id, params.id))
                .limit(1);
            }
            if (!tpl) return null;
            // Replace the recipe wholesale when items are supplied (edit recipe).
            if (body.items !== undefined) {
              await tx
                .delete(plantingMixItems)
                .where(eq(plantingMixItems.templateId, tpl.id));
              await tx.insert(plantingMixItems).values(
                body.items.map((it) => ({
                  templateId: tpl!.id,
                  varietyId: it.varietyId,
                  plantCount: it.plantCount,
                })),
              );
            }
            const items = await tx
              .select()
              .from(plantingMixItems)
              .where(eq(plantingMixItems.templateId, tpl.id));
            return { ...tpl, items };
          });
          if (!updated) {
            set.status = 404;
            return { error: "template_not_found" };
          }
          return updated;
        },
        { params: IdParams, body: MixTemplatePatchBody, beforeHandle: grower },
      )
      .delete(
        "/crop/mix-templates/:id",
        async ({ params, set }) => {
          // Soft-delete: a future round should stop auto-offering this recipe, but
          // existing spawned batches keep their history. (D-06)
          const [tpl] = await database
            .update(plantingMixTemplates)
            .set({ active: false })
            .where(eq(plantingMixTemplates.id, params.id))
            .returning({ id: plantingMixTemplates.id });
          if (!tpl) {
            set.status = 404;
            return { error: "template_not_found" };
          }
          return { id: tpl.id, active: false };
        },
        { params: IdParams, beforeHandle: grower },
      )
      // One-click Monday spawn: create one batch per recipe item, all-or-nothing.
      .post(
        "/crop/mix-templates/:id/create-batches",
        async ({ params, body, set }) => {
          const plantDate = parseDate(body.plantDate);
          if (!plantDate) {
            set.status = 422;
            return { error: "invalid_plant_date" };
          }
          const [tpl] = await database
            .select({ id: plantingMixTemplates.id })
            .from(plantingMixTemplates)
            .where(eq(plantingMixTemplates.id, params.id))
            .limit(1);
          if (!tpl) {
            set.status = 404;
            return { error: "template_not_found" };
          }
          const result = await database.transaction((tx) =>
            createBatchesFromMix(tx, params.id, plantDate),
          );
          // Guard against an empty/itemless template (createBatchesFromMix no-op).
          if (!result.alreadyCreated && result.batches.length === 0) {
            set.status = 404;
            return { error: "template_not_found" };
          }
          return result;
        },
        { params: IdParams, body: CreateBatchesBody, beforeHandle: grower },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const cropRoutes = makeCropRoutes();
