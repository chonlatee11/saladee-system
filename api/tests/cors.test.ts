import { describe, expect, test } from "bun:test";
import { app } from "../src/index";

// CORS regression coverage for UAT Test 8: the browser (Cloudflare Pages origin)
// makes a cross-origin Eden Treaty fetch to /health. Without CORS the browser
// blocks it (no Access-Control-Allow-Origin + OPTIONS preflight 404). These tests
// drive the composed app via app.handle — no DB needed (only /health liveness).
const PAGES_ORIGIN = "https://saladee-web.pages.dev";
const EVIL_ORIGIN = "https://evil.example";

describe("CORS on /health (UAT Test 8)", () => {
  test("GET /health reflects an allowed Origin in access-control-allow-origin", async () => {
    const res = await app.handle(
      new Request("http://localhost/health", {
        headers: { Origin: PAGES_ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  test("OPTIONS /health preflight is answered (204/200) with allow-methods", async () => {
    const res = await app.handle(
      new Request("http://localhost/health", {
        method: "OPTIONS",
        headers: {
          Origin: PAGES_ORIGIN,
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-methods")).toBeTruthy();
  });

  test("a disallowed Origin is NOT reflected (allowlist, not wildcard)", async () => {
    const res = await app.handle(
      new Request("http://localhost/health", {
        headers: { Origin: EVIL_ORIGIN },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).not.toBe(EVIL_ORIGIN);
  });

  test("/health still returns 200 { status: 'ok' } (no regression)", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
