// Payments routes.
//
//   GET  /orders/:id/qr             — OPEN (D-11): idempotent re-render of the SAME
//     stored PromptPay payload with remaining hold time. Never regenerates, never
//     mutates hold_expires_at, never schedules a second timer (02-04).
//
//   POST /orders/:id/slip           — OPEN: the customer uploads a payment slip.
//     Compress (sharp) → store under a SERVER-ASSIGNED private R2 key → verify via
//     the swappable SlipVerifier (02-06) → auto-transition to `paid` on a clean
//     result, park in awaiting-review on `unavailable` (D-04), reject otherwise.
//     Duplicate slips are blocked SYSTEM-WIDE: transRef persists under the partial
//     UNIQUE index (payments_trans_ref_idx) — a unique-violation on insert IS the
//     duplicate rejection (D-06 / Pitfall 3), not vendor-only dedup.
//
//   POST /orders/:id/confirm-payment — ADMIN (requireRole owner|admin, D-04): hand-
//     confirm an awaiting-review order to `paid` when auto-verify was unavailable.
//
//   GET  /orders/:id/slip           — ADMIN: mint a short-lived signed GET URL for
//     the stored slip. The bucket is private; the slip is viewable ONLY via this
//     signed URL — never public, never /files/presign (D-28 / PLAT-04).
//
// Storage discipline (T-02-21/T-02-22): the client NEVER supplies the object key —
// the server assigns `slips/${orderId}/${uuid}.jpg`, so a client can neither read
// nor clobber another order's slip.
//
// DI: makePaymentsRoutes(db, deps) injects the verifier, storage, compressor and
// upload fn so the route is testable without a live SlipOK/R2/sharp path.
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import sharp from "sharp";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { orders, payments } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";
import { storage as defaultStorage, type StorageClient } from "../plugins/storage.plugin";
import { applyTransition, OrderError } from "../services/order-transition";
import { slipVerifier as defaultVerifier, type SlipVerifier } from "../services/slip-verify";
import { renderQrDataUrl } from "../services/promptpay";

type PaymentsDb = PostgresJsDatabase<typeof schema>;

// Short-lived signed-URL TTL (seconds) — mirrors files.ts (Pitfall 4).
const PRESIGN_TTL = 300;

export interface PaymentsDeps {
  /** Slip verifier (default: env-selected slipVerifier from 02-06). */
  verifier?: SlipVerifier;
  /** Storage client for the private R2 bucket (presign helpers). */
  storage?: StorageClient;
  /** Compress raw slip bytes → jpeg (default: sharp rotate/resize/quality). */
  compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Persist compressed slip bytes at `key` (default: presigned PUT to R2). */
  putSlip?: (key: string, bytes: Uint8Array) => Promise<void>;
}

/** Default slip compression: auto-rotate, cap width 1080, jpeg q~72. */
async function sharpCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: 1080, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return new Uint8Array(out);
}

