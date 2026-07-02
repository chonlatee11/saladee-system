import { describe, expect, test } from "bun:test";
import { app } from "../src/index";

describe("GET /health (liveness)", () => {
  test("app module imports without throwing (boot validation passed)", () => {
    expect(app).toBeDefined();
  });

  test("responds 200 with JSON body { status: 'ok' }", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
