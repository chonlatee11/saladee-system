-- Hand-written reverse of 0004_phase3.sql (Pitfall 3: drizzle-kit emits no down).
-- Drop children before parents, indexes before their tables, columns before the
-- pgEnum types they use, and the pgEnum types LAST (a column still typed
-- `b2b_status`/`subscription_status` blocks DROP TYPE). IF EXISTS everywhere keeps
-- the down idempotent so up→down→up leaves no residue.
-- (DROP TABLE also removes that table's indexes and FK constraints; the explicit
--  DROP INDEX lines below mirror the 0003 idiom and stay safe via IF EXISTS.)
DROP INDEX IF EXISTS "subscription_skips_sub_round_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_orders_sub_round_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "harvest_logs_batch_idx";--> statement-breakpoint
-- Child tables first (they FK into the parents dropped just below).
DROP TABLE IF EXISTS "harvest_logs";--> statement-breakpoint
DROP TABLE IF EXISTS "planting_mix_items";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_orders";--> statement-breakpoint
DROP TABLE IF EXISTS "subscription_skips";--> statement-breakpoint
DROP TABLE IF EXISTS "standing_order_items";--> statement-breakpoint
-- Parent / leaf tables.
DROP TABLE IF EXISTS "planting_batches";--> statement-breakpoint
DROP TABLE IF EXISTS "planting_mix_templates";--> statement-breakpoint
DROP TABLE IF EXISTS "subscriptions";--> statement-breakpoint
DROP TABLE IF EXISTS "standing_orders";--> statement-breakpoint
DROP TABLE IF EXISTS "quota_overflow_flags";--> statement-breakpoint
DROP TABLE IF EXISTS "settings";--> statement-breakpoint
-- Added columns (drop b2b_status column BEFORE the b2b_status type below).
ALTER TABLE "customers" DROP COLUMN IF EXISTS "b2b_status";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN IF EXISTS "credit_terms";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN IF EXISTS "b2b_approved_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "packed_at";--> statement-breakpoint
ALTER TABLE "round_stock" DROP COLUMN IF EXISTS "is_manual_override";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "days_to_harvest";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "survival_pct";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "harvest_window_days";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "shelf_life_days";--> statement-breakpoint
-- pgEnum types LAST (all columns typed by them are gone above).
DROP TYPE IF EXISTS "subscription_status";--> statement-breakpoint
DROP TYPE IF EXISTS "b2b_status";
