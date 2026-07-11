// MKT-02 / D-25 — canned LINE chatbot router on the EXISTING /webhook route.
//
// The keyword/postback router replies with a Flex card + a LIFF deep-link button
// for "ผักรอบนี้" / "ราคาผักรอบนี้" / "สั่งผักรอบนี้"; anything else gets a fallback text
// (NO NLU, NO in-chat order state). CRITICALLY the raw-bytes-first signature check
// (Pitfall 1 / T-03-32) is unchanged: a forged or absent x-line-signature is still
// rejected with 401 BEFORE the router ever runs. We sign a NON-ASCII Thai payload
// over the exact raw JSON string — if the handler ever parsed the body before
// validating, the HMAC would break, which is the whole point.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { messagingApi } from "@line/bot-sdk";
import { Elysia } from "elysia";
import { webhookRoutes } from "../src/routes/webhook";

const CHANNEL_SECRET = "test-line-channel-secret";

function sign(rawBody: string): string {
  return createHmac("sha256", CHANNEL_SECRET).update(rawBody).digest("base64");
}

const app = new Elysia().use(webhookRoutes);

let replySpy: ReturnType<typeof spyOn>;
beforeAll(() => {
  replySpy = spyOn(messagingApi.MessagingApiClient.prototype, "replyMessage");
  replySpy.mockResolvedValue({} as never);
});
afterAll(() => {
  replySpy.mockRestore();
});

function post(headers: Record<string, string>, body: string): Promise<Response> {
  return app.handle(new Request("http://localhost/webhook", { method: "POST", headers, body }));
}

/** Send a single text-message event with a valid signature and return the reply arg. */
async function sendText(text: string) {
  replySpy.mockClear();
  const body = JSON.stringify({
    events: [{ type: "message", replyToken: "tok-1", message: { type: "text", text } }],
  });
  const res = await post(
    { "content-type": "application/json", "x-line-signature": sign(body) },
    body,
  );
  const arg = replySpy.mock.calls.at(0)?.at(0) as
    | { replyToken: string; messages: Array<Record<string, unknown>> }
    | undefined;
  return { res, arg };
}

/** Pull the footer uri button's uri out of a Flex bubble (for the deep-link assert). */
function deepLinkOf(flex: Record<string, unknown>): string | undefined {
  const contents = flex.contents as { footer?: { contents?: Array<{ action?: { uri?: string } }> } };
  return contents?.footer?.contents?.[0]?.action?.uri;
}

describe("canned chatbot router — keyword → Flex + LIFF deep-link (MKT-02/D-25)", () => {
  test('"ผักรอบนี้" → a Flex card whose footer button deep-links into LIFF', async () => {
    const { res, arg } = await sendText("ผักรอบนี้");
    expect(res.status).toBe(200);
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    expect(deepLinkOf(msg)).toContain("https://liff.line.me/");
  });

  test('"ราคาผักรอบนี้" → Flex + deep-link', async () => {
    const { arg } = await sendText("ราคาผักรอบนี้");
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    expect(deepLinkOf(msg)).toContain("https://liff.line.me/");
  });

  test('"สั่งผักรอบนี้" → Flex + deep-link', async () => {
    const { arg } = await sendText("สั่งผักรอบนี้");
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    expect(deepLinkOf(msg)).toContain("https://liff.line.me/");
  });

  test("unmatched text → a plain fallback text message (no NLU, no order state)", async () => {
    const { res, arg } = await sendText("อยากได้ผักหน่อยครับ");
    expect(res.status).toBe(200);
    const msg = arg?.messages.at(0) as { type: string; text?: string };
    expect(msg?.type).toBe("text");
    expect(msg?.text).toContain("ผักรอบนี้");
  });

  test("postback data routes to a Flex card too", async () => {
    replySpy.mockClear();
    const body = JSON.stringify({
      events: [{ type: "postback", replyToken: "tok-2", postback: { data: "menu_round" } }],
    });
    const res = await post(
      { "content-type": "application/json", "x-line-signature": sign(body) },
      body,
    );
    expect(res.status).toBe(200);
    const arg = replySpy.mock.calls.at(0)?.at(0) as
      | { messages: Array<Record<string, unknown>> }
      | undefined;
    expect(arg?.messages.at(0)?.type).toBe("flex");
  });
});

describe("signature trust boundary is UNCHANGED (Pitfall 1 / T-03-32)", () => {
  test("valid signature over a Thai payload → 200", async () => {
    const { res } = await sendText("สวัสดีจากสวนสลัด");
    expect(res.status).toBe(200);
  });

  test("wrong signature → 401 and the router never runs (no reply)", async () => {
    replySpy.mockClear();
    const body = JSON.stringify({ events: [] });
    const res = await post(
      { "content-type": "application/json", "x-line-signature": "not-a-valid-signature" },
      body,
    );
    expect(res.status).toBe(401);
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("absent x-line-signature header → 401", async () => {
    replySpy.mockClear();
    const body = JSON.stringify({ events: [] });
    const res = await post({ "content-type": "application/json" }, body);
    expect(res.status).toBe(401);
    expect(replySpy).not.toHaveBeenCalled();
  });
});