/**
 * True for a PostgreSQL unique-violation (SQLSTATE 23505) — the dedup arbiter.
 * Drizzle wraps the driver error in a DrizzleQueryError, so the pg SQLSTATE lives
 * on `.cause` (the postgres.js PostgresError); walk the cause chain to find it.
 */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export function makePaymentsRoutes(database: PaymentsDb = defaultDb, deps: PaymentsDeps = {}) {
  const verifier = deps.verifier ?? defaultVerifier;
  const storage = deps.storage ?? defaultStorage;
  const compress = deps.compress ?? sharpCompress;
  const putSlip =
    deps.putSlip ??
    (async (key: string, bytes: Uint8Array) => {
      const url = storage.presignPut(key, PRESIGN_TTL);
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        // WR-04: fresh Uint8Array → ArrayBuffer-backed BodyInit so the DOM-lib
        // vue-tsc gate accepts the fetch body (Bun already accepted the view).
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new Error(`slip store failed: ${res.status}`);
    });

  return (
    new Elysia()
      .get(
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
      )
      // Customer uploads a slip → compress → private R2 → verify → paid/review/reject.
      .post(
        "/orders/:id/slip",
        async ({ params, body, set }) => {
          const orderId = params.id;
          const [ord] = await database
            .select({
              status: orders.status,
              subtotalSatang: orders.subtotalSatang,
              deliveryFeeSatang: orders.deliveryFeeSatang,
            })
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);
          if (!ord) {
            set.status = 404;
            return { error: "order_not_found" };
          }
          // Only an unpaid, awaiting-payment order can receive a slip.
          if (ord.status !== "awaiting_payment") {
            set.status = 409;
            return { error: "not_awaiting_payment" };
          }

          const expectedAmountSatang = ord.subtotalSatang + (ord.deliveryFeeSatang ?? 0);

          // Compress + store the image under a SERVER-ASSIGNED private key. When
          // only a QR string is supplied (no image), there is nothing to store.
          let slipKey: string | null = null;
          let image: Uint8Array | undefined;
          if (body.slip) {
            const raw = new Uint8Array(await body.slip.arrayBuffer());
            image = await compress(raw);
            slipKey = `slips/${orderId}/${crypto.randomUUID()}.jpg`;
            await putSlip(slipKey, image);
          } else if (!body.qrPayload) {
            set.status = 422;
            return { error: "slip_required" };
          }

          const result = await verifier.verify({ image, qrPayload: body.qrPayload, expectedAmountSatang });

          if (result.status === "clean") {
            try {
              await database.transaction(async (tx) => {
                try {
                  // The UNIQUE transRef insert is the system-wide dedup arbiter (D-06).
                  await tx.insert(payments).values({
                    orderId,
                    status: "clean",
                    transRef: result.transRef,
                    amountSatang: result.amountSatang,
                    slipKey,
                    rawJson: result.raw as object,
                  });
                } catch (e) {
                  if (isUniqueViolation(e)) throw new OrderError("duplicate_slip", 409);
                  throw e;
                }
                // Clean verify auto-advances the order via the SHARED transition (D-05);
                // the 02-07 notify hook fires post-commit off this transition.
                await applyTransition(tx, orderId, "paid");
              });
            } catch (e) {
              if (e instanceof OrderError) {
                set.status = e.httpStatus;
                return { error: e.code };
              }
              throw e;
            }
            set.status = 200;
            return { id: orderId, status: "paid", transRef: result.transRef };
          }

          if (result.status === "rejected") {
            // Persist the rejection for audit; leave the order awaiting_payment so the
            // customer can retry with a correct slip.
            await database.insert(payments).values({
              orderId,
              status: "rejected",
              rejectReason: result.reason,
              slipKey,
              rawJson: result.raw as object,
            });
            // A vendor-flagged duplicate is a 409 like the DB arbiter; the rest are 422.
            set.status = result.reason === "duplicate" ? 409 : 422;
            return { error: result.reason };
          }

          // unavailable → park for admin manual-confirm (D-04). The order stays
          // awaiting_payment; the 02-07 expiry sweep treats an under-review payment
          // as a no-op so a pending slip is never auto-cancelled.
          await database.insert(payments).values({
            orderId,
            status: "awaiting_review",
            slipKey,
            rawJson: (result.raw ?? null) as object,
          });
          set.status = 202;
          return { id: orderId, status: "awaiting_review" };
        },
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          body: t.Object({
            slip: t.Optional(t.File()),
            qrPayload: t.Optional(t.String()),
          }),
        },
      )
      // Admin hand-confirms an awaiting-review order to paid (D-04).
      .post(
        "/orders/:id/confirm-payment",
        async ({ params, set }) => {
          const orderId = params.id;
          try {
            const { status } = await database.transaction(async (tx) => {
              const r = await applyTransition(tx, orderId, "paid");
              // Reflect the manual confirm on the parked payment row (best-effort).
              await tx
                .update(payments)
                .set({ status: "clean" })
                .where(and(eq(payments.orderId, orderId), eq(payments.status, "awaiting_review")));
              return r;
            });
            set.status = 200;
            return { id: orderId, status };
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
          beforeHandle: requireRole("owner", "admin"),
        },
      )
      // Admin mints a short-lived signed GET URL to view the private slip (D-28).
      .get(
        "/orders/:id/slip",
        async ({ params, set }) => {
          const [row] = await database
            .select({ slipKey: payments.slipKey })
            .from(payments)
            .where(and(eq(payments.orderId, params.id)))
            .orderBy(desc(payments.createdAt))
            .limit(1);
          if (!row?.slipKey) {
            set.status = 404;
            return { error: "slip_not_found" };
          }
          return { url: storage.presignGet(row.slipKey, PRESIGN_TTL) };
        },
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          beforeHandle: requireRole("owner", "admin"),
        },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const paymentsRoutes = makePaymentsRoutes();
