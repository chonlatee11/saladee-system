// DB plugin — decorates the Elysia context with the drizzle `db` instance so
// routes/handlers resolve it from context instead of importing the client
// directly. The named instance ("db") + `dbPlugin` export symbol are the fixed
// contract from 00-01; only this body is filled by 00-02. Must NOT edit index.ts.
import { Elysia } from "elysia";
import { db } from "../db/client";

export const dbPlugin = new Elysia({ name: "db" }).decorate("db", db);
