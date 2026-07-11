// Saladee web-admin back-office entry. Mirrors web/src/main.ts but drops the LIFF
// init (this is a desktop staff app, not a LINE mini-app): the DOM bootstrap is
// guarded behind a `document` check so the module can be imported by `bun test`
// (no DOM, no network). TanStack Query is installed app-wide (D-18) to drive
// server state/caching for every data-dense view the slices add later.
export { api } from "./api";

async function bootstrap(): Promise<void> {
  // Global design tokens + Sarabun; imported inside bootstrap so `bun test`
  // importing this module never has to resolve the CSS asset.
  await import("./style.css");
  const { createApp } = await import("vue");
  const { VueQueryPlugin } = await import("@tanstack/vue-query");
  const { router } = await import("./router");
  const App = (await import("./App.vue")).default;

  createApp(App).use(VueQueryPlugin).use(router).mount("#app");
}

// Browser-only bootstrap: skipped under `bun test` where `document` is undefined.
if (typeof document !== "undefined") {
  void bootstrap();
}
