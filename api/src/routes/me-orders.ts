// Member order history + reorder (02-09, CUST-04 / LINE-02 / D-19 / D-20).
//
//   GET  /me/orders            — MEMBER-ONLY: the authenticated member's own
//                                orders (status + summary), scoped by the session
//                                customerId — NEVER another customer's orders
//                                (T-02-33 IDOR).
//   GET  /me/orders/:id         — one order (status + lines + delivery), 404 if it
//                                is not the caller's order.
//   POST /me/orders/:id/reorder — build a proposed cart of the SAME
//                                varieties/packs/qty, RE-PRICED at the currently
//                                selected open round using the SAME dated-today-wins
//                                resolution as catalog.ts/orders.ts, and FLAG each
//                                item now sold-out or absent in that round (D-20).
//                                Returns the proposed cart only — it does NOT place
//                                an order; the customer confirms in the wizard.
//
// Member gate (D-19): every endpoint sits behind a beforeHandle that verifies the
// session (HS256) AND resolves a customer that has a line_user_id. A guest (no
// line_user_id) gets neither history nor reorder — 403. Missing/invalid token — 401.
// The gate keys on customers.line_user_id (set by the 02-02 LINE login), so a
// member can only ever see their own orders (T-02-34 privilege / T-02-33 IDOR).
//
// DI: makeMeOrdersRoutes(db) mirrors the other route factories; the default
// `meOrdersRoutes` binds the runtime db and is what index.ts composes.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  customers,
  orderLines,
  orders,
  prices,
  roundStock,
  rounds,
  saleUnits,
} from "../db/schema";
import { type Session, verifySession } from "../plugins/auth.plugin";
import { applyTransition, OrderError } from "../services/order-transition";
import { deriveUnitPriceSatang } from "../services/pricing";

type MeOrdersDb = PostgresJsDatabase<typeof schema>;
type Tier = "b2c" | "b2b";

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

