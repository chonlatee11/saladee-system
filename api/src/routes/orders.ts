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
import { deliveryConfig } from "../config/delivery";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  boxComponents,
  boxes,
  customers,
  orderLines,
  orders,
  prices,
  rounds,
  saleUnits,
  varieties,
} from "../db/schema";
import { env } from "../env";
import { boss } from "../jobs/boss";
import { log } from "../lib/logger";
import { requireRole } from "../plugins/auth.plugin";
import {
  allowedMethodsForCart,
  computeDeliveryFee,
  type DeliveryClass,
  type DeliveryMethod,
} from "../services/delivery";
import type { OrderStatus } from "../services/order-status";
import { applyTransition, OrderError } from "../services/order-transition";
import { deriveUnitPriceSatang } from "../services/pricing";
import { buildPromptPayPayload, renderQrDataUrl } from "../services/promptpay";
import { reserve } from "../services/reservation";

/**
 * Schedules the pg-boss hold-expiry timer for an order (PAY-03 / D-11). Injected
 * so tests can assert scheduling without a running worker; the runtime default
 * uses `singletonKey=orderId` so re-showing the QR never adds a second timer.
 */
export type HoldExpiryScheduler = (orderId: string, holdWindowSeconds: number) => Promise<void>;

export const defaultScheduleHoldExpiry: HoldExpiryScheduler = async (orderId, holdWindowSeconds) => {
  await boss.send(
    "hold-expiry",
    { orderId },
    { startAfter: holdWindowSeconds, singletonKey: orderId },
  );
};

// The schema-typed drizzle handle (query builder + transaction runner). Matches
// both the runtime db (client.ts) and an injected test pool typed with `schema`.
type OrdersDb = PostgresJsDatabase<typeof schema>;

// OrderError (throw-to-rollback → HTTP mapping) now lives in
// services/order-transition.ts alongside the shared applyTransition() and is
// imported above; the POST /orders flow below still throws it for round_closed /
// sold_out, and the PATCH flow delegates the guarded transition to applyTransition.

// ── TypeBox request schemas ──────────────────────────────────────────────────
// NEVER accept a price/plants field from the client — the server resolves price
// by tier from the prices table and computes the snapshot itself (T-01-06 / D-16).
const OrderLineBody = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  saleUnitId: t.String({ format: "uuid" }),
  // WR-02: bound qty above too. Without a maximum, unitPriceSatang*qty (and
  // plantsPerUnit*qty) can exceed int4 (2,147,483,647) and Postgres raises
  // "integer out of range" — an uncaught 500 instead of a clean 422. 100000 packs
  // is far beyond any real order and keeps every derived int4 well in range.
  qty: t.Integer({ minimum: 1, maximum: 100000 }), // blocks negative/zero/overflow (T-01-09 / V5)
});

