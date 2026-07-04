// Auth routes (01-03, D-07/PLAT-03/T-01-22). Exposes:
//   POST /auth/staff  — REAL staff login: look up the users row by email and
//                       verify the submitted password against the STORED Argon2id
//                       hash (Bun.password.verify), then issue a session carrying
//                       the row's stored role. The Phase-0 forgery path (trusting a
//                       CLIENT-SUPPLIED hash) is removed — the body no longer has a
//                       passwordHash field and the handler only reads the stored one.
//   POST /auth/line   — LIFF idToken exchange (ES256 verify → HS256 session).
//                       Verifies the idToken server-side, upserts a member
//                       `customers` row keyed on line_user_id (=payload.sub), and
//                       issues a CUSTOMER session (never a staff role — T-02-06).
//                       Returns { token, customerId, lineUserId } (02-02/LINE-02).
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
import { customers, users } from "../db/schema";
import { authPlugin } from "../plugins/auth.plugin";

type AuthDb = PostgresJsDatabase<typeof schema>;

// A fixed, valid Argon2id hash (of a throwaway random value — NOT a secret and
// no real password verifies against it) used ONLY to equalize timing on the
// unknown-email path. Running the expensive verify in BOTH branches removes the
// user-enumeration timing side-channel: an attacker can no longer distinguish
// "email exists" from "email unknown" by measuring response latency (WR-01 /
// T-01-23). Precomputed once so it costs nothing at boot.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$Ctw68ZVqlQz7yieuNFlzGAVr2UTJwbW/pudEQq3SQ38$mKqAbQz7w5ZzYn643DDtXa2AsgAvtFI5aY91Ak3SLDA";

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
        // Always run Argon2id verify — against the stored hash if the row exists,
        // else against a fixed dummy hash — so BOTH the unknown-email and
        // wrong-password paths spend comparable time. Constant, generic 401 for
        // both cases: no enumeration signal in body OR timing (WR-01 / T-01-23).
        const ok = await auth.verifyPassword(
          body.password,
          row?.passwordHash ?? DUMMY_PASSWORD_HASH,
        );
        if (!row || !ok) {
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
        // 1) Verify the LIFF idToken SERVER-SIDE (jose ES256, iss=access.line.me,
        //    aud=LINE_LOGIN_CHANNEL_ID — Pitfall 4). A forged/expired/tampered token
        //    throws → generic 401, no upsert. Only the verify is wrapped so a later
        //    DB fault surfaces as a 500, not a misleading "invalid_id_token".
        let payload: Awaited<ReturnType<typeof auth.verifyLineIdToken>>;
        try {
          payload = await auth.verifyLineIdToken(body.idToken);
        } catch {
          set.status = 401;
          return { error: "invalid_id_token" };
        }

        // 2) The verified `sub` IS the LINE user id — the trusted key we upsert on.
        const lineUserId = String(payload.sub);
        // LINE's idToken may carry a display name only when the profile scope was
        // granted; treat it as optional and never trust it as an identity claim.
        const lineName = typeof payload.name === "string" ? payload.name : null;

        // 3) Find-or-insert the customer by line_user_id and flag them a member
        //    (D-17). (A UNIQUE(line_user_id) index is a follow-up hardening — see
        //    SUMMARY Deferred; the login flow is single-request per user so the
        //    find-or-insert race window is negligible for the MVP.)
        const [existing] = await database
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.lineUserId, lineUserId))
          .limit(1);

        let customerId: string;
        if (existing) {
          customerId = existing.id;
          await database
            .update(customers)
            .set({ isMember: true, ...(lineName ? { name: lineName } : {}) })
            .where(eq(customers.id, customerId));
        } else {
          const [inserted] = await database
            .insert(customers)
            .values({ lineUserId, isMember: true, name: lineName })
            .returning({ id: customers.id });
          if (!inserted) throw new Error("customer upsert returned no row");
          customerId = inserted.id;
        }

        // 4) Issue a CUSTOMER session only — never a staff role (T-02-06). The
        //    session subject is the customerId (our id), not the LINE id.
        const token = await auth.issueSession(customerId, "customer");
        return { token, customerId, lineUserId };
      },
      {
        body: t.Object({ idToken: t.String({ minLength: 1 }) }),
      },
    );
}

// Default instance bound to the runtime db — composed in index.ts (unchanged).
export const authRoutes = makeAuthRoutes();
