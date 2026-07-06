// OrderHistoryView + reorder render/logic test (02-09, CUST-04 / D-19/D-20). Mounts
// OrderHistoryView with an INJECTED session token + catalog/history loader and
// server-renders it (vue/server-renderer — DOM-free, runs under `bun test`). Asserts
// the member-only states the UI-SPEC requires: guest login gate, member list with the
// "สั่งซ้ำ" reorder action, and the empty state. Separately unit-tests the reorder →
// cart hand-off (applyReorderToCart) to prove a reorder loads the proposed cart and
// surfaces the D-20 unavailable warning.
//
// Loaders are injected via props (never a module mock), so this test cannot leak into
// sibling tests — mirrors the 02-02/02-05 "no module mocking" rule.
import { describe, expect, it } from "bun:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import OrderHistoryView from "../src/views/OrderHistoryView.vue";
import {
  applyReorderToCart,
  REORDER_UNAVAILABLE_MESSAGE,
  type ReorderResponse,
} from "../src/lib/reorder";
import { useCart } from "../src/stores/cart";

interface HistoryProps {
  sessionToken?: string | null;
  loader?: () => Promise<{ data: unknown; error: unknown }>;
}

async function renderHistory(props: HistoryProps): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "catalog", component: { template: "<div/>" } },
      { path: "/orders", name: "orders", component: OrderHistoryView },
      { path: "/orders/:id", name: "order-detail", component: { template: "<div/>" } },
      { path: "/checkout", name: "checkout", component: { template: "<div/>" } },
    ],
  });
  const app = createSSRApp(OrderHistoryView, props as Record<string, unknown>);
  app.use(router);
  await router.push("/orders");
  await router.isReady();
  return renderToString(app);
}

function order(over: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    status: "awaiting_payment",
    tier: "b2c",
    totalSatang: 7000,
    createdAt: "2026-07-04T00:00:00Z",
    ...over,
  };
}

describe("OrderHistoryView (02-09, CUST-04 / D-19)", () => {
  it("shows the guest login gate when there is no session (D-19)", async () => {
    const html = await renderHistory({ sessionToken: null });
    expect(html).toContain("เข้าสู่ระบบเพื่อดูประวัติ");
    expect(html).toContain("เข้าสู่ระบบด้วย LINE");
  });

  it("lists a member's orders with a reorder action", async () => {
    const html = await renderHistory({
      sessionToken: "member-token",
      loader: async () => ({ data: { orders: [order()] }, error: null }),
    });
    expect(html).toContain("สั่งซ้ำ"); // reorder CTA
    expect(html).toContain("รอชำระเงิน"); // awaiting_payment badge
    expect(html).toContain("฿70"); // total display
  });

  it("shows the empty state for a member with no orders", async () => {
    const html = await renderHistory({
      sessionToken: "member-token",
      loader: async () => ({ data: { orders: [] }, error: null }),
    });
    expect(html).toContain("ยังไม่มีคำสั่งซื้อ");
  });

  it("shows the error state when the history read fails", async () => {
    const html = await renderHistory({
      sessionToken: "member-token",
      loader: async () => ({ data: null, error: { status: 500 } }),
    });
    expect(html).toContain("เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง");
  });
});

describe("reorder → cart hand-off (D-20)", () => {
  it("loads the proposed re-priced cart and surfaces the unavailable flag", () => {
    const cart = useCart();
    cart.clear();
    const res: ReorderResponse = {
      cart: {
        lines: [
          {
            roundId: "22222222-2222-2222-2222-222222222222",
            varietyId: "11111111-1111-1111-1111-111111111111",
            saleUnitId: "33333333-3333-3333-3333-333333333333",
            qty: 2,
          },
        ],
        boxLines: [],
      },
      hasUnavailable: true, // one item sold-out/absent this round
    };
    const { message } = applyReorderToCart(res, cart);
    // The available line was loaded into the cart (ids + qty only).
    expect(cart.lines.value.length).toBe(1);
    expect(cart.lines.value[0]?.qty).toBe(2);
    // The D-20 warning is surfaced for the customer to confirm before paying.
    expect(message).toBe(REORDER_UNAVAILABLE_MESSAGE);
    cart.clear();
  });

  it("returns no warning when every item is available", () => {
    const cart = useCart();
    cart.clear();
    const res: ReorderResponse = {
      cart: {
        lines: [
          {
            roundId: "22222222-2222-2222-2222-222222222222",
            varietyId: "11111111-1111-1111-1111-111111111111",
            saleUnitId: "33333333-3333-3333-3333-333333333333",
            qty: 1,
          },
        ],
        boxLines: [],
      },
      hasUnavailable: false,
    };
    const { message } = applyReorderToCart(res, cart);
    expect(cart.lines.value.length).toBe(1);
    expect(message).toBeNull();
    cart.clear();
  });
});
