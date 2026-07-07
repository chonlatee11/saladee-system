// B2B routes (Wave-2 B2B slice, 03-06). Fills the 03-01 stub with the staff-gated
// wholesale-approval + standing-order + credit-terms endpoints. Every route closes
// over the injected db (makeB2bRoutes(db) DI, mirrors prices.ts/varieties.ts) and
// is guarded by requireRole("owner","admin") — a grower/packer/customer session can
// never reach these (D-19 / T-03-15).
//
// The wholesale tier price is gated behind wholesaleVisible() so an unapproved
// account never sees it (D-08 / T-03-14). Standing orders (CUST-05) record the
// recurring per-round basket; the ACTUAL round-open reservation of that basket is
// NOT triggered here — it runs through 03-05 publishQuota calling reserveStanding()
// inside the round-open tx (single owner of the open sequence, no double-reserve).
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  customers,
  prices,
  quotaOverflowFlags,
  standingOrderItems,
  standingOrders,
  varieties,
} from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { wholesaleVisible } from "../services/b2b";

type CatalogDb = PostgresJsDatabase<typeof schema>;

// ── TypeBox schemas (input validation, T-03-09) ───────────────────────────────
const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

const CreditTermsBody = t.Object({
  // D-11: free-text terms only (invoice-later). No enforced credit limit / blocking.
  creditTerms: t.Union([t.String(), t.Null()]),
});

const WholesaleQuery = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
});

const StandingItemBody = t.Object({
  varietyId: t.String({ format: "uuid" }),
  plantsPerRound: t.Integer({ minimum: 0 }),
});
const CreateStandingBody = t.Object({
  customerId: t.String({ format: "uuid" }),
  items: t.Array(StandingItemBody, { minItems: 1 }),
});
const PatchStandingBody = t.Object({
  active: t.Optional(t.Boolean()),
  items: t.Optional(t.Array(StandingItemBody, { minItems: 1 })),
});

