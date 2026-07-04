-- Hand-written reverse of 0003_payments_delivery_consent.sql (Pitfall 3: drizzle-kit
-- emits no down). Drop children before parents, indexes/columns before types, and
-- the pgEnum type LAST (a column still typed `delivery_class` blocks DROP TYPE).
-- IF EXISTS everywhere keeps the down idempotent so up→down→up leaves no residue.
-- (DROP TABLE also removes that table's indexes and FK constraints.)
DROP INDEX IF EXISTS "payments_trans_ref_idx";--> statement-breakpoint
DROP TABLE IF EXISTS "consent_logs";--> statement-breakpoint
DROP TABLE IF EXISTS "payments";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "hold_expires_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "qr_payload";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_method";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_zone";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_fee_satang";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "delivery_class";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "storage_tips";--> statement-breakpoint
ALTER TABLE "varieties" DROP COLUMN IF EXISTS "washing_tips";--> statement-breakpoint
DROP TYPE IF EXISTS "delivery_class";
