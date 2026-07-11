// Harvest service (Wave-3 harvest slice, 03-05) — the crop auto-feed + THE round-open
// orchestrator + actual-harvest logging. Three responsibilities:
//
//  1. computeDraftQuota  — the DRAFT sellable qty per round: Σ(plantCount × survival%)
//     of every batch whose projected harvest date hits the round (reusing the 03-04
//     pure forecast kernel). Pure read; feeds quota_plants only when published.
//
//  2. publishQuota       — the SINGLE OWNER of the open-round sequence (CUST-05 Success
//     Criterion 3). In ONE transaction it UPSERTs round_stock.quota_plants from the
//     draft (skipping manual-override rows) and then reserves EVERY active standing
//     order through the EXISTING guarded reserveStanding()/reserve() path (03-06). Only
//     AFTER the tx commits does it fire the subscription-generate trigger (03-07 queue).
//     Because the standing reservation and the quota write commit together, a B2C order
//     that reads the quota afterward can only ever see `quota − reserved` — standing is
//     reserved BEFORE B2C with NO race window (transactional priority, Pattern 2). It is
//     ONE-SHOT per round: reserveStanding + trigger run ONLY on the first publish
//     (detected by the round having no round_stock rows yet); a re-publish re-syncs
//     quota on NON-override rows and NEVER re-reserves or re-triggers.
//
//     publishQuota deliberately touches ONLY quota_plants. reserved_plants is moved
//     EXCLUSIVELY by the guarded reserve()/reserveBox() (no 2nd counter, no
//     SELECT-available pre-check — Pitfall 1 / T-03-11/T-03-20). Manual-override rows
//     (is_manual_override) are never clobbered (D-03 / Pitfall 5 / T-03-10).
//
//  3. logHarvest         — 1 batch = 1 lot (D-05 / INV-10): auto lotCode + auto
//     best-before (harvestDate + shelfLifeDays via the pure kernel), returns the
//     actual-vs-forecast delta (D-04, shown only — the system never auto-tunes params).
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import {
  harvestLogs,
  plantingBatches,
  roundStock,
  rounds,
  standingOrderItems,
  standingOrders,
  varieties,
} from "../db/schema";
import { reserveStanding, type StandingItem, type StandingReserveResult } from "./b2b";
import { bestBefore, forecastPlants, projectedHarvestDate } from "./forecast";

type CatalogDb = PostgresJsDatabase<typeof schema>;
/** A drizzle db OR tx handle — both expose select/insert/update (mirrors b2b.DbOrTx). */
type DbOrTx = CatalogDb | Parameters<Parameters<CatalogDb["transaction"]>[0]>[0];

/** One draft quota line: the forecast sellable plants for a variety this round. */
export interface DraftQuotaItem {
  varietyId: string;
  quotaPlants: number;
}

/**
 * DRAFT sellable qty per round (D-02/07): for every planting batch whose projected
 * harvest date (plantDate + daysToHarvest) equals the round's harvestDate, sum the
 * per-variety floored forecast (plantCount × survivalPct%). Pure read — the number is
 * only WRITTEN into round_stock when an admin publishes (D-03 gate). A round with no
 * harvestDate (or no matching batches) yields an empty draft.
 *
 * Date match is equality on the projected day (MVP per OQ2/A3 — a harvest WINDOW would
 * need a range match; deferred). All date math is UTC-stable via the forecast kernel.
 */
