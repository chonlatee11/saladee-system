// Liveness endpoint (D-14). Returns 200 whenever the process is up.
// Readiness (/health/ready, DB SELECT 1) is added by 00-02 — do not add it here.
import { Elysia } from "elysia";

export const healthRoutes = new Elysia().get("/health", () => ({ status: "ok" }));
