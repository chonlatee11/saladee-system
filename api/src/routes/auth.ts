// Auth routes (01-03, D-07/PLAT-03/T-01-22). Exposes:
//   POST /auth/staff  — REAL staff login: look up the users row by email and
//                       verify the submitted password against the STORED Argon2id
//                       hash (Bun.password.verify), then issue a session carrying
//                       the row's stored role. The Phase-0 forgery path (trusting a
//                       CLIENT-SUPPLIED hash) is removed — the body no longer has a
//                       passwordHash field and the handler only reads the stored one.
//   POST /auth/line   — LIFF idToken exchange (ES256 verify → HS256 session).
//                       Unchanged here — its customer wiring is out of this plan.
//
// DI: makeAuthRoutes(db) injects the database so the endpoint tests against the
// seeded test pool (mirrors makeOrdersRoutes/makeVarietiesRoutes). The default
// `authRoutes` binds the runtime db and is what index.ts already composes — this
// file does NOT edit index.ts. `auth` (verify/issue) comes from authPlugin.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { users } from "../db/schema";
import { authPlugin } from "../plugins/auth.plugin";

type AuthDb = PostgresJsDatabase<typeof schema>;

export function makeAuthRoutes(database: AuthDb = defaultDb) {
  return new Elysia({ prefix: "/auth" })
    .use(authPlugin)
    .post(
      "/staff",
      async ({ body, auth, set }) => {
        // Look up the staff user by email (parameterized — T-01-13). A single
        // generic 401 for BOTH "no row" and "bad password" — no enumeration signal
        // (T-01-23). Never trust a client-supplied hash or role (T-01-22): the role
        // is read from the row, the hash compared is the STORED one.
        const [row] = await database
          .select({ id: users.id, passwordHash: users.passwordHash, role: users.role })
          .from(users)
          .where(eq(users.email, body.email))
          .limit(1);
        if (!row) {
          set.status = 401;
          return { error: "invalid_credentials" };
        }
        const ok = await auth.verifyPassword(body.password, row.passwordHash);
        if (!ok) {
          set.status = 401;
          return { error: "invalid_credentials" };
        }
        const token = await auth.issueSession(row.id, row.role);
        return { token };
      },
      {
        // Exactly { email, password } — the Phase-0 passwordHash affordance is gone.
        body: t.Object({
          email: t.String({ format: "email" }),
          password: t.String({ minLength: 1 }),
        }),
      },
    )
    .post(
      "/line",
      async ({ body, auth, set }) => {
        try {
          const payload = await auth.verifyLineIdToken(body.idToken);
          // TODO(Phase 2, 00-02 customers): upsert the LINE user (`sub`) and derive
          // consent/role. Phase 1 mints a scaffold session; "packer" is a placeholder
          // until the customer role is modelled (out of scope for 01-03).
          const token = await auth.issueSession(String(payload.sub), "packer");
          return { token };
        } catch {
          set.status = 401;
          return { error: "invalid_id_token" };
        }
      },
      {
        body: t.Object({ idToken: t.String({ minLength: 1 }) }),
      },
    );
}

// Default instance bound to the runtime db — composed in index.ts (unchanged).
export const authRoutes = makeAuthRoutes();
