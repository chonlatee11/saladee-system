// CatalogView render test (02-05). Mounts CatalogView with a MOCKED catalog loader
// and server-renders it (vue/server-renderer — DOM-free, so it runs under `bun test`
// with no happy-dom dependency). Asserts the three post-load states the UI-SPEC
// requires: has-items (variety name renders), the "หมดรอบนี้" sold-out badge, and the
// "รอบขายปิดชั่วคราว" no-open-round empty state. The loading state is delivered by the
// App.vue <Suspense> fallback (the async-view shell pattern) and is not exercised here.
//
// The loader is injected via a prop (never a module mock), so this test cannot leak
// state into the sibling eden-types test — mirrors the 02-02 "no module mocking" rule.
import { describe, expect, it } from "bun:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import CatalogView from "../src/views/CatalogView.vue";

interface Loader {
  (): Promise<{ data: unknown; error: unknown }>;
}

async function renderCatalog(loader: Loader): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "catalog", component: CatalogView },
      { path: "/variety/:id", name: "variety", component: { template: "<div/>" } },
      { path: "/subscription", name: "subscription", component: { template: "<div/>" } },
      { path: "/b2b", name: "b2b", component: { template: "<div/>" } },
    ],
  });
  const app = createSSRApp(CatalogView, { loader });
  app.use(router);
  await router.push("/");
  await router.isReady();
  return renderToString(app);
}

function variety(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "กรีนโอ๊ค",
    imageUrl: null,
    rounds: [
      {
        roundId: "22222222-2222-2222-2222-222222222222",
        soldOut: false,
        prices: { b2c: { packs: [{ saleUnitId: "33333333-3333-3333-3333-333333333333", label: "ถุง 100 ก.", unitPriceSatang: 3500 }] } },
      },
    ],
    ...over,
  };
}

describe("CatalogView (02-05, LINE-02)", () => {
  it("renders the open round's varieties with a ฿ price (has-items)", async () => {
    const html = await renderCatalog(async () => ({
      data: { varieties: [variety()], boxes: [] },
      error: null,
    }));
    expect(html).toContain("กรีนโอ๊ค");
    expect(html).toContain("฿35");
  });

  it("shows the 'หมดรอบนี้' sold-out badge for a depleted round", async () => {
    const soldOutVariety = variety({
      name: "เรดโครอล",
      rounds: [
        {
          roundId: "22222222-2222-2222-2222-222222222222",
          soldOut: true,
          prices: { b2c: { packs: [{ saleUnitId: "44444444-4444-4444-4444-444444444444", label: "ถุง 100 ก.", unitPriceSatang: 3500 }] } },
        },
      ],
    });
    const html = await renderCatalog(async () => ({
      data: { varieties: [soldOutVariety], boxes: [] },
      error: null,
    }));
    expect(html).toContain("หมดรอบนี้");
  });

  it("shows the 'รอบขายปิดชั่วคราว' empty state when no round is open", async () => {
    const html = await renderCatalog(async () => ({
      data: { varieties: [], boxes: [] },
      error: null,
    }));
    expect(html).toContain("รอบขายปิดชั่วคราว");
  });

  it("shows the error state when the catalog read fails", async () => {
    const html = await renderCatalog(async () => ({ data: null, error: { status: 500 } }));
    expect(html).toContain("เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง");
  });

  // 03-14 (UAT gap test 6): member quick-links must be reachable from the catalog
  // in EVERY state — /subscription (SALE-03) and /b2b (CUST-02).
  it("renders the /subscription and /b2b quick-links in the has-items state", async () => {
    const html = await renderCatalog(async () => ({
      data: { varieties: [variety()], boxes: [] },
      error: null,
    }));
    expect(html).toContain('href="/subscription"');
    expect(html).toContain('href="/b2b"');
    expect(html).toContain("สมาชิกกล่องผัก");
    expect(html).toContain("ลูกค้าขายส่ง (B2B)");
  });

  it("renders the /subscription and /b2b quick-links in the empty state too", async () => {
    const html = await renderCatalog(async () => ({
      data: { varieties: [], boxes: [] },
      error: null,
    }));
    expect(html).toContain('href="/subscription"');
    expect(html).toContain('href="/b2b"');
  });
});
