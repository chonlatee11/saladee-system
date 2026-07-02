// RBAC-ready identity schema (D-07: owner/admin/grower/packer).
// Source: orm.drizzle.team pg-core (RESEARCH "RBAC schema scaffold").
// This is the durable identity table every later phase builds on. The role
// pgEnum is created as a first-class PostgreSQL type, so migration #0000 both
// CREATEs the type and the table (and the down SQL must DROP both).
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "admin", "grower", "packer"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // Bun.password Argon2id output
    role: roleEnum("role").notNull().default("packer"),
    lineUserId: text("line_user_id"), // set when a staff member links LINE
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);
