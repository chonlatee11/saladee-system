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
import { and, eq, isNull, isNotNull } from "drizzle-orm";
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
import { requireRole, type Session, verifySession } from "../plugins/auth.plugin";
import { wholesaleVisible } from "../services/b2b";

type CatalogDb = PostgresJsDatabase<typeof schema>;

/** Extract a Bearer token from either the lower- or upper-case Authorization header. */
function bearer(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

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
// Customer self-service standing order (03-08 LIFF): the customerId is the SESSION,
// never a client field — a customer can only ever set their OWN basket (T-03-20).
const CustomerStandingBody = t.Object({
  items: t.Array(StandingItemBody, { minItems: 1 }),
});
const WholesalePriceQuery = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
});
const PatchStandingBody = t.Object({
  active: t.Optional(t.Boolean()),
  items: t.Optional(t.Array(StandingItemBody, { minItems: 1 })),
});

export function makeB2bRoutes(database: CatalogDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  // Member gate for the customer B2B self-service surface (03-08 LIFF): a valid
  // CUSTOMER session whose customer row bears a line_user_id (mirrors me-orders
  // D-19). The staff routes above use their own requireRole beforeHandle and ignore
  // this — the `.derive` only ADDS `session` to context, never gates the staff paths.
  async function requireMember(
    session: Session | null,
    set: { status?: number | string },
  ): Promise<
    | { ok: true; customerId: string; row: typeof customers.$inferSelect }
    | { ok: false; error: string }
  > {
    if (!session) {
      set.status = 401;
      return { ok: false, error: "unauthorized" };
    }
    if (session.role !== "customer") {
      set.status = 403;
      return { ok: false, error: "forbidden" };
    }
    const [row] = await database
      .select()
      .from(customers)
      .where(eq(customers.id, session.sub))
      .limit(1);
    if (!row || row.lineUserId === null) {
      set.status = 403;
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, customerId: session.sub, row };
  }

  return (
    new Elysia()
      // Resolve the session once per request (null for missing/invalid tokens). Only
      // the /me/* customer routes below read it; staff routes keep their requireRole
      // beforeHandle (which re-reads the header itself), so this is additive.
      .derive(async ({ headers }) => {
        const token = bearer(headers);
        if (!token) return { session: null as Session | null };
        try {
          return { session: (await verifySession(token)) as Session | null };
        } catch {
          return { session: null as Session | null };
        }
      })
      // ── Approval (D-08 / CUST-02) ───────────────────────────────────────────
      // Pending applicants awaiting an approve/reject decision.
      .get(
        "/b2b/pending",
        async () =>
          database.select().from(customers).where(eq(customers.b2bStatus, "pending")),
        { beforeHandle: staff },
      )
      // The full B2B roster (any b2bStatus) — powers the approvals screen's status
      // badges (pending/approved/rejected) and the approved-customer picker used to
      // set a standing order on behalf of a wholesale account.
      .get(
        "/b2b/customers",
        async () =>
          database.select().from(customers).where(isNotNull(customers.b2bStatus)),
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

      // ══ Customer self-service B2B surface (03-08 LIFF, CUST-02 / CUST-05) ══════
      // The LIFF B2B account view. All scoped to session.sub — a customer can only
      // see/act on their OWN account (T-03-20); wholesale price stays gated on
      // approved (T-03-21). UI mirrors these states; the server is the authority.

      // Own B2B account status (null=not applied / pending / approved / rejected).
      .get("/me/b2b", async ({ session, set }) => {
        const guard = await requireMember(session, set);
        if (!guard.ok) return { error: guard.error };
        return {
          b2bStatus: guard.row.b2bStatus,
          creditTerms: guard.row.creditTerms,
          b2bApprovedAt: guard.row.b2bApprovedAt,
        };
      })
      // Apply for a B2B account: a plain B2C customer (b2bStatus null) requests
      // approval → pending. Idempotent-ish: only null flips to pending (never
      // re-opens an approved/rejected decision, which is staff-owned, D-08).
      .post("/me/b2b/apply", async ({ session, set }) => {
        const guard = await requireMember(session, set);
        if (!guard.ok) return { error: guard.error };
        if (guard.row.b2bStatus !== null) {
          return { b2bStatus: guard.row.b2bStatus };
        }
        const [row] = await database
          .update(customers)
          .set({ b2bStatus: "pending" })
          .where(eq(customers.id, guard.customerId))
          .returning({ b2bStatus: customers.b2bStatus });
        set.status = 201;
        return row;
      })
      // Own wholesale price — gated behind wholesaleVisible() (approved-only, D-08 /
      // T-03-21). A pending/rejected/B2C member never sees the b2b tier → 403.
      .get(
        "/me/b2b/prices",
        async ({ session, query, set }) => {
          const guard = await requireMember(session, set);
          if (!guard.ok) return { error: guard.error };
          if (!(await wholesaleVisible(database, guard.customerId))) {
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
        { query: WholesalePriceQuery },
      )
      // Own standing orders (the recurring basket) + their items.
      .get("/me/standing-orders", async ({ session, set }) => {
        const guard = await requireMember(session, set);
        if (!guard.ok) return { error: guard.error };
        const orders = await database
          .select()
          .from(standingOrders)
          .where(eq(standingOrders.customerId, guard.customerId));
        if (orders.length === 0) return { standingOrders: [] };
        const items = await database.select().from(standingOrderItems);
        return {
          standingOrders: orders.map((o) => ({
            ...o,
            items: items.filter((it) => it.standingId === o.id),
          })),
        };
      })
      // Set own standing order (CUST-05) — gated on approved (T-03-21); customerId is
      // the SESSION, never a client field (T-03-20). Reservation at round-open still
      // runs only through 03-05 publishQuota → reserveStanding (single owner).
      .post(
        "/me/standing-orders",
        async ({ session, body, set }) => {
          const guard = await requireMember(session, set);
          if (!guard.ok) return { error: guard.error };
          if (!(await wholesaleVisible(database, guard.customerId))) {
            set.status = 403;
            return { error: "not_b2b_approved" };
          }
          const created = await database.transaction(async (tx) => {
            const [order] = await tx
              .insert(standingOrders)
              .values({ customerId: guard.customerId })
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
        { body: CustomerStandingBody },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const b2bRoutes = makeB2bRoutes();
