-- Hand-written reverse of 0005_phase4.sql (Pitfall 3: drizzle-kit emits no down).
-- Drop indexes before their tables, child tables before parents, the orders
-- delivery_status COLUMN before the delivery_status TYPE, and the pgEnum type LAST
-- (a column still typed `delivery_status` blocks DROP TYPE). IF EXISTS everywhere
-- keeps the down idempotent so up→down→up leaves no residue.
-- (DROP TABLE also removes that table's indexes and FK constraints; the explicit
--  DROP INDEX lines below mirror the 0004 idiom and stay safe via IF EXISTS.)
DROP INDEX IF EXISTS "loyalty_ledger_order_earn_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "customer_tags_customer_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "coupons_code_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "coupon_redemptions_coupon_customer_idx";--> statement-breakpoint
-- Child tables first (they FK into coupons/customers/orders/varieties/boxes).
DROP TABLE IF EXISTS "coupon_redemptions";--> statement-breakpoint
DROP TABLE IF EXISTS "loyalty_ledger";--> statement-breakpoint
DROP TABLE IF EXISTS "customer_tags";--> statement-breakpoint
DROP TABLE IF EXISTS "variety_images";--> statement-breakpoint
DROP TABLE IF EXISTS "box_images";--> statement-breakpoint
DROP TABLE IF EXISTS "broadcasts";--> statement-breakpoint
-- Parent table (coupon_redemptions dropped above referenced it).
DROP TABLE IF EXISTS "coupons";--> statement-breakpoint
-- Added orders columns (drop delivery_status column BEFORE the type below).
ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_status";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "discount_satang";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "carrier";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_number";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_updated_at";--> statement-breakpoint
-- pgEnum type LAST (the column typed by it is gone above).
DROP TYPE IF EXISTS "delivery_status";
