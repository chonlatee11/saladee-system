// POST /webhook — the LINE inbound trust boundary (D-06, threats T-00-12/13).
//
// Pitfall 1: capture the RAW request bytes (`request.text()`) BEFORE any JSON.parse
// and validate `x-line-signature` (HMAC-SHA256 over those exact bytes). Attaching a
// TypeBox body schema here would make Elysia parse the body first, consuming the
// stream and destroying the raw bytes — signature validation would then fail on
// real LINE traffic (especially Thai/non-ASCII text). So this route has NO schema.
import { validateSignature } from "@line/bot-sdk";
import { Elysia } from "elysia";
import { log } from "../lib/logger";
import { linePlugin } from "../plugins/line.plugin";

// Minimal shape of the LINE webhook payload we act on (echo of text messages).
interface LineTextMessage {
  type: string;
  text?: string;
}
interface LineEvent {
  type: string;
  replyToken?: string;
  message?: LineTextMessage;
}
interface LineWebhookBody {
  events?: LineEvent[];
}

// `.use(linePlugin)` gives the handler typed access to `line` (client + secret).
// linePlugin is named "line", so Elysia dedupes it with index.ts's composition.
export const webhookRoutes = new Elysia()
  .use(linePlugin)
  .post("/webhook", async ({ request, line, set }) => {
    // (1) RAW bytes FIRST — before any parse (Pitfall 1 / T-00-13).
    const raw = await request.text();

    // (2) Signature header, then (3) constant-time HMAC check over the raw body.
    // Reject forged OR absent signatures with 401 (T-00-12). Never log the secret.
    const signature = request.headers.get("x-line-signature");
    if (!signature || !validateSignature(raw, line.channelSecret, signature)) {
      log.warn("webhook rejected: invalid or missing signature");
      set.status = 401;
      return "invalid signature";
    }

    // (4) Only now is it safe to parse and act on the payload.
    const body = JSON.parse(raw) as LineWebhookBody;
    for (const event of body.events ?? []) {
      if (event.type === "message" && event.message?.type === "text" && event.replyToken) {
        await line.client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: event.message.text ?? "" }],
        });
      }
    }

    return "ok";
  });
