-- Hand-written reverse of 0001_commerce.sql (Pitfall 3: drizzle-kit emits no down).
-- Drop children before parents (FK order), then the pgEnum types last.
-- IF EXISTS keeps the down idempotent so up→down→up leaves no residue.
-- (DROP TABLE also removes that table's CHECK constraints, indexes, and FKs.)
DROP TABLE IF EXISTS "back_in_stock_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "box_components";--> statement-breakpoint
DROP TABLE IF EXISTS "order_lines";--> statement-breakpoint
DROP TABLE IF EXISTS "customer_addresses";--> statement-breakpoint
DROP TABLE IF EXISTS "orders";--> statement-breakpoint
DROP TABLE IF EXISTS "boxes";--> statement-breakpoint
DROP TABLE IF EXISTS "prices";--> statement-breakpoint
DROP TABLE IF EXISTS "round_stock";--> statement-breakpoint
DROP TABLE IF EXISTS "rounds";--> statement-breakpoint
DROP TABLE IF EXISTS "sale_units";--> statement-breakpoint
DROP TABLE IF EXISTS "customers";--> statement-breakpoint
DROP TABLE IF EXISTS "varieties";--> statement-breakpoint
DROP TYPE IF EXISTS "tier";--> statement-breakpoint
DROP TYPE IF EXISTS "order_status";--> statement-breakpoint
DROP TYPE IF EXISTS "substitution_policy";--> statement-breakpoint
DROP TYPE IF EXISTS "unit_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "round_status";
