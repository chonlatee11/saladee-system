// Saladee LIFF SPA entry (thin Phase-0 scaffold — real storefront UI is Phase 2).
//
// D-09 proof: import the api `App` type and build an Eden Treaty client, so any
// api route change becomes a compile error here. A single typed `/health` GET is
// performed; the wrong path or method would fail to type-check.
//
// The DOM bootstrap is guarded behind a `document` check so this module can be
// imported by `bun test` (no DOM, no network) — the LIFF init is also guarded on
// a configured id so the build never requires a live LIFF id.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";

const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:3000";

// Eden Treaty client — `treaty<App>()` binds the web client to the api contract.
export const api = treaty<App>(API_URL);

/** One typed call to the api `/health` route (D-09). Returns the status string. */
export async function getHealth(): Promise<string> {
  const { data, error } = await api.health.get();
  if (error) throw new Error(`health check failed (status ${error.status})`);
  return data.status;
}

/**
 * Guarded LIFF init: only initialises when VITE_LIFF_ID is configured, so the
 * static build/test never require a live LIFF id. `@line/liff` is imported
 * dynamically to keep browser globals out of the module's top level.
 */
export async function initLiff(): Promise<void> {
  const liffId = import.meta.env?.VITE_LIFF_ID;
  if (!liffId) return;
  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });
}

async function bootstrap(): Promise<void> {
  const { createApp, h, ref } = await import("vue");
  const status = ref("checking…");

  await initLiff();
  getHealth()
    .then((s) => {
      status.value = s;
    })
    .catch((err: unknown) => {
      status.value = `unreachable: ${(err as Error).message}`;
    });

  createApp({
    render: () => h("main", { class: "p-4 text-center" }, `Saladee API health: ${status.value}`),
  }).mount("#app");
}

// Browser-only bootstrap: skipped under `bun test` where `document` is undefined.
if (typeof document !== "undefined") {
  void bootstrap();
}
