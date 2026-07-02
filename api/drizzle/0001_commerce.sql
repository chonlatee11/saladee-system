CREATE TYPE "public"."order_status" AS ENUM('created', 'awaiting_payment', 'paid', 'packing', 'shipping', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."substitution_policy" AS ENUM('allow', 'disallow');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('b2c', 'b2b');--> statement-breakpoint
CREATE TYPE "public"."unit_kind" AS ENUM('kg', 'bag', 'pack', 'plant');--> statement-breakpoint
CREATE TABLE "back_in_stock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"variety_id" uuid NOT NULL,
	"customer_id" uuid,
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "box_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"variety_id" uuid NOT NULL,
	"plants_per_box" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"fixed_price_satang" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"address_line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_member" boolean DEFAULT false NOT NULL,
	"name" text,
	"phone" text,
	"line_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_kind" text NOT NULL,
	"variety_id" uuid,
	"box_id" uuid,
	"variety_name" text,
	"unit_label" text,
	"plants_per_unit" integer,
	"price_per_kg_satang" integer,
	"tier" "tier" NOT NULL,
	"unit_price_satang" integer,
	"qty" integer NOT NULL,
	"plants_decremented" integer NOT NULL,
	"box_bom_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"tier" "tier" NOT NULL,
	"substitution_policy" "substitution_policy" DEFAULT 'disallow' NOT NULL,
	"recipient_name" text,
	"recipient_phone" text,
	"recipient_address" text,
	"tax_id" text,
	"subtotal_satang" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"variety_id" uuid NOT NULL,
	"tier" "tier" NOT NULL,
	"price_per_kg_satang" integer NOT NULL,
	"effective_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"variety_id" uuid NOT NULL,
	"quota_plants" integer NOT NULL,
	"reserved_plants" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "round_status" DEFAULT 'open' NOT NULL,
	"cutoff_at" timestamp with time zone,
	"harvest_date" date,
	"delivery_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variety_id" uuid NOT NULL,
	"kind" "unit_kind" NOT NULL,
	"label" text NOT NULL,
	"grams_per_unit" integer NOT NULL,
	"plants_per_unit" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "varieties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"image_url" text,
	"avg_grams_per_plant" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "back_in_stock_requests" ADD CONSTRAINT "back_in_stock_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_components" ADD CONSTRAINT "box_components_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_components" ADD CONSTRAINT "box_components_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_stock" ADD CONSTRAINT "round_stock_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_stock" ADD CONSTRAINT "round_stock_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_units" ADD CONSTRAINT "sale_units_variety_id_varieties_id_fk" FOREIGN KEY ("variety_id") REFERENCES "public"."varieties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "box_components_box_variety_idx" ON "box_components" USING btree ("box_id","variety_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_round_variety_tier_date_idx" ON "prices" USING btree ("round_id","variety_id","tier","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "round_stock_round_variety_idx" ON "round_stock" USING btree ("round_id","variety_id");--> statement-breakpoint
-- Hand-added oversell-integrity CHECKs (drizzle-kit does not emit CHECKs from pg-core).
-- These enforce the reservation invariant at the DB level (T-01-02): reserved can never
-- go negative and can never exceed quota; quota itself is non-negative.
ALTER TABLE "round_stock" ADD CONSTRAINT "round_stock_reserved_nonneg_check" CHECK ("reserved_plants" >= 0);--> statement-breakpoint
ALTER TABLE "round_stock" ADD CONSTRAINT "round_stock_reserved_le_quota_check" CHECK ("reserved_plants" <= "quota_plants");--> statement-breakpoint
ALTER TABLE "round_stock" ADD CONSTRAINT "round_stock_quota_nonneg_check" CHECK ("quota_plants" >= 0);--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_qty_positive_check" CHECK ("qty" > 0);