export async function computeDraftQuota(db: DbOrTx, roundId: string): Promise<DraftQuotaItem[]> {
  const [round] = await db
    .select({ harvestDate: rounds.harvestDate })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);
  if (!round?.harvestDate) return [];

  const batches = await db
    .select({
      varietyId: plantingBatches.varietyId,
      plantDate: plantingBatches.plantDate,
      plantCount: plantingBatches.plantCount,
      daysToHarvest: varieties.daysToHarvest,
      survivalPct: varieties.survivalPct,
    })
    .from(plantingBatches)
    .innerJoin(varieties, eq(plantingBatches.varietyId, varieties.id));

  // Sum the floored per-batch forecast into its variety, but only for batches whose
  // projected harvest day lands on this round's harvestDate (rounds.harvestDate is a
  // `date` column → 'YYYY-MM-DD' string; compare the projected day the same way).
  const byVariety = new Map<string, number>();
  for (const b of batches) {
    const projected = projectedHarvestDate(b.plantDate, b.daysToHarvest).toISOString().slice(0, 10);
    if (projected !== round.harvestDate) continue;
    const plants = forecastPlants(b.plantCount, b.survivalPct);
    byVariety.set(b.varietyId, (byVariety.get(b.varietyId) ?? 0) + plants);
  }
  return [...byVariety].map(([varietyId, quotaPlants]) => ({ varietyId, quotaPlants }));
}

/** Post-commit trigger for the subscription generator (03-07 queue). Injectable so the
 *  test can assert it fires exactly once, post-commit, without booting pg-boss. */
export type PublishTrigger = (roundId: string) => Promise<void>;

/** The default trigger: `boss.send('subscription-generate', …)`. Lazily imported so the
 *  service (and its tests) never pull in pg-boss unless the real trigger runs (prod). */
const defaultTrigger: PublishTrigger = async (roundId) => {
  const { boss } = await import("../jobs/boss");
  await boss.send("subscription-generate", { roundId }, { singletonKey: roundId });
};

export interface PublishResult {
  /** true iff this call was the unpublished→published transition (reserve + trigger ran). */
  firstPublish: boolean;
  /** The draft quota that was UPSERTed (non-override rows). */
  quota: DraftQuotaItem[];
  /** Standing reservations made this open (empty on a re-publish). */
  standing: StandingReserveResult;
}

/** Gather every active standing order's basket lines as reserve items (D-09). Standing
 *  orders are recurring baskets (no round FK) → they apply to every round-open. */
async function gatherStandingItems(tx: DbOrTx): Promise<StandingItem[]> {
  const rows = await tx
    .select({
      varietyId: standingOrderItems.varietyId,
      plants: standingOrderItems.plantsPerRound,
    })
    .from(standingOrderItems)
    .innerJoin(standingOrders, eq(standingOrderItems.standingId, standingOrders.id))
    .where(eq(standingOrders.active, true));
  return rows.map((r) => ({ varietyId: r.varietyId, plants: r.plants }));
}

/**
 * Round-open orchestrator (CUST-05). See the file header for the full contract.
 *
 * @param db       the runtime db handle (owns the transaction).
 * @param roundId  the round being opened.
 * @param trigger  post-commit subscription-generate trigger (defaults to boss.send).
 */
export async function publishQuota(
  db: CatalogDb,
  roundId: string,
  trigger: PublishTrigger = defaultTrigger,
): Promise<PublishResult> {
  const result = await db.transaction(async (tx) => {
    // First publish ⇔ the round has no round_stock rows yet (quota never set). A
    // re-publish (rows exist) re-syncs quota only and MUST NOT reserve/trigger again.
    const existing = await tx
      .select({ id: roundStock.id })
      .from(roundStock)
      .where(eq(roundStock.roundId, roundId));
    const firstPublish = existing.length === 0;

    const quota = await computeDraftQuota(tx, roundId);
    for (const q of quota) {
      // UPSERT via round_stock_round_variety_idx (mirrors prices.ts onConflictDoUpdate).
      // setWhere skips manual-override rows so a hand-set sellable qty is NEVER clobbered
      // (D-03 / Pitfall 5). Only quota_plants is written — reserved_plants is untouched.
      await tx
        .insert(roundStock)
        .values({ roundId, varietyId: q.varietyId, quotaPlants: q.quotaPlants })
        .onConflictDoUpdate({
          target: [roundStock.roundId, roundStock.varietyId],
          set: { quotaPlants: q.quotaPlants },
          setWhere: eq(roundStock.isManualOverride, false),
        });
    }

    // One-shot: standing reservation runs ONLY on the first publish, inside this tx, so
    // it commits atomically with the quota write (standing reserved before B2C, Pattern 2).
    let standing: StandingReserveResult = { reserved: [], overflow: [] };
    if (firstPublish) {
      const items = await gatherStandingItems(tx);
      standing = await reserveStanding(tx, roundId, items);
    }
    return { firstPublish, quota, standing };
  });

  // Fire the subscription generator AFTER the commit (never before — the box fill needs
  // the round's published availability). One-shot: only on the first publish.
  if (result.firstPublish) await trigger(roundId);
  return result;
}

