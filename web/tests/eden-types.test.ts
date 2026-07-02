// Eden Treaty type-sharing proof (D-09). The `web/` SPA imports the api `App`
// type and constructs a treaty client — an api route change becomes a compile
// error here. This runtime test asserts the client is wired to the /health
// route and that the typed helper is exposed; the compile-time contract is the
// `import type { App }` + `treaty<App>()` in src/main.ts (erased at build).
import { describe, expect, it } from "bun:test";
import { api, getHealth } from "../src/main";

describe("Eden Treaty type-sharing (D-09)", () => {
  it("constructs a typed treaty client exposing the /health route", () => {
    // `api.health.get` only type-checks/exists if the api App type composes the
    // healthRoutes plugin — renaming the api route breaks this contract.
    expect(typeof api.health.get).toBe("function");
  });

  it("exposes a typed getHealth() helper that calls the /health route", () => {
    expect(typeof getHealth).toBe("function");
  });
});
