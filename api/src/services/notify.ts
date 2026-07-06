// Milestone Flex notifications (ORD-04 / LINE-03 / D-21/22/23). A single place
// turns an order milestone into a LINE Flex card and pushes it to the customer —
// but ONLY to a member with a line_user_id; guests are skipped silently (D-23).
//
// Wiring: this module registers a notifier into order-transition.ts at import, so
// the push fires exactly ONCE from the shared applyTransition() seam (staff PATCH,
// slip-verify, and hold-expiry all notify consistently) with NO boot-composition
// edit — the module constructs its own MessagingApiClient from env, mirroring
// line.plugin.ts. webhook.ts imports this module so registration happens at boot.
import { messagingApi } from "@line/bot-sdk";
import { env } from "../env";
import { log } from "../lib/logger";
import {
  type Milestone,
  type OrderNotifyData,
  registerOrderNotifier,
} from "./order-transition";

// The LIFF id the order deep link opens inside (frontend build var VITE_LIFF_ID).
// The API reads it from env for the push button; unset in an env yields a link
// without an id (operator sets LIFF_ID before go-live — see SUMMARY Deferred).
const LIFF_ID = process.env.LIFF_ID ?? process.env.VITE_LIFF_ID ?? "";

// Thai milestone copy (matches 02-UI-SPEC Notification copy + status-message copy).
const MILESTONE_COPY: Record<Milestone, { title: string; body: string; color: string }> = {
  paid: {
    title: "ชำระเงินสำเร็จ ✅",
    body: "เราได้รับการชำระเงินแล้ว กำลังเตรียมผักสลัดของคุณ",
    color: "#3a7d20",
  },
  shipping: {
    title: "กำลังจัดส่ง 🚚",
    body: "ร้านกำลังแพ็กและจัดส่งผักสลัดของคุณ",
    color: "#3a7d20",
  },
  done: {
    title: "จัดส่งสำเร็จ 🥬",
    body: "คำสั่งซื้อของคุณจัดส่งเรียบร้อยแล้ว ขอบคุณที่อุดหนุน",
    color: "#3a7d20",
  },
  cancelled: {
    title: "คำสั่งซื้อถูกยกเลิก",
    body: "คำสั่งซื้อนี้หมดเวลาชำระเงินและถูกยกเลิกแล้ว ผักถูกคืนสู่รอบ — สั่งใหม่ได้ทันทีหากยังต้องการ",
    color: "#9b2c2c",
  },
};

/** A minimal line-client shape (the reply/push client) — DI-friendly for tests. */
export interface LinePush {
  client: {
    pushMessage: (req: messagingApi.PushMessageRequest, xLineRetryKey?: string) => Promise<unknown>;
  };
}

function baht(satang: number): string {
  return (satang / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Build the milestone Flex bubble: an order-summary body + a footer uri button
 * ("ดูคำสั่งซื้อ") deep-linking into the LIFF order page (D-22). Flex, not plain
 * text — the card renders inside the LINE client.
 */
export function buildOrderFlex(order: OrderNotifyData, milestone: Milestone): messagingApi.FlexMessage {
  const copy = MILESTONE_COPY[milestone];
  const shortId = order.id.slice(0, 8);
  const deepLink = `https://liff.line.me/${LIFF_ID}/orders/${order.id}`;

  const summaryRow = (label: string, value: string, bold = false) => ({
    type: "box" as const,
    layout: "horizontal" as const,
    contents: [
      { type: "text" as const, text: label, size: "sm" as const, color: "#888888" },
      {
        type: "text" as const,
        text: value,
        size: "sm" as const,
        align: "end" as const,
        weight: bold ? ("bold" as const) : ("regular" as const),
        color: "#333333",
      },
    ],
  });

  return {
    type: "flex",
    altText: `${copy.title} · คำสั่งซื้อ ${shortId}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: copy.title, weight: "bold", size: "lg", color: copy.color, wrap: true },
          { type: "text", text: copy.body, size: "sm", color: "#555555", wrap: true },
          { type: "separator", margin: "md" },
          summaryRow("เลขที่คำสั่งซื้อ", shortId),
          summaryRow("ยอดรวม", `฿${baht(order.totalSatang)}`, true),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: copy.color,
            action: { type: "uri", label: "ดูคำสั่งซื้อ", uri: deepLink },
          },
        ],
      },
    },
  };
}

/**
 * Push the milestone card to the order's customer — ONLY a member with a
 * line_user_id (guests skipped silently, D-23 / T-02-28: never push to the wrong
 * user). Returns true iff a push was sent.
 */
export async function pushOrderUpdate(
  line: LinePush,
  order: OrderNotifyData,
  milestone: Milestone,
): Promise<boolean> {
  if (!order.lineUserId) return false; // guest — no LINE identity to push to
  const flex = buildOrderFlex(order, milestone);
  await line.client.pushMessage({ to: order.lineUserId, messages: [flex] });
  return true;
}

// The real push client (offline construction; only pushMessage hits the network),
// mirroring line.plugin.ts. Never logs the token (T-02-29).
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

// Register the single milestone notifier at boot. Guarded off the live LINE API
// under NODE_ENV=test so importing this module in the test suite never makes a
// real push (LINE creds are harness-locked); pushOrderUpdate stays fully testable
// via an INJECTED client. Fire-and-forget with its own error boundary.
registerOrderNotifier((order, milestone) => {
  if (env.NODE_ENV === "test") return;
  void pushOrderUpdate({ client }, order, milestone).catch((err) =>
    log.error("pushOrderUpdate failed", { orderId: order.id, error: String(err) }),
  );
});
