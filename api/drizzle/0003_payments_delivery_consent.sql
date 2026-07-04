CREATE TYPE "public"."delivery_class" AS ENUM('very_fresh', 'normal');--> statement-breakpoint
CREATE TABLE "consent_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"consent_type" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"trans_ref" text,
	"amount_satang" integer,
	"reject_reason" text,
	"slip_key" text,
	"raw_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qr_payload" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_zone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee_satang" integer;--> statement-breakpoint
ALTER TABLE "varieties" ADD COLUMN "delivery_class" "delivery_class" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "varieties" ADD COLUMN "storage_tips" text;--> statement-breakpoint
ALTER TABLE "varieties" ADD COLUMN "washing_tips" text;--> statement-breakpoint
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_trans_ref_idx" ON "payments" USING btree ("trans_ref") WHERE "payments"."trans_ref" IS NOT NULL;
