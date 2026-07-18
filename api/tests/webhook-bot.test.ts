// LINE-04 — the guided order bot on the EXISTING /webhook route. A rule-based
// (NO-LLM, D-19) postback state machine advances the customer through quick-reply
// steps and, at the terminal step, deep-links to LIFF to pay (D-20). The bot NEVER
// handles money — it gathers intent then hands off to the existing LIFF checkout.
//
// CRITICALLY the raw-bytes-first signature check (Pitfall 1 / T-04-19) is unchanged:
// a forged or absent x-line-signature is still rejected with 401 BEFORE the bot ever
// runs. We sign NON-ASCII Thai payloads over the exact raw JSON string.
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

/** Send a single postback event with a valid signature and return the reply arg. */
async function sendPostback(data: string) {
  replySpy.mockClear();
  const body = JSON.stringify({
    events: [{ type: "postback", replyToken: "tok-1", postback: { data } }],
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

/** Send a text message with a valid signature and return the reply arg. */
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
    | { messages: Array<{ type: string; text?: string }> }
    | undefined;
  return { res, arg };
}

/** The single footer button of a Flex bubble (its action carries the transition). */
function footerButton(flex: Record<string, unknown>): { type: string; data?: string; uri?: string } {
  const contents = flex.contents as { footer?: { contents?: Array<{ action?: Record<string, unknown> }> } };
  return (contents?.footer?.contents?.[0]?.action ?? {}) as { type: string; data?: string; uri?: string };
}

describe("guided order bot — rule-based postback state machine (LINE-04 / D-19)", () => {
  test("order_start → a Flex step whose button advances to the next step (postback)", async () => {
    const { res, arg } = await sendPostback("order_start");
    expect(res.status).toBe(200);
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    const btn = footerButton(msg);
    expect(btn.type).toBe("postback"); // advances, does not yet deep-link
    expect(btn.data).toBe("order_step=browse");
  });

  test("order_step=browse → advances to the confirm step (postback)", async () => {
    const { arg } = await sendPostback("order_step=browse");
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    const btn = footerButton(msg);
    expect(btn.type).toBe("postback");
    expect(btn.data).toBe("order_step=confirm");
  });

  test("order_step=confirm → TERMINAL: deep-links to LIFF to pay (D-20)", async () => {
    const { arg } = await sendPostback("order_step=confirm");
    const msg = arg?.messages.at(0) as Record<string, unknown>;
    expect(msg?.type).toBe("flex");
    const btn = footerButton(msg);
    expect(btn.type).toBe("uri"); // hands off to LIFF checkout
    expect(btn.uri).toContain("https://liff.line.me/");
  });

  test("the bot NEVER emits a money/price message (D-20 — LIFF handles payment)", async () => {
    for (const data of ["order_start", "order_step=browse", "order_step=confirm"]) {
      const { arg } = await sendPostback(data);
      const serialized = JSON.stringify(arg?.messages ?? []);
      expect(serialized).not.toContain("฿");
      expect(serialized).not.toContain("บาท");
    }
  });

  test("an unrecognized message falls back to the existing canned reply", async () => {
    const { res, arg } = await sendText("อยากได้ผักหน่อยครับ");
    expect(res.status).toBe(200);
    const msg = arg?.messages.at(0);
    expect(msg?.type).toBe("text");
    expect(msg?.text).toContain("ผักรอบนี้");
  });
});

describe("signature trust boundary is UNCHANGED (Pitfall 1 / T-04-19)", () => {
  test("valid signature over a Thai payload → 200", async () => {
    const { res } = await sendText("สวัสดีจากสวนสลัด");
    expect(res.status).toBe(200);
  });

  test("wrong signature → 401 and the bot never runs (no reply)", async () => {
    replySpy.mockClear();
    const body = JSON.stringify({
      events: [{ type: "postback", replyToken: "tok-x", postback: { data: "order_start" } }],
    });
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
