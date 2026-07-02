// STUB — filled by 00-02 (postgres.js pooled + drizzle, /health/ready DB ping).
// Wave-2 replaces the body of THIS file only; it must NOT edit index.ts.
// The named Elysia instance + export symbol are the fixed contract.
import { Elysia } from "elysia";

export const dbPlugin = new Elysia({ name: "db" });
