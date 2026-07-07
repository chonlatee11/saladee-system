// Subscription routes (Wave-2 subscription slice, 03-07). Fills the 03-01 stub with
// the admin roster + the pause/skip/cancel/resume endpoints. These endpoints are
// SHARED: staff (owner/admin) manage any subscription from web-admin, and — from
// 03-08 — a customer manages their OWN through the same routes. Authorization is
// therefore per-request, not a single beforeHandle role gate:
//
//   • staff (owner|admin)  → full access to any subscription.
//   • customer session     → only their OWN subscription (customerId = session.sub),
//                            and a round-specific skip only BEFORE that round's
//                            cut-off (D-14 / T-03-18). A non-owner customer gets 404
//                            (never confirm another member's subscription exists).
//
// The recurring generation itself is NOT triggered here — jobs/boss.ts defines the
// queue+worker and 03-05 publishQuota fires it post-publish (single trigger owner).
// DI: makeSubscriptionsRoutes(db) mirrors the other route factories.
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import {
  customers,
  orderLines,
  rounds,
  subscriptionOrders,
  subscriptions,
  subscriptionSkips,
} from "../db/schema";
import { type Session, verifySession } from "../plugins/auth.plugin";

type SubscriptionsDb = PostgresJsDatabase<typeof schema>;

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });
const SkipBody = t.Object({ roundId: t.String({ format: "uuid" }) });