/** Extract a Bearer token from either the lower- or upper-case Authorization header. */
function bearer(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/** A per-line reorder flag reason — why an item cannot be reordered as-is (D-20). */
type ReorderReason = "sold_out" | "absent_this_round" | "pack_unavailable" | "no_price" | "box_review";

export function makeMeOrdersRoutes(database: MeOrdersDb = defaultDb) {
  // Member guard (D-19): valid customer session AND a customer row carrying a
  // line_user_id. Runs as beforeHandle so a guest never reaches a handler.
  const memberGuard = async ({
    session,
    set,
  }: {
    session: Session | null;
    set: { status?: number | string };
  }) => {
    if (!session) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    // A customer session only — a staff role never has order history here.
    if (session.role !== "customer") {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [cust] = await database
      .select({ lineUserId: customers.lineUserId })
      .from(customers)
      .where(eq(customers.id, session.sub))
      .limit(1);
    // Guests (no line_user_id) get neither history nor reorder (D-19 / T-02-34).
    if (!cust || cust.lineUserId === null) {
      set.status = 403;
      return { error: "forbidden" };
    }
    return undefined;
  };

  return (
    new Elysia()
      // Resolve the session once per request (null for missing/invalid tokens). The
      // guard rejects; handlers then trust session.sub as the member customerId.
      .derive(async ({ headers }) => {
        const token = bearer(headers);
        if (!token) return { session: null as Session | null };
        try {
          return { session: (await verifySession(token)) as Session | null };
        } catch {
          return { session: null as Session | null };
        }
      })
      // ── History: the member's own orders (status + summary), newest first ──────
      .get(
        "/me/orders",
        async ({ session, set }) => {
          if (!session) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const customerId = session.sub;
          const rows = await database
            .select({
              id: orders.id,
              status: orders.status,
              tier: orders.tier,
              subtotalSatang: orders.subtotalSatang,
              deliveryFeeSatang: orders.deliveryFeeSatang,
              roundId: orders.roundId,
              createdAt: orders.createdAt,
            })
            .from(orders)
            // Scope STRICTLY by the session customerId — never all orders (T-02-33).
            .where(eq(orders.customerId, customerId))
            .orderBy(sql`${orders.createdAt} DESC`);

          return {
            orders: rows.map((o) => ({
              id: o.id,
              status: o.status,
              tier: o.tier,
              subtotalSatang: o.subtotalSatang,
              deliveryFeeSatang: o.deliveryFeeSatang,
              totalSatang: o.subtotalSatang + (o.deliveryFeeSatang ?? 0),
              roundId: o.roundId,
              createdAt: o.createdAt,
            })),
          };
        },
        { beforeHandle: memberGuard },
      )
      // ── Detail: one order (status + lines + delivery), 404 if not the caller's ─
      .get(
        "/me/orders/:id",
        async ({ params, session, set }) => {
          if (!session) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const customerId = session.sub;
          const [ord] = await database
            .select()
            .from(orders)
            .where(eq(orders.id, params.id))
            .limit(1);
          // 404 (not 403) when the order is not theirs — do not confirm existence
          // of another customer's order (T-02-33 IDOR).
          if (!ord || ord.customerId !== customerId) {
            set.status = 404;
            return { error: "not_found" };
          }
          const lines = await database
            .select({
              id: orderLines.id,
              lineKind: orderLines.lineKind,
              varietyId: orderLines.varietyId,
              varietyName: orderLines.varietyName,
              unitLabel: orderLines.unitLabel,
              unitPriceSatang: orderLines.unitPriceSatang,
              qty: orderLines.qty,
            })
            .from(orderLines)
            .where(eq(orderLines.orderId, ord.id));

          return {
            order: {
              id: ord.id,
              status: ord.status,
              tier: ord.tier,
              roundId: ord.roundId,
              subtotalSatang: ord.subtotalSatang,
              deliveryFeeSatang: ord.deliveryFeeSatang,
              totalSatang: ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0),
              deliveryMethod: ord.deliveryMethod,
              deliveryZone: ord.deliveryZone,
              recipientName: ord.recipientName,
              recipientPhone: ord.recipientPhone,
              recipientAddress: ord.recipientAddress,
              holdExpiresAt: ord.holdExpiresAt,
              createdAt: ord.createdAt,
            },
            lines,
          };
        },
        { params: IdParams, beforeHandle: memberGuard },
      )
      // ── Cancel: the member cancels their OWN unpaid held order (WR-01) ──────────
      // The LIFF pay screen previously called the staff-only PATCH /orders/:id/status
      // (requireRole owner|admin) with no token, so a customer cancel ALWAYS failed
      // silently. This member-scoped path lets the order's own customer cancel it:
      // ownership is enforced (404 hides another customer's order, T-02-33 IDOR) and
      // onlyIfHold means only a {created, awaiting_payment} order is cancelled +
      // released — a paid/packing/shipping order is a safe no-op (never releases
      // already-sold stock). Reuses the SHARED guarded applyTransition (D-09).
      .post(
        "/me/orders/:id/cancel",
        async ({ params, session, set }) => {
          if (!session) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const customerId = session.sub;
          try {
            const result = await database.transaction(async (tx) => {
              const [own] = await tx
                .select({ customerId: orders.customerId })
                .from(orders)
                .where(eq(orders.id, params.id))
                .limit(1);
              // 404 (not 403) when the order is not theirs — never confirm the
              // existence of another customer's order (T-02-33 IDOR).
              if (!own || own.customerId !== customerId) {
                throw new OrderError("not_found", 404);
              }
              return applyTransition(tx, params.id, "cancelled", { onlyIfHold: true });
            });
            set.status = 200;
            return { id: params.id, status: result.status, cancelled: result.applied };
          } catch (e) {
            if (e instanceof OrderError) {
              set.status = e.httpStatus;
              return { error: e.code };
            }
            throw e;
          }
        },
        { params: IdParams, beforeHandle: memberGuard },
      )
      // ── Reorder: propose a re-priced cart of the same items (D-20) ─────────────
      .post(
        "/me/orders/:id/reorder",
        async ({ params, session, set }) => {
          if (!session) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          const customerId = session.sub;
          const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

          const [ord] = await database
            .select({
              id: orders.id,
              customerId: orders.customerId,
              tier: orders.tier,
              roundId: orders.roundId,
            })
            .from(orders)
            .where(eq(orders.id, params.id))
            .limit(1);
          if (!ord || ord.customerId !== customerId) {
            set.status = 404;
            return { error: "not_found" };
          }
          const tier = ord.tier as Tier;

          const lines = await database
            .select({
              lineKind: orderLines.lineKind,
              varietyId: orderLines.varietyId,
              varietyName: orderLines.varietyName,
              unitLabel: orderLines.unitLabel,
              unitPriceSatang: orderLines.unitPriceSatang,
              qty: orderLines.qty,
            })
            .from(orderLines)
            .where(eq(orderLines.orderId, ord.id));

          const items: Array<{
            kind: "variety" | "box";
            roundId: string | null;
            varietyId: string | null;
            saleUnitId: string | null;
            qty: number;
            varietyName: string | null;
            unitLabel: string | null;
            oldUnitPriceSatang: number | null;
            unitPriceSatang: number | null;
            available: boolean;
            soldOut: boolean;
            reason: ReorderReason | null;
          }> = [];
          const cartLines: Array<{
            roundId: string;
            varietyId: string;
            saleUnitId: string;
            qty: number;
          }> = [];

          for (const l of lines) {
            // Box lines are not blind-duplicated: a box's BOM + availability can
            // shift across rounds, so flag it for review in the wizard rather than
            // silently re-adding a possibly-stale box (D-20). Variety reorder is the
            // MVP customer loop; box reorder is a later enhancement.
            if (l.lineKind === "box" || !l.varietyId) {
              items.push({
                kind: "box",
                roundId: null,
                varietyId: null,
                saleUnitId: null,
                qty: l.qty,
                varietyName: l.varietyName,
                unitLabel: l.unitLabel,
                oldUnitPriceSatang: l.unitPriceSatang,
                unitPriceSatang: null,
                available: false,
                soldOut: false,
                reason: "box_review",
              });
              continue;
            }

            const varietyId = l.varietyId;
            // Resolve the SAME pack by (variety, snapshot label): sale units belong
            // to the variety and are stable across rounds. A retired pack → flagged.
            const [su] = await database
              .select({ id: saleUnits.id, gramsPerUnit: saleUnits.gramsPerUnit })
              .from(saleUnits)
              .where(
                and(
                  eq(saleUnits.varietyId, varietyId),
                  eq(saleUnits.label, l.unitLabel ?? ""),
                  eq(saleUnits.active, true),
                ),
              )
              .limit(1);

            // The current open round that stocks this variety — prefer the original
            // order's round when it is still open, else any open round with stock.
            const openStock = await database
              .select({
                roundId: roundStock.roundId,
                quotaPlants: roundStock.quotaPlants,
                reservedPlants: roundStock.reservedPlants,
              })
              .from(roundStock)
              .innerJoin(rounds, eq(rounds.id, roundStock.roundId))
              .where(and(eq(roundStock.varietyId, varietyId), eq(rounds.status, "open")));
            const target =
              openStock.find((r) => r.roundId === ord.roundId) ?? openStock[0] ?? null;

            let available = true;
            let soldOut = false;
            let reason: ReorderReason | null = null;
            let unitPriceSatang: number | null = null;
            const roundId = target?.roundId ?? null;

            if (!su) {
              available = false;
              reason = "pack_unavailable"; // the pack was retired since the old order
            } else if (!target) {
              available = false;
              reason = "absent_this_round"; // the variety is not sold in any open round
            } else {
              const availability = target.quotaPlants - target.reservedPlants;
              soldOut = availability <= 0;
              // RE-PRICE at the target round: a dated-today row wins, else the NULL
              // default (the SAME rule as orders.ts / catalog.ts). NEVER the old
              // snapshot price (T-02-35).
              const [price] = await database
                .select({ pricePerKgSatang: prices.pricePerKgSatang })
                .from(prices)
                .where(
                  and(
                    eq(prices.roundId, target.roundId),
                    eq(prices.varietyId, varietyId),
                    eq(prices.tier, tier),
                    or(isNull(prices.effectiveDate), eq(prices.effectiveDate, today)),
                  ),
                )
                .orderBy(sql`${prices.effectiveDate} DESC NULLS LAST`)
                .limit(1);
              if (!price) {
                available = false;
                reason = "no_price";
              } else {
                unitPriceSatang = deriveUnitPriceSatang(price.pricePerKgSatang, su.gramsPerUnit);
                if (soldOut) {
                  available = false;
                  reason = "sold_out";
                }
              }
            }

            items.push({
              kind: "variety",
              roundId,
              varietyId,
              saleUnitId: su?.id ?? null,
              qty: l.qty,
              varietyName: l.varietyName,
              unitLabel: l.unitLabel,
              oldUnitPriceSatang: l.unitPriceSatang,
              unitPriceSatang,
              available,
              soldOut,
              reason,
            });

            // Only add fully-available lines to the proposed cart; flagged items are
            // surfaced to the customer to confirm/drop before paying (D-20).
            if (available && roundId && su) {
              cartLines.push({ roundId, varietyId, saleUnitId: su.id, qty: l.qty });
            }
          }

          return {
            tier,
            // The proposed cart in the exact POST /orders line shape (ids + qty only).
            cart: { lines: cartLines, boxLines: [] as never[] },
            items,
            hasUnavailable: items.some((i) => !i.available),
          };
        },
        { params: IdParams, beforeHandle: memberGuard },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const meOrdersRoutes = makeMeOrdersRoutes();
