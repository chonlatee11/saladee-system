// ORD-04 / D-21/22/23 — milestone Flex notifications. Two layers:
//  (1) pushOrderUpdate targets ONLY a member (line_user_id); a guest is skipped.
//  (2) wired into the shared applyTransition() seam, a MILESTONE transition pushes
//      exactly once and a NON-milestone transition pushes nothing. The line client
//      is mocked so no network call happens and the token is never used.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { makeOrdersRoutes } from "../src/routes/orders";
import { buildOrderFlex, type LinePush, pushOrderUpdate } from "../src/services/notify";
import {
  applyTransition,
  type OrderNotifyData,
  registerOrderNotifier,
} from "../src/services/order-transition";
import { seedSellableLine } from "./seed";

const memberOrder: OrderNotifyData = {
  id: "11111111-2222-3333-4444-555555555555",
  status: "paid",
  lineUserId: "U_member_123",
  subtotalSatang: 5000,
  deliveryFeeSatang: 2000,
  totalSatang: 7000,
};
const guestOrder: OrderNotifyData = { ...memberOrder, lineUserId: null };

function mockLine(): { line: LinePush; pushMessage: ReturnType<typeof mock> } {
  const pushMessage = mock(async () => ({}));
  return { line: { client: { pushMessage } }, pushMessage };
}

describe("pushOrderUpdate — members only (D-23)", () => {
  test("a member (line_user_id) receives exactly one Flex push", async () => {
    const { line, pushMessage } = mockLine();
    const sent = await pushOrderUpdate(line, memberOrder, "paid");

    expect(sent).toBe(true);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    const arg = pushMessage.mock.calls.at(0)?.at(0) as {
      to: string;
      messages: { type: string }[];
    };
    expect(arg.to).toBe("U_member_123");
    expect(arg.messages[0]?.type).toBe("flex"); // Flex, not plain text (D-22)
  });

  test("a guest (no line_user_id) is skipped silently — zero pushes", async () => {
    const { line, pushMessage } = mockLine();
    const sent = await pushOrderUpdate(line, guestOrder, "paid");

    expect(sent).toBe(false);
    expect(pushMessage).toHaveBeenCalledTimes(0);
  });

  test("buildOrderFlex carries a deep-link button into the LIFF order page", () => {
    const flex = buildOrderFlex(memberOrder, "paid");
    const footer = (flex.contents as { footer: { contents: unknown[] } }).footer;
    const button = footer.contents[0] as { action: { type: string; uri: string; label: string } };
    expect(button.action.type).toBe("uri");
    expect(button.action.uri).toContain(`/orders/${memberOrder.id}`);
    expect(button.action.label).toBe("ดูคำสั่งซื้อ");
  });
});

// ── Wiring: the push fires from applyTransition, on milestones only ────────────
const TEST_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let routes: ReturnType<typeof makeOrdersRoutes>;
let pushMessage: ReturnType<typeof mock>;

/** Place an order and mark its customer a member (give it a line_user_id). */
async function placeMemberOrder() {
  const seed = await seedSellableLine(db, { quotaPlants: 100, plantsPerUnit: 2 });
  const res = await routes.handle(
    new Request("http://localhost/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tier: "b2c",
        customer: {
          name: "สมาชิก",
          phone: "0800000000",
          recipientName: "ผู้รับ",
          recipientPhone: "0800000000",
          recipientAddress: "1 ถนนสลัด",
        },
        lines: [
          { roundId: seed.roundId, varietyId: seed.varietyId, saleUnitId: seed.saleUnitId, qty: 1 },
        ],
      }),
    }),
  );
  const { id } = (await res.json()) as { id: string };
  await db.execute(
    sql`UPDATE customers SET line_user_id = 'U_member_wired' WHERE id = (SELECT customer_id FROM orders WHERE id = ${id})`,
  );
  return id;
}

/** Flush the fire-and-forget notifier microtask + its async push. */
async function flush() {
  await new Promise((r) => setTimeout(r, 20));
}

beforeAll(async () => {
  client = postgres(TEST_URL, { prepare: false, max: 4 });
  db = drizzle(client, { schema });
  routes = makeOrdersRoutes(db);
  await client.file("drizzle/0003_payments_delivery_consent.down.sql").catch(() => {});
  await client.file("drizzle/0001_commerce.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.down.sql").catch(() => {});
  await client.file("drizzle/0000_init.sql");
  await client.file("drizzle/0001_commerce.sql");
  await client.file("drizzle/0003_payments_delivery_consent.sql");

  // Override the boot notifier with one that drives our mocked line client.
  pushMessage = mock(async () => ({}));
  registerOrderNotifier((order, milestone) => {
    void pushOrderUpdate({ client: { pushMessage } }, order, milestone);
  });
});

afterAll(async () => {
  registerOrderNotifier(null); // don't leak the mock into other files
  await client?.end();
});

describe("milestone notify wired into applyTransition (ORD-04)", () => {
  test("a milestone transition (awaiting_payment → paid) pushes exactly one card", async () => {
    const orderId = await placeMemberOrder();
    await db.execute(sql`UPDATE orders SET status = 'awaiting_payment' WHERE id = ${orderId}`);
    pushMessage.mockClear();

    await db.transaction((tx) => applyTransition(tx, orderId, "paid"));
    await flush();

    expect(pushMessage).toHaveBeenCalledTimes(1);
    const arg = pushMessage.mock.calls.at(0)?.at(0) as { to: string };
    expect(arg.to).toBe("U_member_wired");
  });

  test("a non-milestone transition (created → awaiting_payment) pushes nothing", async () => {
    const orderId = await placeMemberOrder();
    pushMessage.mockClear();

    await db.transaction((tx) => applyTransition(tx, orderId, "awaiting_payment"));
    await flush();

    expect(pushMessage).toHaveBeenCalledTimes(0);
  });
});
