import { afterAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { app } from "../src/index";
import { makeHealthRoutes } from "../src/routes/health";

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

// Readiness reflects REAL DB reachability. We inject a good client (ephemeral PG17)
// and a deliberately-unreachable client so both branches are proven in one process.
const EPHEMERAL_URL =
  process.env.TEST_DATABASE_URL_DIRECT ??
  "postgres://saladee_test:saladee_test@localhost:55432/saladee_test";

const goodClient = postgres(EPHEMERAL_URL, { prepare: false, max: 1 });
const goodDb = drizzle(goodClient);

// Bad port / short connect timeout → SELECT 1 throws quickly → 503.
const badClient = postgres("postgres://nobody:nobody@127.0.0.1:1/none", {
  prepare: false,
  max: 1,
  connect_timeout: 2,
});
const badDb = drizzle(badClient);

afterAll(async () => {
  await goodClient.end();
  await badClient.end({ timeout: 1 }).catch(() => {});
});

describe("GET /health/ready (readiness)", () => {
  test("returns 200 { status: 'ready' } when the DB answers SELECT 1", async () => {
    const routes = makeHealthRoutes(goodDb);
    const res = await routes.handle(new Request("http://localhost/health/ready"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  test("returns 503 { status: 'unavailable' } when the DB is unreachable", async () => {
    const routes = makeHealthRoutes(badDb);
    const res = await routes.handle(new Request("http://localhost/health/ready"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
});
