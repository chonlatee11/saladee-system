// Coupon admin routes (04-03 / MKT-01). Fills the 04-02 stub with the owner|admin
// coupon-composer CRUD. Mirrors the crop.ts admin idiom: every route closes over the
// injected db (makeCouponsRoutes(db) DI) and is guarded by requireRole("owner",
// "admin") — a non-admin session can never create or deactivate a coupon (T-04-10 /
// V4). The redemption MATH lives in services/coupon.ts (composed into POST /orders);
// this file is pure catalog management of the coupon rows.
//
// Money convention: discountValue is a PERCENT (1–100) when discountKind='percent',
// else a WHOLE-BAHT amount when 'baht' — kept whole so the checkout discount stays a
// whole-baht amount (Pitfall 1). minSubtotalSatang is integer satang.
import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import { coupons } from "../db/schema";
import type * as schema from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type CouponsDb = PostgresJsDatabase<typeof schema>;

const IdParams = t.Object({ id: t.String({ format: "uuid" }) });

// Create body (V5 input validation). The client supplies only coupon POLICY — never
// a redemption/usage counter (global_used starts at 0, server-owned).
const CreateCouponBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 64 }),
  discountKind: t.Union([t.Literal("percent"), t.Literal("baht")]),
  discountValue: t.Integer({ minimum: 1 }),
  minSubtotalSatang: t.Optional(t.Integer({ minimum: 0 })),
  globalLimit: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
  perCustomerLimit: t.Optional(t.Integer({ minimum: 1 })),
  applicability: t.Optional(
    t.Object({ segments: t.Array(t.Union([t.Literal("b2c"), t.Literal("b2b")]), { minItems: 1 }) }),
  ),
  expiresAt: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});

/** Parse an ISO date string → Date; null on invalid/NaN (→ 422). */
function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function makeCouponsRoutes(database: CouponsDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // Create a coupon (owner|admin). A percent value above 100 is a clean 422.
      .post(
        "/coupons",
        async ({ body, set }) => {
          if (body.discountKind === "percent" && body.discountValue > 100) {
            set.status = 422;
            return { error: "percent_out_of_range" };
          }
          let expiresAt: Date | null = null;
          if (body.expiresAt) {
            const parsed = parseDate(body.expiresAt);
            if (!parsed) {
              set.status = 422;
              return { error: "invalid_expires_at" };
            }
            expiresAt = parsed;
          }
          try {
            const [row] = await database
              .insert(coupons)
              .values({
                code: body.code,
                discountKind: body.discountKind,
                discountValue: body.discountValue,
                minSubtotalSatang: body.minSubtotalSatang ?? 0,
                globalLimit: body.globalLimit ?? null,
                perCustomerLimit: body.perCustomerLimit ?? 1,
                applicability: body.applicability ?? { segments: ["b2c"] },
                expiresAt,
              })
              .returning();
            set.status = 201;
            return row;
          } catch (e) {
            // The UNIQUE(code) index rejects a duplicate code → 409.
            if (isUniqueViolation(e)) {
              set.status = 409;
              return { error: "coupon_code_exists" };
            }
            throw e;
          }
        },
        { body: CreateCouponBody, beforeHandle: staff },
      )
      // List coupons, newest first (owner|admin).
      .get(
        "/coupons",
        async () => {
          const rows = await database.select().from(coupons).orderBy(desc(coupons.createdAt));
          return { coupons: rows };
        },
        { beforeHandle: staff },
      )
      // Deactivate a coupon (owner|admin) — it can no longer be redeemed (the guarded
      // UPDATE requires `active`). Idempotent; 404 when the id is unknown.
      .patch(
        "/coupons/:id/deactivate",
        async ({ params, set }) => {
          const [row] = await database
            .update(coupons)
            .set({ active: false })
            .where(eq(coupons.id, params.id))
            .returning({ id: coupons.id, active: coupons.active });
          if (!row) {
            set.status = 404;
            return { error: "coupon_not_found" };
          }
          return row;
        },
        { params: IdParams, beforeHandle: staff },
      )
  );
}

/** 23505 detector (mirrors payments.ts / coupon.ts) for the UNIQUE(code) collision. */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Default instance bound to the runtime db — composed in index.ts (04-02 seam).
export const couponsRoutes = makeCouponsRoutes();