// A mixed-box line (01-05, INV-07): identify the box + the round it draws stock
// from; NEVER a price/BOM field — both are resolved server-side (T-01-20 / D-18).
const BoxLineBody = t.Object({
  boxId: t.String({ format: "uuid" }),
  roundId: t.String({ format: "uuid" }),
  qty: t.Integer({ minimum: 1, maximum: 100000 }), // WR-02: bound to avoid int4 overflow → 500
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
  // At least one of lines / boxLines must be present (checked in the handler).
  lines: t.Optional(t.Array(OrderLineBody, { minItems: 1 })),
  boxLines: t.Optional(t.Array(BoxLineBody, { minItems: 1 })),
  // ── Phase-2 LINE checkout (02-04) ───────────────────────────────────────────
  // Delivery choice. When BOTH are present the order becomes a real checkout:
  // the fee is RE-COMPUTED server-side (never trusted from the client — the client
  // sends no money field), the freshness intersection is re-enforced, status lands
  // `awaiting_payment`, a PromptPay QR for (subtotal+fee) is stored, and a
  // hold-expiry timer is scheduled. Omitting them keeps the Phase-1 `created`
  // behaviour (staff/legacy path) unchanged.
  deliveryMethod: t.Optional(
    t.Union([
      t.Literal("self"),
      t.Literal("cold"),
      t.Literal("on_demand"),
      t.Literal("general"),
    ]),
  ),
  deliveryZone: t.Optional(t.String({ minLength: 1 })),
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
  deliveryClass: DeliveryClass; // freshness gating at checkout (D-13)
}

/** One resolved BOM component (server-derived; never client-supplied). */
interface ResolvedBoxComponent {
  varietyId: string;
  varietyName: string;
  plantsPerBox: number;
  pricePerKgSatang: number | null;
  componentPriceSatang: number | null;
  deliveryClass: DeliveryClass; // freshness gating at checkout (D-13)
}

/** A box line after the server has resolved its BOM + price (D-18) snapshot. */
interface ResolvedBox {
  roundId: string;
  boxId: string;
  boxName: string;
  qty: number;
  unitPriceSatang: number; // fixed override, else the sum of component prices
  priceMode: "fixed" | "sum";
  components: ResolvedBoxComponent[];
  plantsPerBox: number; // total plants across all components (for one box)
  plantsDecremented: number; // plantsPerBox × qty
}

export function makeOrdersRoutes(
  database: OrdersDb = defaultDb,
  scheduleHoldExpiry: HoldExpiryScheduler = defaultScheduleHoldExpiry,
) {
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
          for (const line of body.lines ?? []) {
            // WR-03: honour the soft-delete (`active`) flag. A retired pack or a
            // discontinued variety must NOT be sellable even if the client still
            // knows its UUID (both are public before deletion) and a quota/price
            // row survives — matching the box path (eq(boxes.active,true)) and the
            // catalog. Without this, soft-delete could be bypassed to sell
            // withdrawn inventory.
            const [su] = await database
              .select()
              .from(saleUnits)
              .where(and(eq(saleUnits.id, line.saleUnitId), eq(saleUnits.active, true)))
              .limit(1);
            if (!su || su.varietyId !== line.varietyId) {
              set.status = 400;
              return { error: "invalid_line" };
            }
            const [variety] = await database
              .select()
              .from(varieties)
              .where(and(eq(varieties.id, line.varietyId), eq(varieties.active, true)))
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
              deliveryClass: variety.deliveryClass as DeliveryClass,
            });
          }

          // 1b. Resolve every BOX line server-side: load the box + its BOM, resolve
          //     each component's tier price, and derive the box unit price (D-18: the
          //     stored fixed override, else the SUM of component prices). The client
          //     never supplies a price or BOM (T-01-20).
          const resolvedBoxes: ResolvedBox[] = [];
          for (const bl of body.boxLines ?? []) {
            const [box] = await database
              .select()
              .from(boxes)
              .where(and(eq(boxes.id, bl.boxId), eq(boxes.active, true)))
              .limit(1);
            if (!box) {
              set.status = 400;
              return { error: "box_not_found" };
            }
            const comps = await database
              .select()
              .from(boxComponents)
              .where(eq(boxComponents.boxId, box.id));
            if (comps.length === 0) {
              set.status = 400;
              return { error: "box_empty" };
            }

            const resolvedComponents: ResolvedBoxComponent[] = [];
            for (const c of comps) {
              // WR-03: a box whose BOM references a discontinued (soft-deleted)
              // component variety is not sellable — same rule as the direct line.
              const [variety] = await database
                .select()
                .from(varieties)
                .where(and(eq(varieties.id, c.varietyId), eq(varieties.active, true)))
                .limit(1);
              if (!variety) {
                set.status = 400;
                return { error: "variety_not_found" };
              }
              // Resolve this component's per-kg price by tier (same OQ-2 rule).
              const [price] = await database
                .select({ pricePerKgSatang: prices.pricePerKgSatang })
                .from(prices)
                .where(
                  and(
                    eq(prices.roundId, bl.roundId),
                    eq(prices.varietyId, c.varietyId),
                    eq(prices.tier, tier),
                    or(isNull(prices.effectiveDate), eq(prices.effectiveDate, today)),
                  ),
                )
                .orderBy(sql`${prices.effectiveDate} DESC NULLS LAST`)
                .limit(1);
              // A component's value = the price of `plantsPerBox` whole plants of it
              // (grams = plantsPerBox × avgGramsPerPlant), ceil-to-baht like a pack.
              const componentPriceSatang = price
                ? deriveUnitPriceSatang(
                    price.pricePerKgSatang,
                    c.plantsPerBox * variety.avgGramsPerPlant,
                  )
                : null;
              resolvedComponents.push({
                varietyId: c.varietyId,
                varietyName: variety.name,
                plantsPerBox: c.plantsPerBox,
                pricePerKgSatang: price?.pricePerKgSatang ?? null,
                componentPriceSatang,
                deliveryClass: variety.deliveryClass as DeliveryClass,
              });
            }

            // D-18: fixed override wins; else sum the component prices (all required).
            let unitPriceSatang: number;
            let priceMode: "fixed" | "sum";
            if (box.fixedPriceSatang !== null) {
              unitPriceSatang = box.fixedPriceSatang;
              priceMode = "fixed";
            } else {
              if (resolvedComponents.some((rc) => rc.componentPriceSatang === null)) {
                set.status = 400;
                return { error: "no_price" };
              }
              unitPriceSatang = resolvedComponents.reduce(
                (s, rc) => s + (rc.componentPriceSatang ?? 0),
                0,
              );
              priceMode = "sum";
            }

            const plantsPerBox = resolvedComponents.reduce((s, rc) => s + rc.plantsPerBox, 0);
            resolvedBoxes.push({
              roundId: bl.roundId,
              boxId: box.id,
              boxName: box.name,
              qty: bl.qty,
              unitPriceSatang,
              priceMode,
              components: resolvedComponents,
              plantsPerBox,
              plantsDecremented: plantsPerBox * bl.qty,
            });
          }

          // An order must carry at least one line (variety and/or box).
          if (resolved.length === 0 && resolvedBoxes.length === 0) {
            set.status = 400;
            return { error: "no_lines" };
          }

          // Enforce the documented single-round-per-order invariant (01-02-SUMMARY).
          // The order row persists ONE round_id and cancel releases every line
          // against it, so an order whose lines (variety AND box components) span
          // two or more distinct rounds would strand reserved stock on cancel
          // (CR-01 / NFR-02). Reject such an order cleanly BEFORE any reservation
          // happens — never partially reserve.
          const distinctRounds = new Set([
            ...resolved.map((r) => r.roundId),
            ...resolvedBoxes.map((b) => b.roundId),
          ]);
          if (distinctRounds.size > 1) {
            set.status = 400;
            return { error: "multi_round_order_unsupported" };
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

          const subtotalSatang =
            resolved.reduce((s, r) => s + r.unitPriceSatang * r.qty, 0) +
            resolvedBoxes.reduce((s, b) => s + b.unitPriceSatang * b.qty, 0);

          // 2b. LINE checkout (02-04): when a delivery choice is supplied, this is a
          //     real checkout. Re-enforce the freshness intersection (T-02-13), RE-
          //     COMPUTE the fee server-side (T-02-12 — the client never sends money),
          //     and build the amount-specified PromptPay QR for the FULL total
          //     (subtotal + fee, T-02-16 / Pitfall 5). Snapshot everything onto the
          //     order so status lands `awaiting_payment` with a scheduled hold. Omit
          //     the delivery choice and the order keeps the Phase-1 `created` path.
          const isCheckout =
            body.deliveryMethod !== undefined && body.deliveryZone !== undefined;
          let deliveryFeeSatang: number | null = null;
          let totalSatang = subtotalSatang;
          let holdWindowSeconds = 0;
          let holdExpiresAt: Date | null = null;
          let qrPayload: string | null = null;
          if (isCheckout) {
            const method = body.deliveryMethod as DeliveryMethod;
            const zone = body.deliveryZone as string;
            // Freshness gating: the chosen method MUST be allowed for the cart's
            // strictest class (very_fresh → self/cold only). Re-enforced here, not
            // only in the display-only quote (02-03).
            const classes: DeliveryClass[] = [
              ...resolved.map((r) => r.deliveryClass),
              ...resolvedBoxes.flatMap((b) => b.components.map((c) => c.deliveryClass)),
            ];
            if (!allowedMethodsForCart(classes).includes(method)) {
              set.status = 422;
              return { error: "method_not_allowed_freshness" };
            }
            // Server-authoritative fee — an (zone, method) pair the config does not
            // offer is a clean 422, never a 500.
            try {
              deliveryFeeSatang = computeDeliveryFee(zone, method, subtotalSatang, deliveryConfig);
            } catch {
              set.status = 422;
              return { error: "method_not_available_in_zone" };
            }
            totalSatang = subtotalSatang + deliveryFeeSatang;
            holdWindowSeconds = Number(env.HOLD_WINDOW_SECONDS);
            holdExpiresAt = new Date(Date.now() + holdWindowSeconds * 1000);
            // QR amount = full total in baht (/100). Whole-baht prices + whole-baht
            // fees guarantee X.00. CRC-16 is produced by the library, never here.
            qrPayload = buildPromptPayPayload(env.PROMPTPAY_PAYEE_ID, totalSatang / 100);
          }

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

              // Re-check each distinct round (variety + box lines) is open and before
              // cut-off INSIDE the tx.
              const roundIds = [
                ...new Set([
                  ...resolved.map((r) => r.roundId),
                  ...resolvedBoxes.map((b) => b.roundId),
                ]),
              ];
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

              // Establish ONE global lock ordering for EVERY reservation in this
              // order — variety lines AND box components together (WR-03 / T-01-19).
              // Previously variety lines reserved in request order while box
              // components were sorted only within their own box, so two concurrent
              // checkouts could acquire the same round_stock row locks in opposite
              // order and deadlock (a 500 to a legitimate customer, worst during a
              // promo spike — NFR-01). Merge duplicate (round, variety) draws, then
              // sort by (roundId, varietyId) and issue the guarded reserve() calls in
              // that single global order. The whole order is one transaction, so any
              // shortfall (guarded UPDATE matches zero rows) rolls back every prior
              // decrement — the same all-or-nothing box semantics (INV-07), now with
              // a consistent lock order across the entire order.
              const draws = new Map<
                string,
                { roundId: string; varietyId: string; plants: number }
              >();
              const addDraw = (roundId: string, varietyId: string, plants: number) => {
                const key = `${roundId}:${varietyId}`;
                const existing = draws.get(key);
                if (existing) existing.plants += plants;
                else draws.set(key, { roundId, varietyId, plants });
              };
              for (const r of resolved) addDraw(r.roundId, r.varietyId, r.plantsDecremented);
              for (const b of resolvedBoxes) {
                for (const c of b.components) {
                  addDraw(b.roundId, c.varietyId, c.plantsPerBox * b.qty);
                }
              }
              const orderedDraws = [...draws.values()].sort(
                (a, b) =>
                  a.roundId.localeCompare(b.roundId) || a.varietyId.localeCompare(b.varietyId),
              );
              for (const d of orderedDraws) {
                const ok = await reserve(tx, d.roundId, d.varietyId, d.plants);
                if (!ok) throw new OrderError("sold_out", 409);
              }

              const orderRoundId = (resolved[0]?.roundId ?? resolvedBoxes[0]?.roundId) as string;
              const [ord] = await tx
                .insert(orders)
                .values({
                  customerId,
                  roundId: orderRoundId,
                  // Checkout lands `awaiting_payment` (D-10); legacy path stays `created`.
                  status: isCheckout ? "awaiting_payment" : "created",
                  tier,
                  substitutionPolicy: body.substitutionPolicy ?? "disallow",
                  recipientName,
                  recipientPhone,
                  recipientAddress,
                  taxId: body.taxId ?? null,
                  subtotalSatang,
                  // Phase-2 delivery + payment-hold snapshot (nullable on the legacy
                  // path). holdExpiresAt is the authoritative deadline the 02-07
                  // safety-net sweep + expiry job read.
                  deliveryMethod: isCheckout ? (body.deliveryMethod as string) : null,
                  deliveryZone: isCheckout ? (body.deliveryZone as string) : null,
                  deliveryFeeSatang,
                  holdExpiresAt,
                  qrPayload,
                })
                .returning({ id: orders.id, status: orders.status });
              if (!ord) throw new Error("order insert returned no row");

              if (resolved.length > 0) {
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
              }

              // Box lines carry a FROZEN BOM + resolved-price snapshot (PAY-04 / D-18)
              // in box_bom_json; varietyId is null (the components live in the json).
              if (resolvedBoxes.length > 0) {
                await tx.insert(orderLines).values(
                  resolvedBoxes.map((b) => ({
                    orderId: ord.id,
                    lineKind: "box",
                    boxId: b.boxId,
                    varietyName: b.boxName, // snapshot the box name for display
                    unitLabel: b.boxName,
                    tier,
                    unitPriceSatang: b.unitPriceSatang,
                    qty: b.qty,
                    plantsDecremented: b.plantsDecremented,
                    boxBomJson: {
                      boxId: b.boxId,
                      boxName: b.boxName,
                      priceMode: b.priceMode,
                      unitPriceSatang: b.unitPriceSatang,
                      roundId: b.roundId,
                      components: b.components,
                    },
                  })),
                );
              }

              return {
                id: ord.id,
                status: ord.status,
                subtotalSatang,
                deliveryFeeSatang,
                totalSatang,
              };
            });

            // 4. Post-commit (checkout only): render the stored QR and schedule the
            //    hold-expiry timer. The order is ALREADY committed, so a scheduling
            //    failure must NOT roll it back (T-02-14) — holdExpiresAt is snapshotted
            //    and the 02-07 periodic sweep is the authoritative self-heal.
            let qr: string | null = null;
            if (isCheckout && qrPayload) {
              qr = await renderQrDataUrl(qrPayload);
              try {
                await scheduleHoldExpiry(result.id, holdWindowSeconds);
              } catch (err) {
                log.warn("hold-expiry schedule failed; sweep will self-heal", {
                  orderId: result.id,
                  error: String(err),
                });
              }
            }
            set.status = 201;
            return { ...result, qr, holdExpiresAt };
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
          const next = body.status as OrderStatus;
          try {
            // Delegate to the SHARED guarded transition (services/order-transition.ts):
            // it row-locks + re-reads the authoritative status and releases reserved
            // stock on entering `cancelled`, exactly once (the Phase-1 concurrent-cancel
            // fix, now the single source of truth reused by slip-verify + hold-expiry).
            const { status: finalStatus } = await database.transaction((tx) =>
              applyTransition(tx, params.id, next),
            );

            set.status = 200;
            // IN-03: `finalStatus` is the committed status read/written under the
            // row lock — a lost/rejected transition can no longer report success.
            return { id: params.id, status: finalStatus };
          } catch (e) {
            if (e instanceof OrderError) {
              set.status = e.httpStatus;
              return { error: e.code };
            }
            throw e;
          }
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
