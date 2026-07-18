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
  ผักรอบนี้: "menu",
  ราคาผักรอบนี้: "price",
  สั่งผักรอบนี้: "stock",
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
    title: "ผักรอบนี้ 🥬",
    body: "ดูรายชื่อผักสลัดที่เปิดขายรอบนี้และสั่งได้เลยในแอป",
    cta: "ดูเมนู",
    path: "",
  },
  price: {
    title: "ราคาผักรอบนี้ 💰",
    body: "ดูราคาต่อชนิดของรอบนี้ (ราคาส่งเฉพาะบัญชี B2B ที่อนุมัติแล้ว)",
    cta: "ดูทั้งหมด",
    path: "prices",
  },
  // "สั่งผักรอบนี้" → open the catalog to order (path=""); no longer the low-stock card.
  stock: {
    title: "สั่งผักรอบนี้ 🛒",
    body: "เลือกผักสลัดรอบนี้ ใส่ตะกร้า แล้วสั่งได้เลยในแอป",
    cta: "สั่งเลย",
    path: "",
  },
};

// Fallback for unmatched input (03-UI-SPEC §Chatbot fallback row).
const FALLBACK_TEXT = 'พิมพ์ "ผักรอบนี้", "ราคาผักรอบนี้" หรือ "สั่งผักรอบนี้" เพื่อดูข้อมูล หรือกดเมนูด้านล่างเพื่อสั่งซื้อ';

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
          {
            type: "text",
            text: copy.title,
            weight: "bold",
            size: "lg",
            color: "#3a7d20",
            wrap: true,
          },
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

// ── Guided order bot (LINE-04 / D-19) ────────────────────────────────────────
// A RULE-BASED (no NLU, no LLM) postback state machine. The step is encoded ENTIRELY
// in the postback `data` (stateless-per-message), so the bot never stores server-side
// conversation state. Each non-terminal step replies with a Flex bubble whose footer
// button carries a POSTBACK advancing to the next step; the terminal step replies with
// a URI button that deep-links into LIFF to pay (D-20). The bot NEVER emits a price or
// amount — money is handled entirely by the existing LIFF checkout.
type BotStep = "start" | "browse" | "confirm";

// Postback data → step. `order_start` enters the flow (e.g. a rich-menu / quick-reply
// button); the intermediate steps are advanced by the previous step's footer button.
const POSTBACK_TO_STEP: Record<string, BotStep> = {
  order_start: "start",
  "order_step=browse": "browse",
  "order_step=confirm": "confirm",
};

// Per-step copy. `next` (postback data) advances the flow; a terminal step sets
// `path` (the LIFF checkout deep-link) instead. NO amounts anywhere (D-20).
const BOT_STEP_COPY: Record<
  BotStep,
  { title: string; body: string; cta: string; next?: string; path?: string }
> = {
  start: {
    title: "สั่งผักรอบนี้ 🛒",
    body: "เริ่มสั่งผักสลัดรอบนี้กันเลย! กดถัดไปเพื่อเลือกผักที่ต้องการ",
    cta: "เลือกผัก",
    next: "order_step=browse",
  },
  browse: {
    title: "เลือกผักของคุณ 🥬",
    body: "เลือกผักสลัดที่ต้องการใส่ตะกร้า แล้วไปหน้าถัดไปเพื่อเปิดแอปสั่งซื้อ",
    cta: "ไปหน้าสั่งซื้อ",
    next: "order_step=confirm",
  },
  confirm: {
    title: "เปิดแอปเพื่อสั่งซื้อ 📱",
    body: "แตะปุ่มด้านล่างเพื่อเปิดแอป เลือกจำนวน และสั่งซื้อให้เสร็จในที่เดียว",
    cta: "เปิดแอปสั่งซื้อ",
    path: "", // terminal: deep-link to the LIFF catalog/checkout (no money here)
  },
};

/**
 * Build a bot-step Flex bubble. A non-terminal step's footer button is a POSTBACK
 * advancing the flow; the terminal step's button is a URI deep-link into LIFF (D-20).
 */
export function buildBotFlex(step: BotStep): messagingApi.FlexMessage {
  const copy = BOT_STEP_COPY[step];
  const action: messagingApi.Action =
    copy.next != null
      ? { type: "postback", label: copy.cta, data: copy.next, displayText: copy.cta }
      : { type: "uri", label: copy.cta, uri: `https://liff.line.me/${LIFF_ID}/${copy.path ?? ""}` };
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
          {
            type: "text",
            text: copy.title,
            weight: "bold",
            size: "lg",
            color: "#3a7d20",
            wrap: true,
          },
          { type: "text", text: copy.body, size: "sm", color: "#555555", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "button", style: "primary", color: "#3a7d20", action }],
      },
    },
  };
}

/** Resolve an order-intent postback to its bot-step reply, or null if not in the flow. */
function resolveBotStep(event: LineEvent): messagingApi.Message[] | null {
  if (event.type === "postback" && event.postback?.data) {
    const step = POSTBACK_TO_STEP[event.postback.data];
    if (step) return [buildBotFlex(step)];
  }
  return null;
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

      // Order-intent postbacks drive the guided bot state machine (LINE-04 / D-19),
      // which takes priority; anything else falls through to the canned card (D-25) or
      // the fallback text. The bot deep-links to LIFF to pay and never handles money.
      const botMessages = resolveBotStep(event);
      const key = botMessages ? null : resolveCanned(event);
      const messages =
        botMessages ??
        (key ? [buildCannedFlex(key)] : [{ type: "text" as const, text: FALLBACK_TEXT }]);
      await line.client.replyMessage({ replyToken: event.replyToken, messages });
    }

    return "ok";
  });
