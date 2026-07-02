-- Hand-written reverse of 0000_init.sql (Pitfall 3: drizzle-kit emits no down).
-- Exact reverse DDL, dropped in dependency order (table first, then its enum type).
-- IF EXISTS keeps the down idempotent so up→down→up leaves no residue.
DROP TABLE IF EXISTS "users";--> statement-breakpoint
DROP TYPE IF EXISTS "role";
