// Subscription box-fill + recurring generation (SALE-03 / D-12/D-13/D-14/D-16).
//
// A subscription is a package BY VALUE (S/M/L satang, D-12) — NOT a fixed BOM. Each
// round the system fills a box from the varieties actually available that round, up
// to (or as close below as whole plants allow) the package value.
//
//   fillBox()          — a PURE, deterministic function (OQ3). Same availability +
//                        target → same box, every time. No DB / clock / randomness.
//   generateForRound() — per active subscription: fill the box, reserve its plants
//                        through the EXISTING guarded reserveBox() (reservation.ts,
//                        UNCHANGED — no second counter, Pitfall 1), create the order
//                        + link a subscription_orders row. The DB
//                        UNIQUE(subscription_id, round_id) makes a re-run a safe
//                        no-op (23505 → skip), so the pg-boss retry can never make a
//                        duplicate box (Pitfall 2). Reads subscription status + skip
//                        rows at RUN TIME so paused/cancelled/skipped are skipped
//                        (D-14). A sold-out round variety → the box is filled from
//                        what's available and a substitution notice fires to the
//                        member (guest with no line_user_id skipped, D-16/D-23).
//
// This module has NO knowledge of pg-boss or the LINE client: generateForRound takes
// an injectable substitution notifier so it stays unit-testable, and jobs/boss.ts
// wires the queue+worker and the real notifier. The boss.send("subscription-generate")
// TRIGGER is NOT here — it belongs to 03-05 publishQuota (post-publish), because the
// box fill needs the round's published availability (Wave-3).
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";
import {
  customers,
  orderLines,
  orders,
  prices,
  roundStock,
  subscriptionOrders,
  subscriptions,
  subscriptionSkips,
  varieties,
} from "../db/schema";
import { deriveUnitPriceSatang } from "./pricing";
import { BoxShortfallError, type BoxComponent, reserveBox } from "./reservation";

type SubDb = PostgresJsDatabase<typeof schema>;

// ── fillBox: deterministic value-fill (D-12 / OQ3) ────────────────────────────

/** One round variety the box can draw from. availableUnits = plants orderable now. */
export interface FillCandidate {
  varietyId: string;
  varietyName: string;
  /** Price of ONE fill unit (one plant) in integer satang. */
  unitPriceSatang: number;
  /** Whole plants available this round (quota − reserved). */
  availableUnits: number;
}

/** A chosen box line: `units` plants of a variety at the snapshot unit price. */
export interface FillLine {
  varietyId: string;
  varietyName: string;
  units: number;
  unitPriceSatang: number;
  lineValueSatang: number;
}

export interface FilledBox {
  lines: FillLine[];
  totalSatang: number;
}

/**
 * Fill a box from `availability` up to `targetSatang`, never overshooting.
 *
 * DETERMINISTIC FILL ORDER (OQ3 — the rule is the whole point of this being a tested
 * pure fn): candidates are sorted by
 *   1. availableUnits  DESC  (draw from the deepest/most-plentiful stock first —
 *                             the freshest, most abundant varieties lead the box),
 *   2. unitPriceSatang DESC  (spend the budget on higher-value plants first),
 *   3. varietyId       ASC   (total order — a stable uuid tiebreak so the result is
 *                             fully reproducible).
 * Then each candidate is filled greedily with as many WHOLE plants as fit the
 * remaining budget and its stock. Sold-out (availableUnits ≤ 0) and unpriced
 * (unitPriceSatang ≤ 0) candidates are skipped. The leftover budget below the
 * cheapest remaining unit is intentionally left unfilled (no overshoot).
 */
export function fillBox(availability: FillCandidate[], targetSatang: number): FilledBox {
  const usable = availability
    .filter((c) => c.availableUnits > 0 && c.unitPriceSatang > 0)
    .sort(
      (a, b) =>
        b.availableUnits - a.availableUnits ||
        b.unitPriceSatang - a.unitPriceSatang ||
        a.varietyId.localeCompare(b.varietyId),
    );

  const lines: FillLine[] = [];
  let total = 0;
  for (const c of usable) {
    const remaining = targetSatang - total;
    if (remaining <= 0) break;
    const maxByBudget = Math.floor(remaining / c.unitPriceSatang);
    const units = Math.min(maxByBudget, c.availableUnits);
    if (units > 0) {
      const lineValueSatang = units * c.unitPriceSatang;
      lines.push({
        varietyId: c.varietyId,
        varietyName: c.varietyName,
        units,
        unitPriceSatang: c.unitPriceSatang,
        lineValueSatang,
      });
      total += lineValueSatang;
    }
  }
  return { lines, totalSatang: total };
}

