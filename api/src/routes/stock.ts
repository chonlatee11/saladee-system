// Back-in-stock request records — DATA-ONLY (01-04, INV-08 / D-20 / D-03).
//
//   POST /stock/back-in-stock  — OPEN: a customer asks to be alerted when a
//                                sold-out variety/round returns. The request is
//                                STORED as a back_in_stock_requests row and 201 is
//                                returned. NO message is sent and the engine does
//                                NOT auto-substitute anything (D-20) — record only.
//   GET  /stock/back-in-stock   — STAFF (owner|admin): list the stored requests.
//                                The list carries contacts, so it is guarded
//                                (T-01-16); only the POST is open.
//
// TypeBox uuid validation on all ids (T-01-17); Drizzle parameterized inserts only.
// DI: makeStockRoutes(db) mirrors the other routers; the GET carries a requireRole
// beforeHandle, the POST carries none (public self-service).
import { desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { backInStockRequests } from "../db/schema";
import { requireRole } from "../plugins/auth.plugin";

type StockDb = PostgresJsDatabase<typeof schema>;

const BackInStockBody = t.Object({
  roundId: t.String({ format: "uuid" }),
  varietyId: t.String({ format: "uuid" }),
  customerId: t.Optional(t.String({ format: "uuid" })),
  contact: t.Optional(t.String({ minLength: 1 })),
});

export function makeStockRoutes(database: StockDb = defaultDb) {
  const staff = requireRole("owner", "admin");

  return (
    new Elysia()
      // OPEN self-service: store a back-in-stock request (data-only — no send, D-20).
      .post(
        "/stock/back-in-stock",
        async ({ body, set }) => {
          const [row] = await database
            .insert(backInStockRequests)
            .values({
              roundId: body.roundId,
              varietyId: body.varietyId,
              customerId: body.customerId ?? null,
              contact: body.contact ?? null,
            })
            .returning();
          if (!row) throw new Error("back_in_stock insert returned no row");
          set.status = 201;
          return row;
        },
        { body: BackInStockBody },
      )
      // STAFF list (owner|admin) — the request list carries contacts (T-01-16).
      .get(
        "/stock/back-in-stock",
        async () =>
          database.select().from(backInStockRequests).orderBy(desc(backInStockRequests.createdAt)),
        { beforeHandle: staff },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const stockRoutes = makeStockRoutes();
