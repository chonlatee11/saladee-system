// Payments routes (02-04) — the QR re-fetch. Created here; 02-06 EXTENDS this
// module with `POST /orders/:id/slip` (sequential, no same-wave conflict).
//
//   GET /orders/:id/qr — OPEN (no requireRole): re-renders the SAME stored
//     PromptPay payload snapshotted at checkout, with the remaining hold time.
//     IDEMPOTENT (D-11): it reads the persisted qr_payload, NEVER regenerates a
//     new payload, NEVER mutates hold_expires_at, and NEVER schedules a second
//     hold-expiry timer. Re-showing the QR is therefore free of side effects — the
//     hold is set exactly once, at order creation.
//
// DI: makePaymentsRoutes(db) mirrors makeOrdersRoutes (routes/orders.ts) so the
// endpoint is testable against an injected pool; the default `paymentsRoutes`
// binds the runtime db and is what index.ts composes.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { orders } from "../db/schema";
import { renderQrDataUrl } from "../services/promptpay";

type PaymentsDb = PostgresJsDatabase<typeof schema>;

export function makePaymentsRoutes(database: PaymentsDb = defaultDb) {
  return new Elysia().get(
    "/orders/:id/qr",
    async ({ params, set }) => {
      const [ord] = await database
        .select({
          status: orders.status,
          qrPayload: orders.qrPayload,
          holdExpiresAt: orders.holdExpiresAt,
          deliveryFeeSatang: orders.deliveryFeeSatang,
          subtotalSatang: orders.subtotalSatang,
        })
        .from(orders)
        .where(eq(orders.id, params.id))
        .limit(1);

      if (!ord) {
        set.status = 404;
        return { error: "order_not_found" };
      }
      // No QR means the order was never a checkout (legacy `created` path).
      if (!ord.qrPayload) {
        set.status = 409;
        return { error: "no_qr" };
      }

      // Re-render the SAME stored payload — identical bytes every call (D-11).
      const qr = await renderQrDataUrl(ord.qrPayload);
      const holdSecondsRemaining = ord.holdExpiresAt
        ? Math.max(0, Math.floor((ord.holdExpiresAt.getTime() - Date.now()) / 1000))
        : null;
      const totalSatang = ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0);

      return {
        id: params.id,
        status: ord.status,
        qrPayload: ord.qrPayload,
        qr,
        totalSatang,
        holdExpiresAt: ord.holdExpiresAt,
        holdSecondsRemaining,
      };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const paymentsRoutes = makePaymentsRoutes();
