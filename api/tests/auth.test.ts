// Auth crypto/verify unit tests (00-05, D-08/PLAT-03).
// Proves the RBAC scaffold's primitives round-trip without DB or network:
//   - Argon2id hash/verify (Bun.password)
//   - jose HS256 session issue/verify + tampered/expired rejection
//   - LINE idToken verifier rejects an unverifiable (garbage) token
// Bun auto-loads api/.env.test (schema-valid dummy secrets) so importing the
// auth plugin satisfies boot-time env validation.
import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import {
  hashPassword,
  issueSession,
  verifyLineIdToken,
  verifyPassword,
  verifySession,
} from "../src/plugins/auth.plugin";

describe("staff password hashing (Argon2id)", () => {
  test("correct password verifies, wrong password fails", async () => {
    const hash = await hashPassword("s3cret");
    expect(hash).not.toBe("s3cret"); // stored value is a hash, not plaintext
    expect(await verifyPassword("s3cret", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("jose HS256 session JWT", () => {
  test("issue → verify round-trips sub + role", async () => {
    const token = await issueSession("u1", "admin");
    const session = await verifySession(token);
    expect(session.sub).toBe("u1");
    expect(session.role).toBe("admin");
  });

  test("tampered token is rejected", async () => {
    const token = await issueSession("u1", "admin");
    // Flip the final signature character to break the HS256 signature.
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifySession(tampered)).rejects.toThrow();
  });

  test("expired token is rejected", async () => {
    const key = new TextEncoder().encode(process.env.JWT_SECRET as string);
    const expired = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(verifySession(expired)).rejects.toThrow();
  });
});

describe("LINE idToken verification (ES256 remote JWKS)", () => {
  test("garbage idToken is rejected (never accepts an unverifiable token)", async () => {
    // A non-JWS string fails at compact-serialization decode, before any JWKS
    // fetch — so this is a pure unit assertion with no network dependency.
    expect(verifyLineIdToken("garbage")).rejects.toThrow();
  });
});
