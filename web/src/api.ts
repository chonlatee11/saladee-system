// Eden Treaty client (D-09). Importing the api `App` type binds this web client to
// the server contract — any api route change becomes a COMPILE error here, not a
// runtime bug. The type import is erased at build, so the api bundle is never
// pulled into the LIFF SPA.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";

const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:3000";

/** Eden Treaty client — `treaty<App>()` binds the web client to the api contract. */
export const api = treaty<App>(API_URL);

/** One typed call to the api `/health` route (D-09). Returns the status string. */
export async function getHealth(): Promise<string> {
  const { data, error } = await api.health.get();
  if (error) throw new Error(`health check failed (status ${error.status})`);
  return data.status;
}