// ── generateForRound: the recurring generator (D-13/D-14/D-16) ────────────────

/** The by-value payload the substitution notifier needs (never carries a token). */
export interface SubstitutionNotice {
  /** Non-null — the caller only notifies a member (guest skipped, D-23). */
  lineUserId: string;
  orderId: string;
  boxName: string;
  totalSatang: number;
}
export type SubstitutionNotifier = (n: SubstitutionNotice) => void | Promise<void>;

export interface GenerateOpts {
  /** Fire-and-forget substitution push (D-16). Injected by boss.ts; mocked in tests. */
  notify?: SubstitutionNotifier;
  /** Payment-hold window for the generated order (seconds). boss.ts passes env value. */
  holdWindowSeconds?: number;
}

export interface GenerateResult {
  generated: { subscriptionId: string; orderId: string; substitution: boolean }[];
  skipped: {
    subscriptionId: string;
    reason: "skip" | "duplicate" | "shortfall" | "empty";
  }[];
}

/**
 * postgres.js surfaces a unique-violation as SQLSTATE 23505. Drizzle wraps query
 * errors, so the code can live on the error OR its `.cause` chain — walk it.
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const DEFAULT_HOLD_WINDOW_SECONDS = 1800;

/**
 * Generate one box order per ACTIVE, non-skipped subscription for `roundId`.
 *
 * Idempotent (Pitfall 2): each subscription is processed in its OWN transaction; the
 * FINAL insert is the subscription_orders(subscription_id, round_id) row, so a
 * re-run hits the DB UNIQUE, throws 23505, and rolls back the whole per-subscription
 * tx — no duplicate order AND no double reservation. One subscription's failure never
 * rolls back the batch (own-tx loop, mirrors sweepExpiredHolds).
 */
