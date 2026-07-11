// LIFF SPA router (02-02). EVERY customer route path is registered here up front
// and frozen — later view plans (02-05 catalog/variety/care, 02-08 checkout/pay,
// 02-09 history) only create/replace the view SFCs, never edit this file. Route
// paths match the Rich Menu deep links (provision-rich-menu.ts / D-18):
//   /  →สั่งผักรอบนี้   /prices →ราคาวันนี้   /orders →ติดตามออเดอร์
//   /contact →ติดต่อร้าน   /care →ความรู้เรื่องผัก
//
// Views are lazily imported so each screen ships as its own chunk (small LIFF
// first paint). The initial stub SFCs keep the build resolvable now; the owning
// plans overwrite them with the real screens.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "catalog", component: () => import("./views/CatalogView.vue") },
  { path: "/prices", name: "prices", component: () => import("./views/PricesView.vue") },
  {
    path: "/variety/:id",
    name: "variety",
    component: () => import("./views/VarietyDetailView.vue"),
  },
  { path: "/care", name: "care", component: () => import("./views/CareView.vue") },
  { path: "/checkout", name: "checkout", component: () => import("./views/CheckoutWizard.vue") },
  { path: "/pay/:id", name: "pay", component: () => import("./views/PayView.vue") },
  { path: "/orders", name: "orders", component: () => import("./views/OrderHistoryView.vue") },
  {
    path: "/orders/:id",
    name: "order-detail",
    component: () => import("./views/OrderDetailView.vue"),
  },
  { path: "/contact", name: "contact", component: () => import("./views/ContactView.vue") },
  // Phase-3 LIFF customer additions (03-08): subscription sign-up/manage + B2B account.
  {
    path: "/subscription",
    name: "subscription",
    component: () => import("./views/SubscriptionSignup.vue"),
  },
  {
    path: "/subscription/manage",
    name: "subscription-manage",
    component: () => import("./views/SubscriptionManage.vue"),
  },
  { path: "/b2b", name: "b2b", component: () => import("./views/B2bAccount.vue") },
  // Unknown paths fall back to the catalog (the Rich Menu entry point).
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
