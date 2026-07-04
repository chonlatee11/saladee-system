// Composed Elysia application. Importing `env` FIRST runs boot-time env
// validation (fail-fast) before anything else. The composition order below is
// FIXED by plan 00-01 — wave-2 slices fill the plugin/route stub bodies only and
// must NOT reorder or edit this file. EXCEPTION (gap-closure 00-08): `cors` is
// intentionally composed as the FIRST plugin, before every route, so it handles
// OPTIONS preflight and stamps Access-Control-Allow-Origin before any route runs.
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./env";
import { log } from "./lib/logger";
import { authPlugin } from "./plugins/auth.plugin";
import { dbPlugin } from "./plugins/db.plugin";
import { linePlugin } from "./plugins/line.plugin";
import { storagePlugin } from "./plugins/storage.plugin";
import { authRoutes } from "./routes/auth";
import { boxesRoutes } from "./routes/boxes";
import { catalogRoutes } from "./routes/catalog";
import { filesRoutes } from "./routes/files";
import { healthRoutes } from "./routes/health";
import { ordersRoutes } from "./routes/orders";
import { pricesRoutes } from "./routes/prices";
import { roundsRoutes } from "./routes/rounds";
import { stockRoutes } from "./routes/stock";
import { varietiesRoutes } from "./routes/varieties";
import { webhookRoutes } from "./routes/webhook";

// The un-listened app: importable in tests (app.handle) without binding a port.
export const app = new Elysia()
  // cors FIRST (before routes): env-driven explicit allowlist — never a reflected
  // wildcard with credentials (threat T-00-25). Handles OPTIONS preflight too.
  .use(
    cors({
      origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use(dbPlugin)
  .use(storagePlugin)
  .use(linePlugin)
  .use(authPlugin)
  .use(healthRoutes)
  .use(webhookRoutes)
  .use(filesRoutes)
  .use(authRoutes)
  .use(ordersRoutes)
  .use(varietiesRoutes)
  .use(roundsRoutes)
  .use(pricesRoutes)
  .use(catalogRoutes)
  .use(stockRoutes)
  .use(boxesRoutes);

// Eden Treaty contract consumed by web/ (compile-time-safe API calls).
export type App = typeof app;

// Bind the port only when run as the entry point (not when imported by tests).
if (import.meta.main) {
  app.listen(Number(env.PORT), (server) => {
    log.info("listening", { port: server.port, env: env.NODE_ENV });
  });
}
