// VR5 member-checkout wiring — pure/unit tests that LOCK the money-path client
// change (LINE-02 / D-19). DOM-free: buildOrderBody is pure, and liff.ts is exercised
// against an in-memory localStorage shim + a mocked ./api (no live LIFF / network).
//
//   (a) buildOrderBody with a customerId emits a MEMBER customer object
//       { customerId, recipientName, recipientPhone, recipientAddress }.
//   (b) buildOrderBody WITHOUT a customerId deep-equals today's guest body — the
//       guest checkout stays byte-identical (mirrors checkout-wizard.test.ts (c)).
//   (c) loginWithLine persists the customer id, and setSessionToken(null) clears it.
//
// No money field EVER leaves the client on either path (T-02-30/T-02-31).
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { buildOrderBody, type OrderBody, POLICY_VERSION } from "../src/lib/checkout";

const ROUND = "22222222-2222-2222-2222-222222222222";
const VARIETY = "11111111-1111-1111-1111-111111111111";
const UNIT = "33333333-3333-3333-3333-333333333333";
const MEMBER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const baseOpts = () => ({
  lines: [{ roundId: ROUND, varietyId: VARIETY, saleUnitId: UNIT, qty: 2 }],
  boxLines: [] as never[],
  deliveryMethod: "general" as const,
  deliveryZone: "samut_prakan",
  customer: { name: "สมชาย", phone: "0891112222", address: "123 หมู่ 4 สมุทรปราการ" },
  consent: { usage: true, marketing: false },
});

describe("buildOrderBody member vs guest (VR5 / LINE-02)", () => {
  it("(a) emits a member customer object when customerId is set", () => {
    const body = buildOrderBody({ ...baseOpts(), customerId: MEMBER_ID });
    expect(body.customer).toEqual({
      customerId: MEMBER_ID,
      recipientName: "สมชาย",
      recipientPhone: "0891112222",
      recipientAddress: "123 หมู่ 4 สมุทรปราการ",
    });
    // Still ids + qty + choice + consent only — no money field on the member path.
    expect(JSON.stringify(body)).not.toContain("Satang");
  });

  it("(b) is byte-identical to the guest body when customerId is absent", () => {
    const withoutId = buildOrderBody(baseOpts());
    const withUndefined = buildOrderBody({ ...baseOpts(), customerId: undefined });
    const guestExpected: OrderBody = {
      tier: "b2c",
      customer: {
        name: "สมชาย",
        phone: "0891112222",
        recipientName: "สมชาย",
        recipientPhone: "0891112222",
        recipientAddress: "123 หมู่ 4 สมุทรปราการ",
      },
      deliveryMethod: "general",
      deliveryZone: "samut_prakan",
      consent: { usage: true, marketing: false, policyVersion: POLICY_VERSION },
      lines: [{ roundId: ROUND, varietyId: VARIETY, saleUnitId: UNIT, qty: 2 }],
    };
    expect(withoutId).toEqual(guestExpected);
    // Passing customerId: undefined (the wizard's `?? undefined`) is the guest path too.
    expect(withUndefined).toEqual(guestExpected);
  });
});

// ── liff.ts persistence (in-memory localStorage shim + mocked ./api) ────────────
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("liff customerId persistence (VR5 / LINE-02 / D-19)", () => {
  beforeEach(() => {
    installLocalStorage();
    // VITE_LIFF_ID makes getIdToken() take the configured path; @line/liff is mocked.
    process.env.VITE_LIFF_ID = "test-liff-id";
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    process.env.VITE_LIFF_ID = undefined;
  });

  it("(c) loginWithLine persists the customer id; setSessionToken(null) clears it", async () => {
    // Mock the LIFF SDK: logged in, returns an idToken to exchange.
    mock.module("@line/liff", () => ({
      default: { isLoggedIn: () => true, getIDToken: () => "id-token-abc" },
    }));
    // Mock the api: the /auth/line exchange returns a session + member identity.
    mock.module("../src/api", () => ({
      api: {
        auth: {
          line: {
            post: async () => ({
              data: { token: "sess-token", customerId: MEMBER_ID, lineUserId: "U_1" },
              error: null,
            }),
          },
        },
      },
    }));

    const { loginWithLine, getCustomerId, setSessionToken } = await import("../src/liff");

    const identity = await loginWithLine();
    expect(identity).toEqual({ customerId: MEMBER_ID, lineUserId: "U_1" });
    expect(getCustomerId()).toBe(MEMBER_ID);

    // Clearing the session must also clear the persisted customer id (guest fallback).
    setSessionToken(null);
    expect(getCustomerId()).toBeNull();
  });
});
