// Auth/RBAC scaffold (00-05, D-08/PLAT-03). Provides staff password
// hashing/verification (Bun.password Argon2id — NO argon2/bcrypt dependency),
// jose HS256 session issue/verify, LINE idToken verification (ES256 via LINE
// remote JWKS — Pitfall 5), and a requireRole guard over the staff role union.
//
// This file is decoupled from the DB (00-02): all helpers are pure/env-based so
// the auth slice runs in parallel with the DB slice. Wiring staff login to the
// users table is deferred to Phase 1 (D-07). It must NOT edit index.ts.
import { Elysia } from "elysia";
import { createRemoteJWKSet, type JWTPayload, jwtVerify, SignJWT } from "jose";
import { env } from "../env";
import type { Role } from "../types";

// HS256 signing key for our own session JWTs. Derived from JWT_SECRET (env-
// validated ≥32 bytes) — never a literal key in source (T-00-18).
const sessionKey = new TextEncoder().encode(env.JWT_SECRET);

// LINE's ES256 public keys for LIFF/native idTokens, selected by `kid`
// (Pitfall 5). createRemoteJWKSet caches and refreshes the JWKS internally.
const LINE_JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));

/** Session claims we mint and trust after verification. */
export interface Session {
  sub: string;
  role: Role;
}

// --- Staff password hashing (Argon2id, native — T-00-17) ---

/** Hash a plaintext password with Bun.password (Argon2id default, self-encoded params). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

/** Constant-time verify a plaintext password against a stored Argon2id hash. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// --- Session JWTs (jose HS256, 2h — T-00-18) ---

/** Issue a short-lived (2h) HS256 session JWT carrying the user id + role. */
export function issueSession(userId: string, role: Role): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(sessionKey);
}

/** Verify a session JWT (HS256); throws on tampered/expired token. */
export async function verifySession(token: string): Promise<Session> {
  const { payload } = await jwtVerify(token, sessionKey, { algorithms: ["HS256"] });
  return { sub: String(payload.sub), role: payload.role as Role };
}

// --- LINE idToken verification (ES256 remote JWKS — Pitfall 5 / T-00-16) ---

/**
 * Verify a LINE LIFF idToken against LINE's remote JWKS (ES256), enforcing
 * iss/aud/exp. Rejects forged, tampered, or unverifiable tokens. `nonce` is
 * checked by the caller when a login nonce is in play (deferred to Phase 1).
 */
export async function verifyLineIdToken(idToken: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, LINE_JWKS, {
    issuer: "https://access.line.me",
    audience: env.LINE_LOGIN_CHANNEL_ID,
    algorithms: ["ES256"],
  });
  return payload;
}

// --- RBAC guard (T-00-19) ---

/** Bearer-token context shape a route hands the guard (Elysia `beforeHandle`). */
interface GuardContext {
  headers: Record<string, string | undefined>;
  set: { status?: number | string };
}

/**
 * Build an Elysia `beforeHandle` guard that requires a valid session whose role
 * is one of `allowed`. Returns 401 on missing/invalid token, 403 on wrong role.
 * Returning `undefined` lets the request proceed.
 */
export function requireRole(...allowed: Role[]) {
  return async ({ headers, set }: GuardContext) => {
    const header = headers.authorization ?? headers.Authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    let session: Session;
    try {
      session = await verifySession(token);
    } catch {
      set.status = 401;
      return { error: "invalid_token" };
    }
    if (!allowed.includes(session.role)) {
      set.status = 403;
      return { error: "forbidden" };
    }
    // Authorized — let the route handler run.
    return undefined;
  };
}

// Composed plugin: keep name "auth" (index.ts composes it by this identity) and
// decorate the app with the auth toolkit for routes to consume.
export const authPlugin = new Elysia({ name: "auth" }).decorate("auth", {
  hashPassword,
  verifyPassword,
  issueSession,
  verifySession,
  verifyLineIdToken,
  requireRole,
});
