// Harvest routes (Wave-3 harvest slice, 03-05). Fills the 03-01 stub with the
// grower-gated harvest-calendar / publish / manual-override / harvest-log endpoints.
// Every route closes over the injected db (makeHarvestRoutes(db) DI, mirrors
// crop.ts/b2b.ts) and is guarded by requireRole("owner","admin","grower") — a packer
// or customer session can never reach these (D-19 / T-03-12).
//
// POST /harvest/publish is the round-open trigger point: it calls publishQuota (the
// single owner of the open sequence) which reserves standing orders in-tx and fires the
// subscription-generate queue post-commit. The injectable `trigger` lets the default
// instance wire boss.send while tests pass a no-op.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { roundStock, rounds, varieties } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import {
  BatchNotFoundError,
  computeDraftQuota,
  LotAlreadyExistsError,
  logHarvest,
  type PublishTrigger,
  publishQuota,
} from "../services/harvest";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// ── TypeBox schemas (input validation, T-03-09). qty is always Integer (no float). ─
const CalendarQuery = t.Object({ roundId: t.String({ format: "uuid" }) });
const PublishBody = t.Object({ roundId: t.String({ format: "uuid" }) });
const QuotaOverrideBody = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  quotaPlants: t.Integer({ minimum: 0 }),
});
const HarvestLogBody = t.Object({
  batchId: t.String({ format: "uuid" }),
  harvestedAt: t.String({ minLength: 1 }), // ISO date-time; parsed + validated below
  actualPlants: t.Integer({ minimum: 0 }),
  actualGrams: t.Integer({ minimum: 0 }),
  wasteGrams: t.Optional(t.Integer({ minimum: 0 })),
});

/** Parse an ISO date string → Date; returns null on an invalid/NaN date (→ 422). */
function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function makeHarvestRoutes(database: CatalogDb = defaultDb, trigger?: PublishTrigger) {
  const grower = requireRole("owner", "admin", "grower");

  return (
    new Elysia()
      // ── Harvest calendar (draft + published + manual-override states) ─────────
      // Merges the computed DRAFT quota with any already-published round_stock rows so
      // the UI can render draft / published / manual-override per variety.
      .get(
        "/harvest/calendar",
        async ({ query }) => {
          const [round] = await database
            .select({ id: rounds.id, name: rounds.name, harvestDate: rounds.harvestDate })
            .from(rounds)
            .where(eq(rounds.id, query.roundId))
            .limit(1);
          const draft = await computeDraftQuota(database, query.roundId);
          const published = await database
            .select({
              varietyId: roundStock.varietyId,
              varietyName: varieties.name,
              quotaPlants: roundStock.quotaPlants,
              reservedPlants: roundStock.reservedPlants,
              isManualOverride: roundStock.isManualOverride,
            })
            .from(roundStock)
            .innerJoin(varieties, eq(varieties.id, roundStock.varietyId))
            .where(eq(roundStock.roundId, query.roundId));

          const publishedByVariety = new Map(published.map((p) => [p.varietyId, p]));
          const draftByVariety = new Map(draft.map((d) => [d.varietyId, d.quotaPlants]));
          const varietyIds = new Set<string>([
            ...draft.map((d) => d.varietyId),
            ...published.map((p) => p.varietyId),
          ]);

          const rows = [...varietyIds].map((varietyId) => {
            const p = publishedByVariety.get(varietyId);
            const draftQuota = draftByVariety.get(varietyId) ?? null;
            const state = p ? (p.isManualOverride ? "manual-override" : "published") : "draft";
            return {
              varietyId,
              varietyName: p?.varietyName ?? null,
              draftQuota,
              publishedQuota: p?.quotaPlants ?? null,
              reservedPlants: p?.reservedPlants ?? 0,
              isManualOverride: p?.isManualOverride ?? false,
              state,
            };
          });

          return {
            round: round ?? null,
            isPublished: published.length > 0,
            rows,
          };
        },
        { query: CalendarQuery, beforeHandle: grower },
      )

      // ── Publish (D-03 gate) — the round-open orchestrator trigger point ───────
      .post(
        "/harvest/publish",
        async ({ body }) => {
          const result = await publishQuota(database, body.roundId, trigger);
          return result;
        },
        { body: PublishBody, beforeHandle: grower },
      )

      // ── Manual override (D-03) — hand-set sellable qty, flagged permanent ─────
      .patch(
        "/harvest/quota",
        async ({ body, set }) => {
          const [row] = await database
            .insert(roundStock)
            .values({
              roundId: body.roundId,
              varietyId: body.varietyId,
              quotaPlants: body.quotaPlants,
              isManualOverride: true,
            })
            .onConflictDoUpdate({
              target: [roundStock.roundId, roundStock.varietyId],
              set: { quotaPlants: body.quotaPlants, isManualOverride: true },
            })
            .returning();
          if (!row) {
            set.status = 500;
            return { error: "override_failed" };
          }
          return row;
        },
        { body: QuotaOverrideBody, beforeHandle: grower },
      )

      // ── Actual harvest log (CROP-05 / INV-10) — 1 batch = 1 lot ───────────────
      .post(
        "/harvest/logs",
        async ({ body, set }) => {
          const harvestedAt = parseDate(body.harvestedAt);
          if (!harvestedAt) {
            set.status = 422;
            return { error: "invalid_harvested_at" };
          }
          try {
            const result = await logHarvest(database, body.batchId, {
              harvestedAt,
              actualPlants: body.actualPlants,
              actualGrams: body.actualGrams,
              wasteGrams: body.wasteGrams,
            });
            set.status = 201;
            return result;
          } catch (err) {
            if (err instanceof LotAlreadyExistsError) {
              set.status = 409;
              return { error: "batch_already_logged" };
            }
            if (err instanceof BatchNotFoundError) {
              set.status = 404;
              return { error: "batch_not_found" };
            }
            throw err;
          }
        },
        { body: HarvestLogBody, beforeHandle: grower },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts (uses the default
// boss.send trigger inside publishQuota).
export const harvestRoutes = makeHarvestRoutes();
