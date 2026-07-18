// Broadcast admin routes (04-06 / MKT-03 + LINE-04). Fills the 04-02 stub with the
// owner|admin broadcast composer: create/compose a campaign, preview its consent-
// scoped audience count, send-now or schedule it onto the pg-boss `broadcast-send`
// queue, and cancel a not-yet-sent one. Mirrors the crop.ts/coupons.ts admin idiom —
// every route closes over the injected db (makeBroadcastsRoutes(db) DI) and is guarded
// by requireRole("owner","admin") (T-04-20 / V4). The audience/delivery MATH lives in
// services/broadcast.ts; this file is pure campaign management + the queue trigger.
//
// PDPA (NFR-04): the audience is ALWAYS resolved through resolveAudience (latest
// marketing consent + non-null line_user_id) — a non-consented customer can never be
// targeted, not even by a hand-crafted segment.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { broadcasts } from "../db/schema";
import { boss } from "../jobs/boss";
import { requireRole } from "../plugins/auth.plugin";
import { type BroadcastSegment, resolveAudience } from "../services/broadcast";

type BroadcastsDb = PostgresJsDatabase<typeof schema>;

// The job-queue sender seam. Defaults to pg-boss; tests inject a stub so a route call
// never needs a started worker.
export type BroadcastSender = (
  data: { broadcastId: string },
  opts?: { startAfter?: number },
) => Promise<unknown>;

const defaultSender: BroadcastSender = (data, opts) =>
  boss.send("broadcast-send", data, opts ?? {});

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

const SegmentBody = t.Object({
  type: t.Optional(
    t.Union([
      t.Literal("all"),
      t.Literal("b2c"),
      t.Literal("b2b"),
      t.Literal("subscription"),
      t.Literal("inactive"),
    ]),
  ),
  tag: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
});

// Compose body (V5 input validation). messageJson is the Flex/image/link snapshot;
// scheduledAt (ISO) present ⇒ the campaign starts as `scheduled`, else `draft`.
const CreateBroadcastBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  segment: t.Optional(SegmentBody),
  messageJson: t.Optional(t.Unknown()),
  scheduledAt: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});

/** Parse an ISO date string → Date; null on invalid/NaN (→ 422). */
function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function makeBroadcastsRoutes(
  database: BroadcastsDb = defaultDb,
  send: BroadcastSender = defaultSender,
) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // Compose a broadcast (owner|admin). Stored draft/scheduled; nothing is sent yet.
      .post(
        "/broadcasts",
        async ({ body, set }) => {
          let scheduledAt: Date | null = null;
          if (body.scheduledAt) {
            const parsed = parseDate(body.scheduledAt);
            if (!parsed) {
              set.status = 422;
              return { error: "invalid_scheduled_at" };
            }
            scheduledAt = parsed;
          }
          const [row] = await database
            .insert(broadcasts)
            .values({
              title: body.title,
              segment: body.segment ?? { type: "all" },
              messageJson: body.messageJson ?? null,
              status: scheduledAt ? "scheduled" : "draft",
              scheduledAt,
            })
            .returning();
          set.status = 201;
          return row;
        },
        { body: CreateBroadcastBody, beforeHandle: staff },
      )
      // List broadcasts, newest first (owner|admin).
      .get(
        "/broadcasts",
        async () => {
          const rows = await database.select().from(broadcasts).orderBy(desc(broadcasts.createdAt));
          return { broadcasts: rows };
        },
        { beforeHandle: staff },
      )
      // Consent-scoped audience preview for the composer (owner|admin). ALWAYS routed
      // through resolveAudience so the count reflects only marketing-consented, LINE-
      // reachable customers (PDPA copy in the composer).
      .get(
        "/broadcasts/:id/audience-count",
        async ({ params, set }) => {
          const [row] = await database
            .select({ segment: broadcasts.segment })
            .from(broadcasts)
            .where(eq(broadcasts.id, params.id));
          if (!row) {
            set.status = 404;
            return { error: "broadcast_not_found" };
          }
          const ids = await resolveAudience(database, (row.segment ?? {}) as BroadcastSegment);
          return { count: ids.length };
        },
        { params: IdParams, beforeHandle: staff },
      )
      // Send-now / schedule (owner|admin). A scheduled campaign enqueues with startAfter
      // (seconds until scheduledAt); send-now enqueues immediately. Idempotency of the
      // actual delivery is the worker's concern (status→sent).
      .post(
        "/broadcasts/:id/send",
        async ({ params, set }) => {
          const [row] = await database
            .select()
            .from(broadcasts)
            .where(eq(broadcasts.id, params.id));
          if (!row) {
            set.status = 404;
            return { error: "broadcast_not_found" };
          }
          if (row.status === "sent") {
            set.status = 409;
            return { error: "already_sent" };
          }
          const now = Date.now();
          const startAfter =
            row.scheduledAt && row.scheduledAt.getTime() > now
              ? Math.ceil((row.scheduledAt.getTime() - now) / 1000)
              : undefined;
          await send({ broadcastId: params.id }, startAfter ? { startAfter } : undefined);
          const [updated] = await database
            .update(broadcasts)
            .set({ status: startAfter ? "scheduled" : "sent" })
            .where(eq(broadcasts.id, params.id))
            .returning({ id: broadcasts.id, status: broadcasts.status });
          return { queued: true, ...updated };
        },
        { params: IdParams, beforeHandle: staff },
      )
      // Cancel a not-yet-sent broadcast (owner|admin). Only draft/scheduled rows can be
      // cancelled; a sent campaign is immutable history → 409. Delete is scoped to the
      // cancellable statuses in the WHERE so it never removes a sent row.
      .delete(
        "/broadcasts/:id",
        async ({ params, set }) => {
          const [existing] = await database
            .select({ status: broadcasts.status })
            .from(broadcasts)
            .where(eq(broadcasts.id, params.id));
          if (!existing) {
            set.status = 404;
            return { error: "broadcast_not_found" };
          }
          if (existing.status === "sent") {
            set.status = 409;
            return { error: "already_sent" };
          }
          await database
            .delete(broadcasts)
            .where(
              and(eq(broadcasts.id, params.id), inArray(broadcasts.status, ["draft", "scheduled"])),
            );
          return { cancelled: true, id: params.id };
        },
        { params: IdParams, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts (04-02 seam).
export const broadcastsRoutes = makeBroadcastsRoutes();