// ── Actual-harvest logging (CROP-05 / INV-10 / D-04/D-05) ─────────────────────

/** Raised when a batch already has a confirmed lot (UNIQUE batch_id — 1 batch = 1 lot). */
export class LotAlreadyExistsError extends Error {
  constructor(readonly batchId: string) {
    super(`batch already harvest-confirmed: ${batchId}`);
    this.name = "LotAlreadyExistsError";
  }
}

/** Raised when the batch to log does not exist. */
export class BatchNotFoundError extends Error {
  constructor(readonly batchId: string) {
    super(`batch not found: ${batchId}`);
    this.name = "BatchNotFoundError";
  }
}

export interface HarvestActuals {
  harvestedAt: Date;
  actualPlants: number;
  actualGrams: number;
  wasteGrams?: number;
}

export interface HarvestLogResult {
  log: typeof harvestLogs.$inferSelect;
  /** The forecast sellable plants this batch was projected to yield. */
  expectedPlants: number;
  /** actualPlants − expectedPlants (D-04): shown only, never auto-tunes variety params. */
  delta: number;
}

/** Walk drizzle's wrapped `.cause` chain looking for a unique-violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Turn a variety name into a compact lot-code prefix (no code column in schema). */
function lotSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "lot"
  );
}

/**
 * Confirm the actual harvest of one batch as a single lot (D-05). Auto-derives the
 * lotCode (`${varietySlug}-${plantDateISO}`) and the best-before date (harvestedAt +
 * shelfLifeDays via the pure kernel), and returns the actual-vs-forecast delta (D-04).
 * The UNIQUE(batch_id) makes a second confirmation of the same batch a LotAlreadyExists
 * error — 1 batch = 1 lot, no duplicate lot.
 */
export async function logHarvest(
  db: CatalogDb,
  batchId: string,
  actuals: HarvestActuals,
): Promise<HarvestLogResult> {
  const [batch] = await db
    .select({
      plantDate: plantingBatches.plantDate,
      plantCount: plantingBatches.plantCount,
      varietyName: varieties.name,
      survivalPct: varieties.survivalPct,
      shelfLifeDays: varieties.shelfLifeDays,
    })
    .from(plantingBatches)
    .innerJoin(varieties, eq(plantingBatches.varietyId, varieties.id))
    .where(eq(plantingBatches.id, batchId))
    .limit(1);
  if (!batch) throw new BatchNotFoundError(batchId);

  const expectedPlants = forecastPlants(batch.plantCount, batch.survivalPct);
  const plantDateIso = batch.plantDate.toISOString().slice(0, 10);
  const lotCode = `${lotSlug(batch.varietyName)}-${plantDateIso}`;
  const best = bestBefore(actuals.harvestedAt, batch.shelfLifeDays);

  let log: typeof harvestLogs.$inferSelect;
  try {
    const [row] = await db
      .insert(harvestLogs)
      .values({
        batchId,
        harvestedAt: actuals.harvestedAt,
        actualPlants: actuals.actualPlants,
        actualGrams: actuals.actualGrams,
        wasteGrams: actuals.wasteGrams ?? 0,
        lotCode,
        bestBefore: best,
      })
      .returning();
    if (!row) throw new Error("harvest log insert returned no row");
    log = row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new LotAlreadyExistsError(batchId);
    throw err;
  }

  return { log, expectedPlants, delta: actuals.actualPlants - expectedPlants };
}
