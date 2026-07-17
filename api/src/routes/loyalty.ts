// Loyalty routes (04-03 / CUST-03). Fills the 04-02 stub with the member-facing
// points balance. Reuses the 02-09 me-orders member gate verbatim: a valid customer
// session AND a customer row carrying a line_user_id (a guest → 403, missing/invalid
// token → 401). The balance is the append-only ledger SUM resolved server-side
// (services/loyalty.ts getBalance) — never a client-trusted value.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia } from "elysia";
import { db as defaultDb } from "../db/client";
import { customers } from "../db/schema";
import type * as schema from "../db/schema";
import { type Session, verifySession } from "../plugins/auth.plugin";
import { getBalance } from "../services/loyalty";

type LoyaltyDb = PostgresJsDatabase<typeof schema>;

/** Extract a Bearer token from either header casing (mirrors me-orders). */
function bearer(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization ?? headers.Authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export function makeLoyaltyRoutes(database: LoyaltyDb = defaultDb) {
  // Member guard (D-19): a valid customer session AND a line_user_id-bearing row.
  const memberGuard = async ({
    session,
    set,
  }: {
    session: Session | null;
    set: { status?: number | string };
  }) => {
    if (!session) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (session.role !== "customer") {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [cust] = await database
      .select({ lineUserId: customers.lineUserId })
      .from(customers)
      .where(eq(customers.id, session.sub))
      .limit(1);
    if (!cust || cust.lineUserId === null) {
      set.status = 403;
      return { error: "forbidden" };
    }
    return undefined;
  };

  return new Elysia()
    .derive(async ({ headers }) => {
      const token = bearer(headers);
      if (!token) return { session: null as Session | null };
      try {
        return { session: (await verifySession(token)) as Session | null };
      } catch {
        return { session: null as Session | null };
      }
    })
    // The authenticated member's own points balance (SUM of the ledger).
    .get(
      "/loyalty/balance",
      async ({ session }) => {
        // The guard guarantees a member session; scope strictly to session.sub.
        const balance = await getBalance(database, (session as Session).sub);
        return { balance };
      },
      { beforeHandle: memberGuard },
    );
}

// Default instance bound to the runtime db — composed in index.ts (04-02 seam).
export const loyaltyRoutes = makeLoyaltyRoutes();
