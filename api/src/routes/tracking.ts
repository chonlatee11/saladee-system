// Carrier delivery-tracking routes (04-05 / DEL-05, D-22). Fills the 04-02 stub with
// the owner|admin tracking endpoints. Mirrors the coupons.ts admin idiom: every route
// closes over the injected db (makeTrackingRoutes(db) DI) and is guarded by
// requireRole("owner","admin") — a non-admin can never set tracking or change the
// delivery status (T-04-15). The status enum is TypeBox-validated, so a value outside
// `delivery_status` is a clean 422 (T-04-16).
//
// Each transition notifies the customer via LINE by REUSING the Phase-2 notify seam
// (notify.ts pushOrderUpdate) — a member (line_user_id) gets one Flex, a guest is
// skipped by the guard already in pushOrderUpdate (T-04-17). No new LINE client here.
//
// Carrier values flow through the env-selected adapter seam (services/carrier): manual
// entry this phase (D-21), a real Grab/Lalamove API later with NO route rework.
import { desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import { customers, orders } from "../db/schema";
import type * as schema from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { carrierAdapter, type DeliveryStatus } from "../services/carrier";
import { defaultLinePush, type LinePush, pushOrderUpdate } from "../services/notify";
import type { Milestone, OrderNotifyData } from "../services/order-transition";

type TrackingDb = PostgresJsDatabase<typeof schema>;

const IdParams = t.Object({ orderId: t.String({ format: "uuid" }) });

// A closed enum — TypeBox rejects anything else with a 422 (T-04-16). Keeps the route
// from ever persisting a status outside the delivery_status enum.
const DeliveryStatusSchema = t.Union([
  t.Literal("pending"),
  t.Literal("handed_to_carrier"),
  t.Literal("in_transit"),
  t.Literal("delivered"),
  t.Literal("failed"),
]);

const PatchTrackingBody = t.Object({
  carrier: t.String({ minLength: 1, maxLength: 64 }),
  trackingNumber: t.String({ minLength: 1, maxLength: 128 }),
  deliveryStatus: DeliveryStatusSchema,
});

// Order statuses that are candidates for delivery tracking (realised, not yet done).
const TRACKABLE_ORDER_STATUSES = ["paid", "packing", "shipping"] as const;

// A delivery-status transition → the customer-facing milestone Flex it reuses. The
// forward-progress states map onto the existing "shipping"/"done" copy (matches the
// Thai delivery copy exactly). pending (pre-carrier) and failed have no milestone card
// — staff handle a failed delivery manually; no push fires for those.
const DELIVERY_MILESTONE: Partial<Record<DeliveryStatus, Milestone>> = {
  handed_to_carrier: "shipping",
  in_transit: "shipping",
  delivered: "done",
};

export function makeTrackingRoutes(database: TrackingDb = defaultDb, line: LinePush = defaultLinePush) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // List orders that still need / are in delivery tracking (owner|admin).
      .get(
        "/tracking",
        async () => {
          const rows = await database
            .select({
              id: orders.id,
              recipientName: orders.recipientName,
              recipientPhone: orders.recipientPhone,
              recipientAddress: orders.recipientAddress,
              deliveryMethod: orders.deliveryMethod,
              carrier: orders.carrier,
              trackingNumber: orders.trackingNumber,
              deliveryStatus: orders.deliveryStatus,
              trackingUpdatedAt: orders.trackingUpdatedAt,
              status: orders.status,
              createdAt: orders.createdAt,
            })
            .from(orders)
            .where(inArray(orders.status, [...TRACKABLE_ORDER_STATUSES]))
            .orderBy(desc(orders.createdAt));
          return { orders: rows };
        },
        { beforeHandle: staff },
      )
      // One order's tracking snapshot (owner|admin). 404 when the id is unknown.
      .get(
        "/tracking/:orderId",
        async ({ params, set }) => {
          const [row] = await database
            .select({
              id: orders.id,
              recipientName: orders.recipientName,
              recipientPhone: orders.recipientPhone,
              recipientAddress: orders.recipientAddress,
              carrier: orders.carrier,
              trackingNumber: orders.trackingNumber,
              deliveryStatus: orders.deliveryStatus,
              trackingUpdatedAt: orders.trackingUpdatedAt,
              status: orders.status,
            })
            .from(orders)
            .where(eq(orders.id, params.orderId));
          if (!row) {
            set.status = 404;
            return { error: "order_not_found" };
          }
          return row;
        },
        { params: IdParams, beforeHandle: staff },
      )
      // Set carrier + tracking number + delivery status (owner|admin). The status is
      // enum-validated (422 otherwise); each transition pushes a LINE Flex via the
      // reused notify seam (guest skipped by the guard). 404 when the order is unknown.
      .patch(
        "/tracking/:orderId",
        async ({ params, body, set }) => {
          // Route carrier values through the env-selected adapter (manual pass-through
          // now; a real vendor API later). Also re-validates the status enum.
          const record = await carrierAdapter.recordTracking({
            carrier: body.carrier,
            trackingNumber: body.trackingNumber,
            status: body.deliveryStatus,
          });

          const [row] = await database
            .update(orders)
            .set({
              carrier: record.carrier,
              trackingNumber: record.trackingNumber,
              deliveryStatus: record.status,
              trackingUpdatedAt: new Date(),
            })
            .where(eq(orders.id, params.orderId))
            .returning({
              id: orders.id,
              customerId: orders.customerId,
              status: orders.status,
              subtotalSatang: orders.subtotalSatang,
              deliveryFeeSatang: orders.deliveryFeeSatang,
              discountSatang: orders.discountSatang,
              carrier: orders.carrier,
              trackingNumber: orders.trackingNumber,
              deliveryStatus: orders.deliveryStatus,
              trackingUpdatedAt: orders.trackingUpdatedAt,
            });
          if (!row) {
            set.status = 404;
            return { error: "order_not_found" };
          }

          // Notify the customer via the reused seam — a member (line_user_id) gets one
          // Flex, a guest is skipped inside pushOrderUpdate (T-04-17). Only forward
          // milestones push (pending/failed have no card).
          const milestone = DELIVERY_MILESTONE[record.status];
          if (milestone) {
            const [cust] = await database
              .select({ lineUserId: customers.lineUserId })
              .from(customers)
              .where(eq(customers.id, row.customerId));
            const notify: OrderNotifyData = {
              id: row.id,
              status: row.status,
              lineUserId: cust?.lineUserId ?? null,
              subtotalSatang: row.subtotalSatang,
              deliveryFeeSatang: row.deliveryFeeSatang,
              totalSatang:
                row.subtotalSatang + (row.deliveryFeeSatang ?? 0) - (row.discountSatang ?? 0),
            };
            // Fire-and-forget error boundary: a push failure never fails the committed
            // tracking update (the order row is already persisted).
            await pushOrderUpdate(line, notify, milestone).catch(() => false);
          }

          set.status = 200;
          return {
            id: row.id,
            carrier: row.carrier,
            trackingNumber: row.trackingNumber,
            deliveryStatus: row.deliveryStatus,
            trackingUpdatedAt: row.trackingUpdatedAt,
          };
        },
        { params: IdParams, body: PatchTrackingBody, beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts (04-02 seam).
export const trackingRoutes = makeTrackingRoutes();
