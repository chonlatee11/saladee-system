// Saladee LIFF SPA entry. The Eden client (api.ts) and LIFF wiring (liff.ts) are
// split into their own modules; this file only bootstraps the Vue app + router in
// the browser. The DOM bootstrap is guarded behind a `document` check so the
// module can be imported by `bun test` (no DOM, no network).
//
// `api` and `getHealth` are re-exported here so the existing Eden type-sharing
// test (web/tests/eden-types.test.ts, D-09) keeps its import path.
export { api, getHealth } from "./api";

async function bootstrap(): Promise<void> {
  // Global design tokens + Sarabun; imported inside bootstrap so `bun test`
  // importing this module never has to resolve the CSS asset.
  await import("./style.css");
  const { createApp } = await import("vue");
  const { router } = await import("./router");
  const App = (await import("./App.vue")).default;
  const { initLiff } = await import("./liff");

  // Guarded LIFF init (no-op without VITE_LIFF_ID) — the guest path still works.
  await initLiff();

  createApp(App).use(router).mount("#app");
}

// Browser-only bootstrap: skipped under `bun test` where `document` is undefined.
if (typeof document !== "undefined") {
  void bootstrap();
}
