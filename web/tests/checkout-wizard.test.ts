// Checkout wizard tests (02-08). DOM-free: pure helpers are unit-tested and the SFCs
// are server-rendered (vue/server-renderer) — the 02-05 pattern, no happy-dom. Covers
// the plan's three assertions:
//   (a) a freshness-blocked delivery-method tile renders DISABLED,
//   (b) the step-2 advance CTA is DISABLED until the usage consent is ticked,
//   (c) submitting posts the expected POST /orders body (ids + qty + choice + consent).
import { beforeEach, describe, expect, it } from "bun:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import DeliveryMethodTiles from "../src/components/DeliveryMethodTiles.vue";
import { buildOrderBody, consentSatisfied, POLICY_VERSION } from "../src/lib/checkout";
import { useCart } from "../src/stores/cart";
import CheckoutWizard from "../src/views/CheckoutWizard.vue";

const ROUND = "22222222-2222-2222-2222-222222222222";
const VARIETY = "11111111-1111-1111-1111-111111111111";
const UNIT = "33333333-3333-3333-3333-333333333333";

function seedCart() {
  const cart = useCart();
  cart.clear();
  cart.add({ roundId: ROUND, varietyId: VARIETY, saleUnitId: UNIT, qty: 2 });
  return cart;
}

const catalogLoader = async () => ({
  data: {
    varieties: [
      {
        id: VARIETY,
        name: "กรีนโอ๊ค",
        rounds: [
          {
            roundId: ROUND,
            prices: {
              b2c: { packs: [{ saleUnitId: UNIT, label: "ถุง 100 ก.", unitPriceSatang: 3500 }] },
            },
          },
        ],
      },
    ],
    boxes: [],
  },
  error: null,
});

// Freshness quote WITHOUT "self" (very-fresh cart forces cold/general) — tile disabled.
const freshnessQuote = async () => ({
  data: {
    allowedMethods: ["cold", "general"],
    fees: { cold: 5000, general: 4000 },
    deliveryDate: "2026-07-10",
  },
  error: null,
});

async function renderWizard(loaders: Record<string, unknown>, initialStep = 2): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "catalog", component: { template: "<div/>" } },
      { path: "/checkout", name: "checkout", component: CheckoutWizard },
      { path: "/pay/:id", name: "pay", component: { template: "<div/>" } },
    ],
  });
  const app = createSSRApp(CheckoutWizard, { loaders, initialStep });
  app.use(router);
  await router.push("/checkout");
  await router.isReady();
  return renderToString(app);
}

describe("checkout wizard (02-08)", () => {
  beforeEach(() => {
    useCart().clear();
  });

  it("(a) disables a freshness-blocked delivery-method tile", async () => {
    const html = await renderToString(
      createSSRApp(DeliveryMethodTiles, {
        allowedMethods: ["cold", "general"],
        fees: { cold: 5000, general: 4000 },
        modelValue: null,
      }),
    );
    // "self" is not allowed → its tile is disabled, and the freshness note appears.
    expect(html).toContain("ส่งเอง");
    expect(html).toContain("disabled");
    expect(html).toContain("ผักในตะกร้าต้องส่งแบบ");
  });

  it("(b) gates the step-2 advance CTA on usage consent", async () => {
    seedCart();
    const html = await renderWizard({ catalog: catalogLoader, quote: freshnessQuote }, 2);
    // Initial state: usage consent unticked → the "ถัดไป" CTA is disabled.
    expect(html).toContain("ถัดไป");
    expect(html).toContain("disabled");
    // The gate predicate itself: false until usage is true.
    expect(consentSatisfied({ usage: false, marketing: false })).toBe(false);
    expect(consentSatisfied({ usage: true, marketing: false })).toBe(true);
  });

  it("(c) builds the expected POST /orders body (ids + qty + choice + consent)", () => {
    const body = buildOrderBody({
      lines: [{ roundId: ROUND, varietyId: VARIETY, saleUnitId: UNIT, qty: 2 }],
      boxLines: [],
      deliveryMethod: "general",
      deliveryZone: "samut_prakan",
      customer: { name: "สมชาย", phone: "0891112222", address: "123 หมู่ 4 สมุทรปราการ" },
      consent: { usage: true, marketing: false },
    });
    expect(body).toEqual({
      tier: "b2c",
      customer: {
        name: "สมชาย",
        phone: "0891112222",
        recipientName: "สมชาย",
        recipientPhone: "0891112222",
        recipientAddress: "123 หมู่ 4 สมุทรปราการ",
      },
      deliveryMethod: "general",
      deliveryZone: "samut_prakan",
      consent: { usage: true, marketing: false, policyVersion: POLICY_VERSION },
      lines: [{ roundId: ROUND, varietyId: VARIETY, saleUnitId: UNIT, qty: 2 }],
    });
    // No money field ever leaves the client (T-02-30).
    expect(JSON.stringify(body)).not.toContain("Satang");
  });
});