export function makeB2bRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // ── Approval (D-08 / CUST-02) ───────────────────────────────────────────
      // Pending applicants awaiting an approve/reject decision.
      .get(
        "/b2b/pending",
        async () =>
          database.select().from(customers).where(eq(customers.b2bStatus, "pending")),
        { beforeHandle: staff },
      )
      .post(
        "/b2b/:id/approve",
        async ({ params, set }) => {
          const [row] = await database
            .update(customers)
            .set({ b2bStatus: "approved", b2bApprovedAt: new Date() })
            .where(eq(customers.id, params.id))
            .returning();
          if (!row) {
            set.status = 404;
            return { error: "customer_not_found" };
          }
          return row;
        },
        { params: IdParams, beforeHandle: staff },
      )
      .post(
        "/b2b/:id/reject",
        async ({ params, set }) => {
          const [row] = await database
            .update(customers)
            .set({ b2bStatus: "rejected" })
            .where(eq(customers.id, params.id))
            .returning();
          if (!row) {
            set.status = 404;
            return { error: "customer_not_found" };
          }
          return row;
        },
        { params: IdParams, beforeHandle: staff },
      )
      // Credit terms (D-11): record agreed terms as free text; no limit enforcement.
      .patch(
        "/b2b/:id/credit-terms",
        async ({ params, body, set }) => {
          const [row] = await database
            .update(customers)
            .set({ creditTerms: body.creditTerms })
            .where(eq(customers.id, params.id))
            .returning();
          if (!row) {
            set.status = 404;
            return { error: "customer_not_found" };
          }
          return row;
        },
        { params: IdParams, body: CreditTermsBody, beforeHandle: staff },
      )

      // ── Wholesale-price visibility gate (D-08 / T-03-14) ────────────────────
      // Only an approved B2B customer may see the b2b tier price; else 403.
      .get(
        "/b2b/:id/prices",
        async ({ params, query, set }) => {
          if (!(await wholesaleVisible(database, params.id))) {
            set.status = 403;
            return { error: "not_b2b_approved" };
          }
          const [row] = await database
            .select({ pricePerKgSatang: prices.pricePerKgSatang })
            .from(prices)
            .where(
              and(
                eq(prices.roundId, query.roundId),
                eq(prices.varietyId, query.varietyId),
                eq(prices.tier, "b2b"),
                isNull(prices.effectiveDate),
              ),
            )
            .limit(1);
          if (!row) {
            set.status = 404;
            return { error: "no_price" };
          }
          return {
            roundId: query.roundId,
            varietyId: query.varietyId,
            tier: "b2b" as const,
            pricePerKgSatang: row.pricePerKgSatang,
          };
        },
        { params: IdParams, query: WholesaleQuery, beforeHandle: staff },
      )

      // ── Overflow flags (D-10) ───────────────────────────────────────────────
      // Unresolved standing/subscription shortfalls for the admin to act on
      // (increase planting or trim standing). The system NEVER auto-decides; this
      // read only surfaces the flags reserveStanding inserted (destructive severity
      // in the UI). Joined with the variety name for display.
      .get(
        "/b2b/overflow-flags",
        async () =>
          database
            .select({
              id: quotaOverflowFlags.id,
              roundId: quotaOverflowFlags.roundId,
              varietyId: quotaOverflowFlags.varietyId,
              varietyName: varieties.name,
              shortfall: quotaOverflowFlags.shortfall,
              source: quotaOverflowFlags.source,
              resolvedAt: quotaOverflowFlags.resolvedAt,
              createdAt: quotaOverflowFlags.createdAt,
            })
            .from(quotaOverflowFlags)
            .innerJoin(varieties, eq(varieties.id, quotaOverflowFlags.varietyId))
            .where(isNull(quotaOverflowFlags.resolvedAt)),
        { beforeHandle: staff },
      )

      // ── Standing orders (CUST-05) ───────────────────────────────────────────
      // The recurring per-round basket. Reservation at round-open is triggered by
      // 03-05 publishQuota (reserveStanding), NOT by a reserve endpoint here.
      .get(
        "/b2b/standing-orders",
        async () => {
          const orders = await database.select().from(standingOrders);
          if (orders.length === 0) return [];
          const items = await database.select().from(standingOrderItems);
          return orders.map((o) => ({
            ...o,
            items: items.filter((it) => it.standingId === o.id),
          }));
        },
        { beforeHandle: staff },
      )
      .post(
        "/b2b/standing-orders",
        async ({ body, set }) => {
          const created = await database.transaction(async (tx) => {
            const [order] = await tx
              .insert(standingOrders)
              .values({ customerId: body.customerId })
              .returning();
            if (!order) throw new Error("standing order insert returned no row");
            const items = await tx
              .insert(standingOrderItems)
              .values(
                body.items.map((it) => ({
                  standingId: order.id,
                  varietyId: it.varietyId,
                  plantsPerRound: it.plantsPerRound,
                })),
              )
              .returning();
            return { ...order, items };
          });
          set.status = 201;
          return created;
        },
        { body: CreateStandingBody, beforeHandle: staff },
      )
      .patch(
        "/b2b/standing-orders/:id",
        async ({ params, body, set }) => {
          const updated = await database.transaction(async (tx) => {
            const patch: Partial<typeof standingOrders.$inferInsert> = {};
            if (body.active !== undefined) patch.active = body.active;
            let order: typeof standingOrders.$inferSelect | undefined;
            if (Object.keys(patch).length > 0) {
              [order] = await tx
                .update(standingOrders)
                .set(patch)
                .where(eq(standingOrders.id, params.id))
                .returning();
            } else {
              [order] = await tx
                .select()
                .from(standingOrders)
                .where(eq(standingOrders.id, params.id))
                .limit(1);
            }
            if (!order) return null;
            // Replace the basket wholesale when items are supplied (edit basket).
            if (body.items !== undefined) {
              await tx
                .delete(standingOrderItems)
                .where(eq(standingOrderItems.standingId, order.id));
              await tx.insert(standingOrderItems).values(
                body.items.map((it) => ({
                  standingId: order!.id,
                  varietyId: it.varietyId,
                  plantsPerRound: it.plantsPerRound,
                })),
              );
            }
            const items = await tx
              .select()
              .from(standingOrderItems)
              .where(eq(standingOrderItems.standingId, order.id));
            return { ...order, items };
          });
          if (!updated) {
            set.status = 404;
            return { error: "standing_order_not_found" };
          }
          return updated;
        },
        { params: IdParams, body: PatchStandingBody, beforeHandle: staff },
      )
      // Cancel = soft-delete (active=false): keeps history; a cancelled standing
      // order is simply skipped by the next round-open reserveStanding.
      .delete(
        "/b2b/standing-orders/:id",
        async ({ params, set }) => {
          const [order] = await database
            .update(standingOrders)
            .set({ active: false })
            .where(eq(standingOrders.id, params.id))
            .returning({ id: standingOrders.id });
          if (!order) {
            set.status = 404;
            return { error: "standing_order_not_found" };
          }
          return { id: order.id, active: false };
        },
        { params: IdParams, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const b2bRoutes = makeB2bRoutes();
