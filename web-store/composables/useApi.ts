// Eden Treaty composable (D-09) — the store's typed client against the EXISTING
// api. Importing the api `App` type binds this store to the server contract: any
// api route change becomes a COMPILE error here, not a runtime bug. The type import
// is erased at build, so the api bundle is never pulled into the store output.
//
// Mirrors web/src/api.ts (the LIFF client) — same treaty<App>() shape, only the
// base URL source differs (Nuxt runtimeConfig.public.apiUrl instead of Vite env).
// No new endpoint is added; the store consumes only existing public routes.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";

/** Eden Treaty client bound to the api contract, using the runtime API base URL. */
export function useApi() {
  const config = useRuntimeConfig();
  return treaty<App>(config.public.apiUrl as string);
}
