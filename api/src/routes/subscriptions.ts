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
import { and, asc, eq, inArray } from "drizzle-orm";
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

// Server-defined subscription package values (D-12 — a package is BY VALUE, S/M/L).
// The customer picks a CODE only; the box's satang value is SERVER authority so a
// tampered client body can never inflate the box (T-03-20 money surface). fillBox()
// (03-07) fills each round's availability up to this value.
const PACKAGE_VALUES: Record<"S" | "M" | "L", number> = {
  S: 30000, // ฿300
  M: 50000, // ฿500
  L: 80000, // ฿800
};

// Customer signup body (03-08 LIFF): the client sends the CODE + frequency ONLY —
// never the money value. packageValueSatang is resolved from PACKAGE_VALUES server-side.
const CreateSubscriptionBody = t.Object({
  packageCode: t.Union([t.Literal("S"), t.Literal("M"), t.Literal("L")]),
  frequency: t.Union([t.Literal("weekly"), t.Literal("biweekly")]),
});

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

  // Member gate for the customer self-service list/create (03-08 LIFF): a valid
  // CUSTOMER session whose customer row bears a line_user_id (mirrors me-orders
  // D-19). Returns the member customerId when allowed, else an HTTP mapping. Staff
  // manage subscriptions through the admin roster, not this member surface.
  async function requireMember(
    session: Session | null,
    set: { status?: number | string },
  ): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
    if (!session) {
      set.status = 401;
      return { ok: false, error: "unauthorized" };
    }
    if (session.role !== "customer") {
      set.status = 403;
      return { ok: false, error: "forbidden" };
    }
    const [cust] = await database
      .select({ lineUserId: customers.lineUserId })
      .from(customers)
      .where(eq(customers.id, session.sub))
      .limit(1);
    if (!cust || cust.lineUserId === null) {
      set.status = 403;
      return { ok: false, error: "forbidden" };
    }
    return { ok: true, customerId: session.sub };
  }

  // The soonest upcoming OPEN round (id · name · cut-off · delivery) — the customer
  // manage view needs it to offer a round-specific skip and render the after-cut-off
  // locked notice (D-14). The cut-off is SERVER authority; the UI only mirrors it.
  async function nextOpenRound() {
    const [round] = await database
      .select({
        id: rounds.id,
        name: rounds.name,
        cutoffAt: rounds.cutoffAt,
        deliveryDate: rounds.deliveryDate,
      })
      .from(rounds)
      .where(eq(rounds.status, "open"))
      .orderBy(asc(rounds.cutoffAt), asc(rounds.deliveryDate))
      .limit(1);
    return round ?? null;
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

      // ── Customer self-service: list own + sign up (03-08 LIFF, SALE-03) ────────
      // The member's OWN subscriptions + the next open round (for skip + cut-off
      // notice). Scoped by session.sub — never another member's (T-03-20 IDOR).
      .get("/me/subscriptions", async ({ session, set }) => {
        const guard = await requireMember(session, set);
        if (!guard.ok) return { error: guard.error };
        const subs = await database
          .select({
            id: subscriptions.id,
            packageCode: subscriptions.packageCode,
            packageValueSatang: subscriptions.packageValueSatang,
            frequency: subscriptions.frequency,
            status: subscriptions.status,
            createdAt: subscriptions.createdAt,
          })
          .from(subscriptions)
          .where(eq(subscriptions.customerId, guard.customerId))
          .orderBy(asc(subscriptions.createdAt));
        return { subscriptions: subs, nextRound: await nextOpenRound() };
      })
      // Sign up for a box (D-12): CODE + frequency in; packageValueSatang is resolved
      // SERVER-side from PACKAGE_VALUES (never trusts a client money value, T-03-20).
      .post(
        "/me/subscriptions",
        async ({ session, body, set }) => {
          const guard = await requireMember(session, set);
          if (!guard.ok) return { error: guard.error };
          const [row] = await database
            .insert(subscriptions)
            .values({
              customerId: guard.customerId,
              packageCode: body.packageCode,
              packageValueSatang: PACKAGE_VALUES[body.packageCode],
              frequency: body.frequency,
            })
            .returning({
              id: subscriptions.id,
              packageCode: subscriptions.packageCode,
              packageValueSatang: subscriptions.packageValueSatang,
              frequency: subscriptions.frequency,
              status: subscriptions.status,
            });
          set.status = 201;
          return row;
        },
        { body: CreateSubscriptionBody },
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
