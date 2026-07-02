// Auth route scaffolds (00-05, D-08/PLAT-03). Exposes:
//   POST /auth/staff  — password login (Argon2id verify → HS256 session)
//   POST /auth/line   — LIFF idToken exchange (ES256 verify → HS256 session)
// These are Phase-0 scaffolds: the crypto is real (via the `auth` plugin) but
// the users/customers table lookups are deferred to Phase 1 (D-07). There is NO
// fabricated success path — a request only succeeds against real verification.
// This file must NOT edit index.ts (index composes authPlugin + authRoutes).
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authPlugin)
  .post(
    "/staff",
    async ({ body, auth, set }) => {
      // TODO(Phase 1, D-07 + 00-02 `users` table): replace the request-supplied
      // `passwordHash` with a lookup of the staff user's stored Argon2id hash and
      // role by `email`. Phase 0 exercises verifyPassword against a supplied hash
      // only — no user row is fabricated, and role is not yet authoritative.
      const ok = await auth.verifyPassword(body.password, body.passwordHash);
      if (!ok) {
        // Generic error — no user-enumeration signal (trust boundary note).
        set.status = 401;
        return { error: "invalid_credentials" };
      }
      const token = await auth.issueSession(body.email, "admin");
      return { token };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 1 }),
        // Phase-0-only affordance: the stored hash is supplied by the caller so
        // the scaffold can exercise real verification before the users table
        // exists. Removed in Phase 1 when the lookup is wired.
        passwordHash: t.String({ minLength: 1 }),
      }),
    },
  )
  .post(
    "/line",
    async ({ body, auth, set }) => {
      try {
        const payload = await auth.verifyLineIdToken(body.idToken);
        // TODO(Phase 1, 00-02 customers): upsert the LINE user (`sub`) and derive
        // consent/role. Phase 0 mints a scaffold session; "packer" is a placeholder
        // until the customer role is modelled.
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
