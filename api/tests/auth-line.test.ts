// Wave-0 scaffold (LINE-02) — made green by 02-03 (POST /auth/line).
// Behavior: POST /auth/line rejects a forged/expired idToken and accepts a valid
// one (mock JWKS), enforcing iss + aud=LINE_LOGIN_CHANNEL_ID + ES256 (Pitfall 4),
// then upserts a member customer by line_user_id=payload.sub and issues a session.
import { describe, it } from "bun:test";

describe("POST /auth/line (LINE-02)", () => {
  it.todo("rejects a forged/expired idToken (401)", () => {});
  it.todo("accepts a valid idToken, upserts the member, and issues a session", () => {});
});
