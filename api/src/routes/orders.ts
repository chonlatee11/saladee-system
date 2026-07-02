// Orders routes (01-02, D-02/D-03/D-16) — the phase's headline capability.
//
//   POST  /orders             — OPEN (no requireRole, D-03): a guest/member
//                               places a priced order that reserves stock
//                               ATOMICALLY inside one db.transaction and freezes
//                               a fully SERVER-RESOLVED price/pack snapshot onto
//                               order_lines (D-16). Never trusts a client price.
//   PATCH /orders/:id/status   — staff-guarded (requireRole owner|admin, D-03):
//                               validates the transition via order-status.ts and,
//                               on `cancelled`, releases reserved stock in the
//                               SAME transaction, idempotently (D-08 / Pitfall 5).
//
// DI: makeOrdersRoutes(db) takes the database so the endpoint is testable against
// an injected pool (mirrors makeHealthRoutes in routes/health.ts). The default
// `ordersRoutes` binds the runtime db and is what index.ts composes.
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { customers, orderLines, orders, prices, rounds, saleUnits, varieties } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { canTransition, type OrderStatus } from "../services/order-status";
import { deriveUnitPriceSatang } from "../services/pricing";
import { release, reserve } from "../services/reservation";

// The schema-typed drizzle handle (query builder + transaction runner). Matches
// both the runtime db (client.ts) and an injected test pool typed with `schema`.
type OrdersDb = PostgresJsDatabase<typeof schema>;

/** Signalled inside a transaction to roll back with a specific HTTP mapping. */
class OrderError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
  }
}

// ── TypeBox request schemas ──────────────────────────────────────────────────
// NEVER accept a price/plants field from the client — the server resolves price
// by tier from the prices table and computes the snapshot itself (T-01-06 / D-16).
const OrderLineBody = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  saleUnitId: t.String({ format: "uuid" }),
  qty: t.Integer({ minimum: 1 }), // blocks negative/zero reserve (T-01-09 / V5)
});

const GuestCustomer = t.Object({
  name: t.String({ minLength: 1 }),
  phone: t.String({ minLength: 1 }),
  recipientName: t.String({ minLength: 1 }),
  recipientPhone: t.String({ minLength: 1 }),
  recipientAddress: t.String({ minLength: 1 }),
});
const MemberCustomer = t.Object({ customerId: t.String({ format: "uuid" }) });

const CreateOrderBody = t.Object({
  tier: t.Union([t.Literal("b2c"), t.Literal("b2b")]),
  customer: t.Union([MemberCustomer, GuestCustomer]),
  substitutionPolicy: t.Optional(t.Union([t.Literal("allow"), t.Literal("disallow")])),
  taxId: t.Optional(t.String()),
  lines: t.Array(OrderLineBody, { minItems: 1 }),
});

const StatusBody = t.Object({
  status: t.Union([
    t.Literal("created"),
    t.Literal("awaiting_payment"),
    t.Literal("paid"),
    t.Literal("packing"),
    t.Literal("shipping"),
    t.Literal("done"),
    t.Literal("cancelled"),
  ]),
});

type Tier = "b2c" | "b2b";

/** A single line after the server has resolved catalog + price + pack maths. */
interface ResolvedLine {
  roundId: string;
  varietyId: string;
  varietyName: string;
  unitLabel: string;
  plantsPerUnit: number;
  pricePerKgSatang: number;
  unitPriceSatang: number;
  qty: number;
  plantsDecremented: number;
}

