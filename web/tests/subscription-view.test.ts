// SubscriptionSignup + SubscriptionManage render/logic tests (03-08, SALE-03 / D-12
// / D-14). Server-renders each view (vue/server-renderer — DOM-free, runs under `bun
// test`) with an INJECTED session token + loader, asserting the UI-SPEC states: guest
// gate, the package/frequency picker, already-a-member, the active manage view with
// pause/skip/cancel, the after-cut-off locked notice, and the not-a-member empty.
//
// Loaders/actions are injected via props (never a module mock), mirroring the 02-09
// order-history test — so these cannot leak into sibling tests.
import { describe, expect, it } from "bun:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import SubscriptionSignup from "../src/views/SubscriptionSignup.vue";
import SubscriptionManage from "../src/views/SubscriptionManage.vue";
import { useSubscription } from "../src/stores/subscription";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "catalog", component: { template: "<div/>" } },
      { path: "/subscription", name: "subscription", component: { template: "<div/>" } },
      { path: "/subscription/manage", name: "subscription-manage", component: { template: "<div/>" } },
    ],
  });
}

async function render(
  view: unknown,
  path: string,
  props: Record<string, unknown>,
): Promise<string> {
  const router = makeRouter();
  const app = createSSRApp(view as never, props);
  app.use(router);
  await router.push(path);
  await router.isReady();
  return renderToString(app);
}

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    packageCode: "M",
    packageValueSatang: 50000,
    frequency: "weekly",
    status: "active",
    ...over,
  };
}

describe("SubscriptionSignup (SALE-03 / D-12)", () => {
  it("shows the guest login gate when there is no session", async () => {
    const html = await render(SubscriptionSignup, "/subscription", { sessionToken: null });
    expect(html).toContain("เข้าสู่ระบบเพื่อสมัครสมาชิก");
    expect(html).toContain("เข้าสู่ระบบด้วย LINE");
  });

  it("shows the package + frequency picker for a member with no subscription", async () => {
    const html = await render(SubscriptionSignup, "/subscription", {
      sessionToken: "member-token",
      loader: async () => ({ data: { subscriptions: [], nextRound: null }, error: null }),
    });
    expect(html).toContain("เลือกแพ็กเกจ");
    expect(html).toContain("กล่องกลาง (M)");
    expect(html).toContain("ยืนยันแพ็กเกจ"); // confirm CTA
    expect(html).toContain("ทุก 2 สัปดาห์"); // biweekly frequency tile
  });

  // 03-14 (UAT gap test 6): the chosen package must be unmistakable — accent ring
  // + filled ✓ badge, replicating the approved DeliveryMethodTiles pattern. The
  // store is a module singleton, so we preselect via the real store and clear after.
  it("marks the selected package tile with the accent ring + ✓ badge", async () => {
    const store = useSubscription();
    store.selectPackage("M");
    try {
      const html = await render(SubscriptionSignup, "/subscription", {
        sessionToken: "member-token",
        loader: async () => ({ data: { subscriptions: [], nextRound: null }, error: null }),
      });
      expect(html).toContain("ring-accent");
      expect(html).toContain("✓");
      // Exactly ONE tile is pressed (only the package was selected — frequency
      // tiles all render aria-pressed="false").
      const pressed = html.match(/aria-pressed="true"/g) ?? [];
      expect(pressed.length).toBe(1);
    } finally {
      store.clear();
    }
  });

  it("routes an existing member to manage instead of re-signing up", async () => {
    const html = await render(SubscriptionSignup, "/subscription", {
      sessionToken: "member-token",
      loader: async () => ({ data: { subscriptions: [sub()], nextRound: null }, error: null }),
    });
    expect(html).toContain("คุณเป็นสมาชิกกล่องผักอยู่แล้ว");
    expect(html).toContain("จัดการสมาชิก");
  });
});

describe("SubscriptionManage (D-14)", () => {
  it("shows the guest login gate when there is no session", async () => {
    const html = await render(SubscriptionManage, "/subscription/manage", { sessionToken: null });
    expect(html).toContain("เข้าสู่ระบบเพื่อจัดการสมาชิก");
  });

  it("shows the active box with pause / skip / cancel before cut-off", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const html = await render(SubscriptionManage, "/subscription/manage", {
      sessionToken: "member-token",
      loader: async () => ({
        data: {
          subscriptions: [sub()],
          nextRound: { id: "r1", name: "รอบ 5 ก.ค.", cutoffAt: future, deliveryDate: null },
        },
        error: null,
      }),
    });
    expect(html).toContain("แพ็กเกจ M");
    expect(html).toContain("หยุดชั่วคราว");
    expect(html).toContain("ข้ามรอบนี้");
    expect(html).toContain("ยกเลิกสมาชิก");
    // Before cut-off there is no locked notice.
    expect(html).not.toContain("รอบนี้เลยเวลาปรับแล้ว");
  });

  it("shows the after-cut-off locked notice once the cut-off has passed (D-14)", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const html = await render(SubscriptionManage, "/subscription/manage", {
      sessionToken: "member-token",
      loader: async () => ({
        data: {
          subscriptions: [sub()],
          nextRound: { id: "r1", name: "รอบ 5 ก.ค.", cutoffAt: past, deliveryDate: null },
        },
        error: null,
      }),
    });
    expect(html).toContain("รอบนี้เลยเวลาปรับแล้ว");
    expect(html).toContain("การหยุด/ข้าม/ยกเลิกจะมีผลกับรอบถัดไป");
  });

  it("shows the not-a-member empty state when the member has no active box", async () => {
    const html = await render(SubscriptionManage, "/subscription/manage", {
      sessionToken: "member-token",
      loader: async () => ({
        data: { subscriptions: [sub({ status: "cancelled" })], nextRound: null },
        error: null,
      }),
    });
    expect(html).toContain("ยังไม่ได้สมัครกล่องผัก");
    expect(html).toContain("สมัครสมาชิกกล่องผัก");
  });
});
