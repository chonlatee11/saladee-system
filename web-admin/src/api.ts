// Eden Treaty client (D-17). Importing the api `App` type binds this web-admin
// client to the server contract — any api route change becomes a COMPILE error
// here, not a runtime bug. The type import is erased at build, so the api bundle
// is never pulled into the back-office SPA.
import { treaty } from "@elysiajs/eden";
import type { App } from "../../api/src/index";

const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:3000";

/** Eden Treaty client — `treaty<App>()` binds the web-admin client to the api contract. */
export const api = treaty<App>(API_URL);