/** Extract a Bearer token from either the lower- or upper-case Authorization header. */
function bearer(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export function makeSubscriptionsRoutes(database: SubscriptionsDb = defaultDb) {
  // Authorize a mutation on subscription `id`. Returns the row when allowed, else an
  // HTTP mapping. A non-owner customer (and a missing row) get 404 — never confirm
  // another member's subscription (T-03-18 IDOR).
  async function authorize(
    session: Session | null,
    id: string,
  ): Promise<
    | { ok: true; sub: typeof subscriptions.$inferSelect; isStaff: boolean }
    | { ok: false; status: number; error: string }
  > {
    if (!session) return { ok: false, status: 401, error: "unauthorized" };
    const [sub] = await database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    const isStaff = session.role === "owner" || session.role === "admin";
    if (!sub) return { ok: false, status: 404, error: "subscription_not_found" };
    if (isStaff) return { ok: true, sub, isStaff };
    if (session.role === "customer" && sub.customerId === session.sub) {
      return { ok: true, sub, isStaff: false };
    }
    // A customer touching someone else's subscription — hide its existence (T-03-18).
    return { ok: false, status: 404, error: "subscription_not_found" };
  }

  /** Flip a subscription's status (pause/resume/cancel share this shape). */
  async function setStatus(
    session: Session | null,
    id: string,
    status: "active" | "paused" | "cancelled",
    set: { status?: number | string },
  ) {
    const auth = await authorize(session, id);
    if (!auth.ok) {
      set.status = auth.status;
      return { error: auth.error };
    }
    const [row] = await database
      .update(subscriptions)
      .set({ status })
      .where(eq(subscriptions.id, id))
      .returning({ id: subscriptions.id, status: subscriptions.status });
    return row;
  }

  return (
    new Elysia()
      // Resolve the session once per request (null for missing/invalid tokens).
      .derive(async ({ headers }) => {
        const token = bearer(headers);
        if (!token) return { session: null as Session | null };
        try {
          return { session: (await verifySession(token)) as Session | null };
        } catch {
          return { session: null as Session | null };
        }
      })

      // ── Admin roster (staff only) ───────────────────────────────────────────
      // member · package · frequency · status + the latest generated round and its
      // substitution flag (read from the box line's box_bom_json — no migration).
      .get(
        "/subscriptions",
        async ({ session, set }) => {
          if (!session || (session.role !== "owner" && session.role !== "admin")) {
            set.status = session ? 403 : 401;
            return { error: session ? "forbidden" : "unauthorized" };
          }
          const subs = await database
            .select({
              id: subscriptions.id,
              customerId: subscriptions.customerId,
              customerName: customers.name,
              packageCode: subscriptions.packageCode,
              packageValueSatang: subscriptions.packageValueSatang,
              frequency: subscriptions.frequency,
              status: subscriptions.status,
              createdAt: subscriptions.createdAt,
            })
            .from(subscriptions)
            .innerJoin(customers, eq(customers.id, subscriptions.customerId));

          if (subs.length === 0) return [];

          // Latest generated order per subscription → its round name + substitution.
          const genRows = await database
            .select({
              subscriptionId: subscriptionOrders.subscriptionId,
              roundName: rounds.name,
              createdAt: subscriptionOrders.createdAt,
              boxBomJson: orderLines.boxBomJson,
            })
            .from(subscriptionOrders)
            .innerJoin(rounds, eq(rounds.id, subscriptionOrders.roundId))
            .innerJoin(
              orderLines,
              and(
                eq(orderLines.orderId, subscriptionOrders.orderId),
                eq(orderLines.lineKind, "box"),
              ),
            )
            .where(
              inArray(
                subscriptionOrders.subscriptionId,
                subs.map((s) => s.id),
              ),
            );

          const latest = new Map<string, { roundName: string; substitution: boolean }>();
          for (const g of genRows) {
            const prev = latest.get(g.subscriptionId);
            const substitution =
              (g.boxBomJson as { substitution?: boolean } | null)?.substitution ?? false;
            // genRows are not ordered; keep the newest by createdAt.
            if (!prev) latest.set(g.subscriptionId, { roundName: g.roundName, substitution });
          }

          return subs.map((s) => {
            const l = latest.get(s.id);
            return {
              ...s,
              latestRoundName: l?.roundName ?? null,
              substitutionMade: l?.substitution ?? false,
            };
          });
        },
      )

      // ── Pause / resume / cancel (shared admin + customer self-service) ──────────
      // Status changes take effect from the NEXT round (D-14), so they are allowed at
      // any time; the generator reads status at run time.
      .post(
        "/subscriptions/:id/pause",
        ({ session, params, set }) => setStatus(session, params.id, "paused", set),
        { params: IdParams },
      )
      .post(
        "/subscriptions/:id/resume",
        ({ session, params, set }) => setStatus(session, params.id, "active", set),
        { params: IdParams },
      )
      .post(
        "/subscriptions/:id/cancel",
        ({ session, params, set }) => setStatus(session, params.id, "cancelled", set),
        { params: IdParams },
      )

      // ── Skip one round (D-14) ───────────────────────────────────────────────
      // Idempotent: the DB UNIQUE(subscription_id, round_id) makes a repeat skip a
      // no-op. A customer may only skip a round BEFORE its cut-off; staff bypass.
      .post(
        "/subscriptions/:id/skip",
        async ({ session, params, body, set }) => {
          const auth = await authorize(session, params.id);
          if (!auth.ok) {
            set.status = auth.status;
            return { error: auth.error };
          }
          const [round] = await database
            .select({ id: rounds.id, cutoffAt: rounds.cutoffAt })
            .from(rounds)
            .where(eq(rounds.id, body.roundId))
            .limit(1);
          if (!round) {
            set.status = 404;
            return { error: "round_not_found" };
          }
          // Cut-off gate (D-14) — customers only; a passed cut-off applies to the
          // next round, not this one. Staff can skip regardless.
          if (!auth.isStaff && round.cutoffAt && new Date() > round.cutoffAt) {
            set.status = 409;
            return { error: "cutoff_passed" };
          }
          try {
            await database
              .insert(subscriptionSkips)
              .values({ subscriptionId: params.id, roundId: body.roundId });
          } catch (err) {
            // A repeat skip trips the UNIQUE — a safe idempotent no-op.
            if (!isUniqueViolation(err)) throw err;
          }
          return { subscriptionId: params.id, roundId: body.roundId, skipped: true };
        },
        { params: IdParams, body: SkipBody },
      )
  );
}

/** SQLSTATE 23505 unique-violation, walking drizzle's wrapped `.cause` chain. */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Default instance bound to the runtime db — composed in index.ts.
export const subscriptionsRoutes = makeSubscriptionsRoutes();
