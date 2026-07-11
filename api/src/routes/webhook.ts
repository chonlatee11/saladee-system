// POST /webhook — the LINE inbound trust boundary (D-06, threats T-00-12/13).
//
// Pitfall 1: capture the RAW request bytes (`request.text()`) BEFORE any JSON.parse
// and validate `x-line-signature` (HMAC-SHA256 over those exact bytes). Attaching a
// TypeBox body schema here would make Elysia parse the body first, consuming the
// stream and destroying the raw bytes — signature validation would then fail on
// real LINE traffic (especially Thai/non-ASCII text). So this route has NO schema.
import { type messagingApi, validateSignature } from "@line/bot-sdk";
import { Elysia } from "elysia";
import { log } from "../lib/logger";
import { linePlugin } from "../plugins/line.plugin";
// Side-effect import: registers the milestone Flex notifier into the shared
// applyTransition() seam at boot (ORD-04), WITHOUT editing index.ts. webhook.ts is
// already composed in the app, so this guarantees the notifier is live in the
// running server; under NODE_ENV=test the notifier is a no-op (no live push).
import "../services/notify";

// Minimal shape of the LINE webhook payload the canned router acts on.
interface LineTextMessage {
  type: string;
  text?: string;
}
interface LinePostback {
  data?: string;
}
interface LineEvent {
  type: string;
  replyToken?: string;
  message?: LineTextMessage;
  postback?: LinePostback;
}
interface LineWebhookBody {
  events?: LineEvent[];
}

// ── Canned chatbot router (MKT-02 / D-25) ────────────────────────────────────
// A fixed keyword/postback → Flex map. NO NLU, NO in-chat order state: the card is
// canned copy + a LIFF deep-link button that opens the mini-app where the live data
// (menu / prices / low-stock) and the actual ordering happen. Deep links mirror
// notify.ts (https://liff.line.me/${LIFF_ID}/...); LIFF_ID is a NON-secret build id.
const LIFF_ID = process.env.LIFF_ID ?? process.env.VITE_LIFF_ID ?? "";

type CannedKey = "menu" | "price" | "stock";

// Thai keyword (exact text) → canned card. Copy per 03-UI-SPEC §Chatbot.
const KEYWORD_TO_KEY: Record<string, CannedKey> = {
  เมนูรอบนี้: "menu",
  ราคาวันนี้: "price",
  ของเหลือ: "stock",
};

// Rich-menu / quick-reply postback data → the same cards.
const POSTBACK_TO_KEY: Record<string, CannedKey> = {
  menu_round: "menu",
  price_today: "price",
  stock_left: "stock",
};

// Per-card copy: title, body, CTA label, and the LIFF path the button opens.
const CANNED_COPY: Record<CannedKey, { title: string; body: string; cta: string; path: string }> = {
  menu: {
    title: "เมนูรอบนี้ 🥬",
    body: "ดูรายชื่อผักสลัดที่เปิดขายรอบนี้และสั่งได้เลยในแอป",
    cta: "สั่งเลย",
    path: "",
  },
  price: {
    title: "ราคาวันนี้ 💰",
    body: "ดูราคาต่อชนิดของวันนี้ (ราคาส่งเฉพาะบัญชี B2B ที่อนุมัติแล้ว)",
    cta: "ดูทั้งหมด",
    path: "prices",
  },
  stock: {
    title: "ของเหลือรอบนี้ ⏳",
    body: "เช็กชนิดที่ใกล้หมด/หมดแล้วรอบนี้ แล้วสั่งก่อนหมด",
    cta: "สั่งก่อนหมด",
    path: "?filter=low",
  },
};

// Fallback for unmatched input (03-UI-SPEC §Chatbot fallback row).
const FALLBACK_TEXT =
  'พิมพ์ "เมนูรอบนี้", "ราคาวันนี้" หรือ "ของเหลือ" เพื่อดูข้อมูล หรือกดเมนูด้านล่างเพื่อสั่งซื้อ';

/** Build a canned Flex bubble with a footer LIFF deep-link button (like buildOrderFlex). */
export function buildCannedFlex(key: CannedKey): messagingApi.FlexMessage {
  const copy = CANNED_COPY[key];
  const deepLink = `https://liff.line.me/${LIFF_ID}/${copy.path}`;
  return {
    type: "flex",
    altText: copy.title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: copy.title, weight: "bold", size: "lg", color: "#3a7d20", wrap: true },
          { type: "text", text: copy.body, size: "sm", color: "#555555", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#3a7d20",
            action: { type: "uri", label: copy.cta, uri: deepLink },
          },
        ],
      },
    },
  };
}

/** Resolve a webhook event to its canned card key, or null for unmatched input. */
function resolveCanned(event: LineEvent): CannedKey | null {
  if (event.type === "message" && event.message?.type === "text" && event.message.text) {
    return KEYWORD_TO_KEY[event.message.text.trim()] ?? null;
  }
  if (event.type === "postback" && event.postback?.data) {
    return POSTBACK_TO_KEY[event.postback.data] ?? null;
  }
  return null;
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

    // (4) Only now is it safe to parse and act on the payload. Route each event
    // through the canned chatbot (D-25): a matched keyword/postback → Flex card
    // with a LIFF deep-link; anything else → a fallback text. No NLU, no order state.
    const body = JSON.parse(raw) as LineWebhookBody;
    for (const event of body.events ?? []) {
      if (!event.replyToken) continue;
      // Only reply to text messages / postbacks; ignore other event kinds silently.
      if (event.type !== "message" && event.type !== "postback") continue;
      if (event.type === "message" && event.message?.type !== "text") continue;

      const key = resolveCanned(event);
      const messages = key
        ? [buildCannedFlex(key)]
        : [{ type: "text" as const, text: FALLBACK_TEXT }];
      await line.client.replyMessage({ replyToken: event.replyToken, messages });
    }

    return "ok";
  });
