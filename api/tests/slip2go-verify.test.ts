// PAY-02 — the Slip2Go adapter (default verifier) maps a (mocked) HTTP response
// onto the SlipVerifyResult union: clean vs rejected(wrong_amount|wrong_payee|
// duplicate|not_a_slip) vs unavailable (vendor down/quota/date-mismatch → D-04
// awaiting-review). Every Slip2Go logical outcome is HTTP 200 with a String `code`.
// The api secret is env-only and NEVER logged/bodied (Phase-0 D-15). The HTTP layer
// is mocked via an injected fetch so no live Slip2Go account is required.
import { describe, expect, it } from "bun:test";
import { Slip2GoAdapter } from "../src/services/slip-verify/slip2go.adapter";

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Adapter with an injected fetch stub + fixed test credentials (no env dependency).
const adapter = (fetchImpl: typeof fetch) =>
  new Slip2GoAdapter({ apiSecret: "secret-key", payeeId: "0812345678", fetchImpl });

// A fetch stub returning a fixed response (and recording the request for assertions).
function stubFetch(res: Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("slip2go adapter (PAY-02)", () => {
  it("maps 200200 (valid) to { status: 'clean', transRef, amountSatang }", async () => {
    const { fn } = stubFetch(
      jsonRes(200, { code: "200200", message: "Slip is Valid", data: { transRef: "TX-CLEAN-1", amount: 70 } }),
    );
    const r = await adapter(fn).verify({ image: new Uint8Array([1, 2, 3]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("clean");
    if (r.status === "clean") {
      expect(r.transRef).toBe("TX-CLEAN-1");
      expect(r.amountSatang).toBe(7000);
      expect(r.payeeOk).toBe(true);
    }
  });

  it("treats 200000 (slip found) as clean and reads a string amount", async () => {
    const { fn } = stubFetch(
      jsonRes(200, { code: "200000", message: "Slip found", data: { transRef: "TX-FOUND", amount: "70.00" } }),
    );
    const r = await adapter(fn).verify({ qrPayload: "0044...", expectedAmountSatang: 7000 });
    expect(r.status).toBe("clean");
    if (r.status === "clean") expect(r.transRef).toBe("TX-FOUND");
  });

  it("re-checks the satang ourselves: a mismatched returned amount → rejected wrong_amount (D-03)", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200200", data: { transRef: "TX-2", amount: 50 } }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("wrong_amount");
  });

  it("maps 200402 (amount not match) → rejected wrong_amount", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200402", message: "Transfer Amount Not Match" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("wrong_amount");
  });

  it("maps 200401 (recipient not match) → rejected wrong_payee", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200401", message: "Recipient Account Not Match" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("wrong_payee");
  });

  it("maps 200501 (duplicated) → rejected duplicate", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200501", message: "Slip is Duplicated" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("duplicate");
  });

  it("maps 200404 (slip not found in bank) → rejected not_a_slip", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200404", message: "Slip Not Found" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("not_a_slip");
  });

  it("maps 200403 (date not match) → unavailable (we don't gate on date; money-safe review)", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "200403", message: "Transfer Date Not Match" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("unavailable");
  });

  it("maps an unknown code → unavailable (never a hard reject)", async () => {
    const { fn } = stubFetch(jsonRes(200, { code: "299999", message: "who knows" }));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("unavailable");
  });

  it("maps a network error → unavailable (→ awaiting-review, D-04)", async () => {
    const { fn } = stubFetch(new Error("ECONNREFUSED"));
    const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
    expect(r.status).toBe("unavailable");
  });

  it("maps 401 (bad secret) / 429 (quota) / 5xx → unavailable, never a reject", async () => {
    for (const status of [401, 429, 500, 503]) {
      const { fn } = stubFetch(jsonRes(status, { message: "nope" }));
      const r = await adapter(fn).verify({ image: new Uint8Array([1]), expectedAmountSatang: 7000 });
      expect(r.status).toBe("unavailable");
    }
  });

  it("sends the secret as Authorization: Bearer to the qr-code endpoint, never in the body", async () => {
    const { fn, calls } = stubFetch(jsonRes(200, { code: "200200", data: { transRef: "TX", amount: 70 } }));
    await adapter(fn).verify({ qrPayload: "0044...", expectedAmountSatang: 7000 });
    const call = calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.url).toBe("https://connect.slip2go.com/api/verify-slip/qr-code/info");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-key");
    expect(String(call.init?.body ?? "")).not.toContain("secret-key");
  });

  it("uses the qr-image endpoint (multipart) when an image is supplied", async () => {
    const { fn, calls } = stubFetch(jsonRes(200, { code: "200200", data: { transRef: "TX", amount: 70 } }));
    await adapter(fn).verify({ image: new Uint8Array([9]), expectedAmountSatang: 7000 });
    expect(calls[0]?.url).toBe("https://connect.slip2go.com/api/verify-slip/qr-image/info");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
  });
});
