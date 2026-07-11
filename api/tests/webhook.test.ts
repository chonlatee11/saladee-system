// POST /webhook signature trust boundary — Criterion 4 / D-06, threats T-00-12/13.
//
// Pitfall 1 guard: the valid case signs a payload containing NON-ASCII Thai text
// and computes the HMAC over the exact raw JSON string. If the handler ever parses
// the body before validating (e.g. a TypeBox schema re-serializes it), the raw
// bytes change and this test fails — which is the whole point.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import { messagingApi } from "@line/bot-sdk";
import { Elysia } from "elysia";
import { webhookRoutes } from "../src/routes/webhook";

// Mirrors api/.env.test (auto-loaded by `bun test`, NODE_ENV=test). The webhook
// validates against line.channelSecret, which the plugin reads from this env var.
const CHANNEL_SECRET = "test-line-channel-secret";

/** base64(HMAC-SHA256(rawBody, CHANNEL_SECRET)) — exactly what LINE sends. */
function sign(rawBody: string): string {
  return createHmac("sha256", CHANNEL_SECRET).update(rawBody).digest("base64");
}

const app = new Elysia().use(webhookRoutes);

// Spy on the reply API so no network call happens and we can assert the echo.
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

describe("POST /webhook — raw-body signature validation + canned reply", () => {
  // The raw-bytes-first signature path is UNCHANGED (Pitfall 1). What changed in
  // 03-12 is the post-validation reply: the placeholder echo is replaced by the
  // canned chatbot router (D-25). An unmatched keyword now yields a fallback text —
  // exhaustive canned/keyword coverage lives in chatbot-router.test.ts; here we only
  // re-assert the signature boundary still admits a valid Thai-payload request.
  test("valid signature over a Thai payload → 200 and a reply is sent", async () => {
    replySpy.mockClear();
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "reply-token-abc",
          message: { type: "text", text: "สวัสดีจากสวนสลัด" },
        },
      ],
    });

    const res = await post(
      { "content-type": "application/json", "x-line-signature": sign(body) },
      body,
    );

    expect(res.status).toBe(200);
    expect(replySpy).toHaveBeenCalledTimes(1);
    const arg = replySpy.mock.calls.at(0)?.at(0) as
      | { replyToken: string; messages: { type: string; text?: string }[] }
      | undefined;
    expect(arg?.replyToken).toBe("reply-token-abc");
    // Unmatched keyword → fallback text guiding the user to the canned keywords.
    expect(arg?.messages.at(0)?.text).toContain("ผักรอบนี้");
  });

  test("wrong signature → 401 and no reply is sent", async () => {
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
