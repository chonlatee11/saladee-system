// PAY-02 — the SlipOK adapter maps a (mocked) HTTP response onto the
// SlipVerifyResult union: clean vs rejected(wrong_amount|wrong_payee|duplicate|
// not_a_slip) vs unavailable (API down/quota → D-04 awaiting-review). The API key
// is read from env only and NEVER logged (Phase-0 D-15). The HTTP layer is mocked
// via an injected fetch so no live SlipOK branch/credential is required.
import { describe, expect, it } from "bun:test";
import { SlipOkAdapter } from "../src/services/slip-verify/slipok.adapter";

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Build an adapter with an injected fetch stub + fixed test credentials.
const adapter = (fetchImpl: typeof fetch) =>
  new SlipOkAdapter({ branchId: "branch-1", apiKey: "secret-key", fetchImpl });

// A fetch stub that returns a fixed response (and records the request for assertions).
function stubFetch(res: Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("slip-verify adapter (PAY-02)", () => {
  it("maps a matching slip response to { status: 'clean', transRef, amountSatang }", async () => {
    const { fn } = stubFetch(
      jsonRes(200, {
        success: true,
        data: { transRef: "TX-CLEAN-1", amount: 70, receiver: { account: { value: "x" } } },
      }),
    );
    const r = await adapter(fn).verify({ image: new Uint8Array([1, 2, 3]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("clean");
    if (r.status === "clean") {
      expect(r.transRef).toBe("TX-CLEAN-1");
      expect(r.amountSatang).toBe(7000);
      expect(r.payeeOk).toBe(true);
    }
  });

  it("accepts a flat (non-nested) success body and reads amount as a string", async () => {
    const { fn } = stubFetch(jsonRes(200, { success: true, transRef: "TX-FLAT", amount: "70.00" }));
    const r = await adapter(fn).verify({ qrPayload: "0044...", expectedAmountSatang: 7000 });
    expect(r.status).toBe("clean");
    if (r.status === "clean") expect(r.transRef).toBe("TX-FLAT");
  });

  it("maps a mismatched amount to { status: 'rejected', reason: 'wrong_amount' } (our satang compare, D-03)", async () => {
    const { fn } = stubFetch(jsonRes(200, { success: true, data: { transRef: "TX-2", amount: 50 } }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("wrong_amount");
  });

  it("maps a wrong-payee error code to { status: 'rejected', reason: 'wrong_payee' }", async () => {
    const { fn } = stubFetch(jsonRes(400, { success: false, code: 1015, message: "receiver mismatch" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("wrong_payee");
  });

  it("maps a duplicate error code to { status: 'rejected', reason: 'duplicate' }", async () => {
    const { fn } = stubFetch(jsonRes(400, { success: false, code: 1012, message: "slip ซ้ำ" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("duplicate");
  });

  it("maps an invalid-slip error code to { status: 'rejected', reason: 'not_a_slip' }", async () => {
    const { fn } = stubFetch(jsonRes(400, { success: false, code: 1002, message: "invalid slip" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("not_a_slip");
  });

  it("maps a network error to { status: 'unavailable' } (→ awaiting-review, D-04)", async () => {
    const { fn } = stubFetch(new Error("ECONNREFUSED"));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("unavailable");
  });

  it("maps a quota / 5xx response to { status: 'unavailable' } (never a hard reject)", async () => {
    const quota = stubFetch(jsonRes(400, { success: false, code: 1013, message: "quota exceeded" }));
    expect((await adapter(quota.fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 })).status).toBe(
      "unavailable",
    );
    const boom = stubFetch(jsonRes(500, { message: "server error" }));
    expect((await adapter(boom.fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 })).status).toBe(
      "unavailable",
    );
  });

  it("sends the api key in the x-authorization header (env-only) to the branch URL, never in the body", async () => {
    const { fn, calls } = stubFetch(jsonRes(200, { success: true, data: { transRef: "TX", amount: 70 } }));
    await adapter(fn).verify({ image: new Uint8Array([9]), expectedAmountSatang: 7000 });
    const [call] = calls;
    expect(call.url).toBe("https://api.slipok.com/api/line/apikey/branch-1");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("x-authorization")).toBe("secret-key");
    // The body (FormData) must never carry the key.
    expect(JSON.stringify(call.init?.body ?? "")).not.toContain("secret-key");
  });
});