export function makeOrdersRoutes(database: OrdersDb = defaultDb) {
  return (
    new Elysia()
      .post(
        "/orders",
        async ({ body, set }) => {
          const tier = body.tier as Tier;
          const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

          // 1. Resolve every line server-side (catalog + price + pack maths). These
          //    are read-only lookups — no side effects — so we do them before the tx.
          const resolved: ResolvedLine[] = [];
          for (const line of body.lines) {
            const [su] = await database
              .select()
              .from(saleUnits)
              .where(eq(saleUnits.id, line.saleUnitId))
              .limit(1);
            if (!su || su.varietyId !== line.varietyId) {
              set.status = 400;
              return { error: "invalid_line" };
            }
            const [variety] = await database
              .select()
              .from(varieties)
              .where(eq(varieties.id, line.varietyId))
              .limit(1);
            if (!variety) {
              set.status = 400;
              return { error: "variety_not_found" };
            }
            // Resolve price by tier: today's dated override wins, else the NULL-date
            // default (OQ-2). DESC NULLS LAST ⇒ a dated-today row sorts before NULL.
            const [price] = await database
              .select({ pricePerKgSatang: prices.pricePerKgSatang })
              .from(prices)
              .where(
                and(
                  eq(prices.roundId, line.roundId),
                  eq(prices.varietyId, line.varietyId),
                  eq(prices.tier, tier),
                  or(isNull(prices.effectiveDate), eq(prices.effectiveDate, today)),
                ),
              )
              .orderBy(sql`${prices.effectiveDate} DESC NULLS LAST`)
              .limit(1);
            if (!price) {
              set.status = 400;
              return { error: "no_price" };
            }
            const unitPriceSatang = deriveUnitPriceSatang(price.pricePerKgSatang, su.gramsPerUnit);
            resolved.push({
              roundId: line.roundId,
              varietyId: line.varietyId,
              varietyName: variety.name,
              unitLabel: su.label,
              plantsPerUnit: su.plantsPerUnit,
              pricePerKgSatang: price.pricePerKgSatang,
              unitPriceSatang,
              qty: line.qty,
              plantsDecremented: su.plantsPerUnit * line.qty,
            });
          }

          // 2. Member validation (read-only) before entering the tx.
          const cust = body.customer as
            | { customerId: string }
            | {
                name: string;
                phone: string;
                recipientName: string;
                recipientPhone: string;
                recipientAddress: string;
              };
          if ("customerId" in cust) {
            const [existing] = await database
              .select({ id: customers.id })
              .from(customers)
              .where(eq(customers.id, cust.customerId))
              .limit(1);
            if (!existing) {
              set.status = 400;
              return { error: "customer_not_found" };
            }
          }

          const subtotalSatang = resolved.reduce((s, r) => s + r.unitPriceSatang * r.qty, 0);

          // 3. One transaction: (re)check cut-off (Pitfall 6), reserve atomically,
          //    then persist the order + frozen snapshot. Any throw rolls it all back.
          try {
            const result = await database.transaction(async (tx) => {
              let customerId: string;
              let recipientName: string | null = null;
              let recipientPhone: string | null = null;
              let recipientAddress: string | null = null;
              if ("customerId" in cust) {
                customerId = cust.customerId;
              } else {
                const [c] = await tx
                  .insert(customers)
                  .values({ isMember: false, name: cust.name, phone: cust.phone })
                  .returning({ id: customers.id });
                if (!c) throw new Error("customer insert returned no row");
                customerId = c.id;
                recipientName = cust.recipientName;
                recipientPhone = cust.recipientPhone;
                recipientAddress = cust.recipientAddress;
              }

              // Re-check each distinct round is open and before cut-off INSIDE the tx.
              const roundIds = [...new Set(resolved.map((r) => r.roundId))];
              for (const rid of roundIds) {
                const [rnd] = await tx
                  .select({ status: rounds.status, cutoffAt: rounds.cutoffAt })
                  .from(rounds)
                  .where(eq(rounds.id, rid))
                  .limit(1);
                if (
                  !rnd ||
                  rnd.status === "closed" ||
                  (rnd.cutoffAt !== null && rnd.cutoffAt.getTime() <= Date.now())
                ) {
                  throw new OrderError("round_closed", 409);
                }
              }

              // Reserve every line atomically; a zero-row guarded UPDATE ⇒ sold out.
              for (const r of resolved) {
                const ok = await reserve(tx, r.roundId, r.varietyId, r.plantsDecremented);
                if (!ok) throw new OrderError("sold_out", 409);
              }

              const orderRoundId = resolved[0]?.roundId as string;
              const [ord] = await tx
                .insert(orders)
                .values({
                  customerId,
                  roundId: orderRoundId,
                  status: "created",
                  tier,
                  substitutionPolicy: body.substitutionPolicy ?? "disallow",
                  recipientName,
                  recipientPhone,
                  recipientAddress,
                  taxId: body.taxId ?? null,
                  subtotalSatang,
                })
                .returning({ id: orders.id, status: orders.status });
              if (!ord) throw new Error("order insert returned no row");

              await tx.insert(orderLines).values(
                resolved.map((r) => ({
                  orderId: ord.id,
                  lineKind: "variety",
                  varietyId: r.varietyId,
                  varietyName: r.varietyName,
                  unitLabel: r.unitLabel,
                  plantsPerUnit: r.plantsPerUnit,
                  pricePerKgSatang: r.pricePerKgSatang,
                  tier,
                  unitPriceSatang: r.unitPriceSatang,
                  qty: r.qty,
                  plantsDecremented: r.plantsDecremented,
                })),
              );

              return { id: ord.id, status: ord.status, subtotalSatang };
            });
            set.status = 201;
            return result;
          } catch (e) {
            if (e instanceof OrderError) {
              set.status = e.httpStatus;
              return { error: e.code };
            }
            throw e;
          }
        },
        { body: CreateOrderBody },
      )
      // Staff-only status pipeline (D-03/PLAT-03). requireRole runs as beforeHandle:
      // 401 no/invalid token, 403 wrong role — the POST above intentionally stays open.
      .patch(
        "/orders/:id/status",
        async ({ params, body, set }) => {
          const [ord] = await database
            .select({ id: orders.id, status: orders.status, roundId: orders.roundId })
            .from(orders)
            .where(eq(orders.id, params.id))
            .limit(1);
          if (!ord) {
            set.status = 404;
            return { error: "order_not_found" };
          }
          const current = ord.status as OrderStatus;
          const next = body.status as OrderStatus;
          // Only legal transitions apply. `cancelled` from a terminal state (done)
          // or a repeat cancel is illegal here → 400, so stock is never re-released.
          if (!canTransition(current, next)) {
            set.status = 400;
            return { error: "illegal_transition" };
          }

          await database.transaction(async (tx) => {
            // A `cancelled` entry (from a non-cancelled state) releases the order's
            // reserved plants in the SAME tx. release() is itself guarded
            // (reserved >= n) so a double-release can never drive reserved negative
            // — double-safe with the canTransition gate above (D-08 / Pitfall 5).
            if (next === "cancelled" && current !== "cancelled") {
              const lines = await tx
                .select({ varietyId: orderLines.varietyId, plants: orderLines.plantsDecremented })
                .from(orderLines)
                .where(eq(orderLines.orderId, ord.id));
              for (const l of lines) {
                if (l.varietyId) await release(tx, ord.roundId, l.varietyId, l.plants);
              }
            }
            await tx
              .update(orders)
              .set({ status: next, updatedAt: new Date() })
              .where(eq(orders.id, ord.id));
          });

          set.status = 200;
          return { id: ord.id, status: next };
        },
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          body: StatusBody,
          beforeHandle: requireRole("owner", "admin"),
        },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const ordersRoutes = makeOrdersRoutes();
