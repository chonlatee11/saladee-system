// B2bAccount render/logic test (03-08, CUST-02 / CUST-05 · D-08/D-09). Server-renders
// B2bAccount (vue/server-renderer — DOM-free) with an INJECTED session token +
// account/catalog/standing/price loaders, asserting the UI-SPEC B2B states: guest
// gate, not-applied apply CTA, pending-approval gate, rejected, and the approved view
// with wholesale prices + the "ตั้งออเดอร์ประจำ" standing-order CTA.
//
// Loaders/actions are injected via props (never a module mock) — no cross-test leak.
import { describe, expect, it } from "bun:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import B2bAccount from "../src/views/B2bAccount.vue";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "catalog", component: { template: "<div/>" } },
      { path: "/b2b", name: "b2b", component: B2bAccount },
    ],
  });
}

async function render(props: Record<string, unknown>): Promise<string> {
  const router = makeRouter();
  const app = createSSRApp(B2bAccount, props);
  app.use(router);
  await router.push("/b2b");
  await router.isReady();
  return renderToString(app);
}

const account = (status: "pending" | "approved" | "rejected" | null) => async () => ({
  data: { b2bStatus: status, creditTerms: null },
  error: null,
});

describe("B2bAccount (CUST-02 / D-08)", () => {
  it("shows the guest login gate when there is no session", async () => {
    const html = await render({ sessionToken: null });
    expect(html).toContain("เข้าสู่ระบบเพื่อใช้บัญชี B2B");
  });

  it("shows the apply CTA for a customer who has not applied (b2bStatus null)", async () => {
    const html = await render({ sessionToken: "t", loaders: { account: account(null) } });
    expect(html).toContain("สมัครบัญชี B2B");
  });

  it("shows the pending-approval gate (D-08)", async () => {
    const html = await render({ sessionToken: "t", loaders: { account: account("pending") } });
    expect(html).toContain("บัญชี B2B กำลังรอการอนุมัติ");
    // A pending account NEVER sees the approved wholesale-price section (T-03-21).
    // (The gate BODY copy mentions ราคาส่ง/ออเดอร์ประจำ as a promise, so we key on
    // the approved-only section heading + the plants-per-round input instead.)
    expect(html).not.toContain("ราคาส่งรอบนี้");
    expect(html).not.toContain("ออเดอร์ประจำ (ต้น/รอบ)");
  });

  it("shows the rejected notice", async () => {
    const html = await render({ sessionToken: "t", loaders: { account: account("rejected") } });
    expect(html).toContain("คำขอบัญชี B2B ไม่ได้รับการอนุมัติ");
  });

  it("shows wholesale prices + the standing-order CTA once approved (D-09)", async () => {
    const html = await render({
      sessionToken: "t",
      loaders: {
        account: account("approved"),
        catalog: async () => ({
          data: {
            varieties: [{ id: "v1", name: "กรีนโอ๊ค", rounds: [{ roundId: "r1" }] }],
          },
          error: null,
        }),
        standing: async () => ({ data: { standingOrders: [] }, error: null }),
        price: async () => ({ data: { pricePerKgSatang: 15000 }, error: null }),
      },
    });
    expect(html).toContain("ราคาส่งรอบนี้");
    expect(html).toContain("กรีนโอ๊ค");
    expect(html).toContain("฿150/กก."); // gated wholesale price surfaced
    expect(html).toContain("ตั้งออเดอร์ประจำ"); // standing CTA
  });
});
