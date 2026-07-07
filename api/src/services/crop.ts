// Crop-planning service: planting-mix template → batch spawn (CROP-06 / D-06).
//
// A planting-mix template is a saved recipe (varieties + plant counts, ~200
// plants / 6 varieties). One click on the Monday plant date spawns one
// planting_batch per template item, all sharing that plant date. The spawn is
// all-or-nothing inside a single transaction (mirrors varieties.ts POST 110–141):
// either every item's batch is inserted or none is — a half-created week is never
// left behind (T-03-08 Tampering mitigation).
//
// Idempotency (D-06 "already created" notice): planting_batches carries no
// template FK (schema is frozen — 03-01), so a re-click for the SAME week is
// detected by the (plantDate, template variety-set) overlap: if any batch already
// exists on that plant date for a variety in this template, the spawn is a no-op
// and reports `alreadyCreated`. This keeps a double-click on Monday from doubling
// the week's plantings.
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import { plantingBatches, plantingMixItems } from "../db/schema";

type CatalogDb = PostgresJsDatabase<typeof schema>;
/** A drizzle db OR tx handle — both expose the query builder methods we use. */
type DbOrTx = CatalogDb | Parameters<Parameters<CatalogDb["transaction"]>[0]>[0];

export type SpawnedBatch = typeof plantingBatches.$inferSelect;

export interface CreateBatchesResult {
  /** true when batches for this (template, plantDate) already existed → no-op. */
  alreadyCreated: boolean;
  /** the batches that exist for this week (freshly spawned, or the pre-existing set). */
  batches: SpawnedBatch[];
}

/**
 * Spawn one planting_batch per item of `templateId`, all dated `plantDate`.
 *
 * MUST be called inside a `db.transaction(tx => …)` so a mid-way failure rolls
 * back every batch already inserted for the week (all-or-nothing, D-06).
 *
 * @returns {alreadyCreated:true, batches:[existing…]} if this week was already
 *          spawned from a template overlapping these varieties (idempotent no-op);
 *          otherwise {alreadyCreated:false, batches:[spawned…]}.
 */
export async function createBatchesFromMix(
  tx: DbOrTx,
  templateId: string,
  plantDate: Date,
): Promise<CreateBatchesResult> {
  // 1. Read the recipe (variety + plant count per line).
  const items = await tx
    .select()
    .from(plantingMixItems)
    .where(eq(plantingMixItems.templateId, templateId));
  if (items.length === 0) {
    // Empty/unknown template → nothing to spawn (route maps this to 404 upstream).
    return { alreadyCreated: false, batches: [] };
  }

  // 2. Idempotency guard: has this week already been spawned for these varieties?
  //    (plantDate, variety) overlap — no template FK on planting_batches (frozen schema).
  const varietyIds = items.map((i) => i.varietyId);
  const existing = await tx
    .select()
    .from(plantingBatches)
    .where(
      and(
        eq(plantingBatches.plantDate, plantDate),
        inArray(plantingBatches.varietyId, varietyIds),
      ),
    );
  if (existing.length > 0) {
    return { alreadyCreated: true, batches: existing };
  }

  // 3. Spawn one batch per recipe line, all on the same plant date.
  const batches = await tx
    .insert(plantingBatches)
    .values(
      items.map((i) => ({
        varietyId: i.varietyId,
        plantDate,
        plantCount: i.plantCount,
      })),
    )
    .returning();

  return { alreadyCreated: false, batches };
}