export async function generateForRound(
  db: SubDb,
  roundId: string,
  opts: GenerateOpts = {},
): Promise<GenerateResult> {
  const holdWindowSeconds = opts.holdWindowSeconds ?? DEFAULT_HOLD_WINDOW_SECONDS;
  const result: GenerateResult = { generated: [], skipped: [] };

  // Build the round's fill availability ONCE (read-only): every stocked variety with
  // its b2c default price, converted to a per-plant satang value. A sold-out variety
  // (available ≤ 0) is retained here so it drives the substitution flag below.
  const stockRows = await db
    .select({
      varietyId: roundStock.varietyId,
      varietyName: varieties.name,
      quotaPlants: roundStock.quotaPlants,
      reservedPlants: roundStock.reservedPlants,
      avgGramsPerPlant: varieties.avgGramsPerPlant,
      pricePerKgSatang: prices.pricePerKgSatang,
    })
    .from(roundStock)
    .innerJoin(varieties, eq(varieties.id, roundStock.varietyId))
    .leftJoin(
      prices,
      and(
        eq(prices.roundId, roundStock.roundId),
        eq(prices.varietyId, roundStock.varietyId),
        eq(prices.tier, "b2c"),
      ),
    )
    .where(eq(roundStock.roundId, roundId));

  const availability: FillCandidate[] = stockRows
    .filter((r) => r.pricePerKgSatang != null)
    .map((r) => ({
      varietyId: r.varietyId,
      varietyName: r.varietyName,
      unitPriceSatang: deriveUnitPriceSatang(r.pricePerKgSatang as number, r.avgGramsPerPlant),
      availableUnits: r.quotaPlants - r.reservedPlants,
    }));
  // A priced variety that is sold out this round means any box drawn around it is a
  // substitution of what the member would otherwise have received (D-16 proxy: with
  // no fixed BOM, the "expected" variety is any priced variety that ran out).
  const hasSoldOut = availability.some((c) => c.availableUnits <= 0);

  // Active subscriptions only (D-14: status read at RUN TIME). paused/cancelled skip.
  const activeSubs = await db
    .select({
      id: subscriptions.id,
      customerId: subscriptions.customerId,
      packageCode: subscriptions.packageCode,
      packageValueSatang: subscriptions.packageValueSatang,
      lineUserId: customers.lineUserId,
    })
    .from(subscriptions)
    .innerJoin(customers, eq(customers.id, subscriptions.customerId))
    .where(eq(subscriptions.status, "active"));

  // Skip rows for THIS round (D-14: at most one per subscription+round).
  const activeIds = activeSubs.map((s) => s.id);
  const skipRows =
    activeIds.length > 0
      ? await db
          .select({ subscriptionId: subscriptionSkips.subscriptionId })
          .from(subscriptionSkips)
          .where(
            and(
              eq(subscriptionSkips.roundId, roundId),
              inArray(subscriptionSkips.subscriptionId, activeIds),
            ),
          )
      : [];
  const skippedIds = new Set(skipRows.map((r) => r.subscriptionId));

  const holdExpiresAt = new Date(Date.now() + holdWindowSeconds * 1000);

  for (const sub of activeSubs) {
    if (skippedIds.has(sub.id)) {
      result.skipped.push({ subscriptionId: sub.id, reason: "skip" });
      continue;
    }

    const box = fillBox(availability, sub.packageValueSatang);
    if (box.lines.length === 0) {
      // Nothing orderable this round — no empty order, nothing reserved.
      result.skipped.push({ subscriptionId: sub.id, reason: "empty" });
      continue;
    }

    const boxName = `กล่องผักสมาชิก (${sub.packageCode})`;
    const substitution = hasSoldOut;
    // Each box line consumes `units` plants of its variety — reserved all-or-nothing.
    const components: BoxComponent[] = box.lines.map((l) => ({
      varietyId: l.varietyId,
      plantsPerBox: l.units,
    }));
    const plantsDecremented = box.lines.reduce((s, l) => s + l.units, 0);

    try {
      const orderId = await db.transaction(async (tx) => {
        // (1) Reserve every component through the EXISTING guarded path (no 2nd
        //     counter). A shortfall throws BoxShortfallError → the whole tx rolls back.
        await reserveBox(tx, roundId, components, 1);

        // (2) Create the order. Status awaiting_payment + holdExpiresAt so it rides
        //     the EXISTING payment / hold-expiry pipeline (D-15) — no billing engine,
        //     no ad-hoc status UPDATE (future transitions go through applyTransition).
        const [ord] = await tx
          .insert(orders)
          .values({
            customerId: sub.customerId,
            roundId,
            status: "awaiting_payment",
            tier: "b2c",
            subtotalSatang: box.totalSatang,
            holdExpiresAt,
          })
          .returning({ id: orders.id });
        if (!ord) throw new Error("subscription order insert returned no row");

        // (3) One box line carrying the frozen fill snapshot (D-18 idiom). The
        //     substitution flag rides box_bom_json so the admin view can surface it
        //     with NO schema migration (jsonb, existing column).
        await tx.insert(orderLines).values({
          orderId: ord.id,
          lineKind: "box",
          varietyName: boxName,
          unitLabel: boxName,
          tier: "b2c",
          unitPriceSatang: box.totalSatang,
          qty: 1,
          plantsDecremented,
          boxBomJson: {
            boxName,
            subscription: true,
            substitution,
            totalSatang: box.totalSatang,
            components: box.lines.map((l) => ({
              varietyId: l.varietyId,
              varietyName: l.varietyName,
              plantsPerBox: l.units,
              unitPriceSatang: l.unitPriceSatang,
            })),
          },
        });

        // (4) The idempotency guard — inserted LAST. A re-run trips the DB
        //     UNIQUE(subscription_id, round_id) → 23505 → this whole tx rolls back
        //     (order + reservation undone). Never an in-code "already generated?"
        //     pre-check (Pitfall 2 / schema comment).
        await tx.insert(subscriptionOrders).values({
          subscriptionId: sub.id,
          roundId,
          orderId: ord.id,
        });

        return ord.id;
      });

      result.generated.push({ subscriptionId: sub.id, orderId, substitution });

      // (5) Post-commit: substitution notice to the MEMBER only (guest skipped,
      //     D-23). Fire-and-forget — a push failure never affects the committed box.
      if (substitution && sub.lineUserId && opts.notify) {
        void Promise.resolve(
          opts.notify({
            lineUserId: sub.lineUserId,
            orderId,
            boxName,
            totalSatang: box.totalSatang,
          }),
        ).catch(() => {});
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Already generated for this round — the safe no-op (Pitfall 2).
        result.skipped.push({ subscriptionId: sub.id, reason: "duplicate" });
      } else if (err instanceof BoxShortfallError) {
        // A component sold out between the availability read and the reserve — the
        // tx rolled back (nothing reserved). Flag and move on (batch continues).
        result.skipped.push({ subscriptionId: sub.id, reason: "shortfall" });
      } else {
        throw err;
      }
    }
  }

  return result;
}
