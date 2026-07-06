// RBAC-ready identity schema (D-07: owner/admin/grower/packer) + Phase-1 commerce core.
// Source: orm.drizzle.team pg-core (RESEARCH "RBAC schema scaffold" + "Drizzle schema style").
// This is the durable schema every later phase builds on. Each pgEnum is created
// as a first-class PostgreSQL type, so a migration both CREATEs the type and the
// tables that use it (and the matching down SQL must DROP both, tables first).
//
// Conventions (mirrored from the original users table):
//   - id: uuid defaultRandom primary key on every table.
//   - created_at: timestamptz defaultNow notNull on every table.
//   - snake_case DB column ↔ camelCase TS key (e.g. line_user_id ↔ lineUserId).
//   - pgEnum declared before the tables that use it (migration ordering, Pitfall 4).
//   - Money is ALWAYS integer satang — never numeric/float (RESEARCH Money Handling, D-13).
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

// ── Commerce enums (declared before the tables that reference them) ──────────
export const tierEnum = pgEnum("tier", ["b2c", "b2b"]);
export const orderStatusEnum = pgEnum("order_status", [
  "created",
  "awaiting_payment",
  "paid",
  "packing",
  "shipping",
  "done",
  "cancelled",
]);
export const substitutionEnum = pgEnum("substitution_policy", ["allow", "disallow"]);
export const unitKindEnum = pgEnum("unit_kind", ["kg", "bag", "pack", "plant"]);
export const roundStatusEnum = pgEnum("round_status", ["open", "closed"]);
// Delivery freshness class per variety (D-13/D-24). Declared before `varieties`
// (Pitfall 4 migration ordering) — gates which delivery methods a cart allows.
export const deliveryClassEnum = pgEnum("delivery_class", ["very_fresh", "normal"]);

// ── Catalog: varieties + their sale units (INV-01, INV-03, D-22 CROP-01 seam) ─
export const varieties = pgTable("varieties", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  imageUrl: text("image_url"),
  avgGramsPerPlant: integer("avg_grams_per_plant").notNull(), // D-22 / CROP-01 seam
  // Phase-2 freshness gating + care content (D-13/D-24). deliveryClass defaults
  // to "normal" so every existing row keeps a valid class after the migration.
  deliveryClass: deliveryClassEnum("delivery_class").notNull().default("normal"),
  storageTips: text("storage_tips"), // nullable care copy (like description)
  washingTips: text("washing_tips"), // nullable care copy
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const saleUnits = pgTable("sale_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  varietyId: uuid("variety_id")
    .notNull()
    .references(() => varieties.id),
  kind: unitKindEnum("kind").notNull(),
  label: text("label").notNull(),
  gramsPerUnit: integer("grams_per_unit").notNull(), // INV-03 pack = e.g. 250 / 500
  plantsPerUnit: integer("plants_per_unit").notNull(), // D-06 conversion back to plants
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Rounds + the oversell-critical stock counter (INV-05, INV-06, D-07/09) ────
export const rounds = pgTable("rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: roundStatusEnum("status").notNull().default("open"),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }), // D-10 request-time cut-off
  harvestDate: date("harvest_date"),
  deliveryDate: date("delivery_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// The oversell counter (D-07). CHECKs added by hand in 0001_commerce.sql:
//   CHECK (reserved_plants >= 0), CHECK (reserved_plants <= quota_plants),
//   CHECK (quota_plants >= 0).
export const roundStock = pgTable(
  "round_stock",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    varietyId: uuid("variety_id")
      .notNull()
      .references(() => varieties.id),
    quotaPlants: integer("quota_plants").notNull(),
    reservedPlants: integer("reserved_plants").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("round_stock_round_variety_idx").on(t.roundId, t.varietyId)],
);

// Per-kg price per variety/round/tier, with an optional dated override (OQ-2 / D-14).
export const prices = pgTable(
  "prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    varietyId: uuid("variety_id")
      .notNull()
      .references(() => varieties.id),
    tier: tierEnum("tier").notNull(),
    pricePerKgSatang: integer("price_per_kg_satang").notNull(), // integer satang, no float
    effectiveDate: date("effective_date"), // NULL = round default; a dated row wins that day
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Uniqueness among DATED rows: one price per (round, variety, tier, date).
    // NOTE: Postgres treats NULLs as DISTINCT in a plain unique index, so this
    // index does NOT constrain the NULL-effective-date round default — the
    // partial index below closes that gap (WR-01).
    uniqueIndex("prices_round_variety_tier_date_idx").on(
      t.roundId,
      t.varietyId,
      t.tier,
      t.effectiveDate,
    ),
    // WR-01: enforce a SINGLE NULL-date default per (round, variety, tier). Without
    // this, two `POST /prices` calls without effectiveDate created two competing
    // "defaults" and price resolution (ORDER BY effective_date DESC NULLS LAST
    // LIMIT 1) became non-deterministic — a money-correctness hazard. A partial
    // unique index is PG-version-agnostic (no NULLS NOT DISTINCT needed) and also
    // serves as the arbiter for the default upsert in POST /prices.
    uniqueIndex("prices_default_uniq")
      .on(t.roundId, t.varietyId, t.tier)
      .where(sql`${t.effectiveDate} IS NULL`),
  ],
);

// ── Customers (guest/member) + saved addresses (CUST-01, D-04) ────────────────
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  isMember: boolean("is_member").notNull().default(false),
  name: text("name"),
  phone: text("phone"),
  lineUserId: text("line_user_id"), // reserved — Phase 2 LINE Login populates (D-04)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerAddresses = pgTable("customer_addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  recipientName: text("recipient_name").notNull(),
  phone: text("phone").notNull(),
  addressLine: text("address_line").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Boxes (mixed-salad BOM) — INV-07, D-17/18 ────────────────────────────────
export const boxes = pgTable("boxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  fixedPriceSatang: integer("fixed_price_satang"), // nullable override (D-18); else sum
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const boxComponents = pgTable(
  "box_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.id),
    varietyId: uuid("variety_id")
      .notNull()
      .references(() => varieties.id),
    plantsPerBox: integer("plants_per_box").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("box_components_box_variety_idx").on(t.boxId, t.varietyId)],
);

// ── Orders + line snapshots (ORD-02, PAY-04, D-16/19/21) ──────────────────────
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id),
  status: orderStatusEnum("status").notNull().default("created"),
  tier: tierEnum("tier").notNull(),
  substitutionPolicy: substitutionEnum("substitution_policy").notNull().default("disallow"),
  recipientName: text("recipient_name"), // snapshot (D-21 optional in Phase 1)
  recipientPhone: text("recipient_phone"),
  recipientAddress: text("recipient_address"),
  taxId: text("tax_id"), // optional invoice (D-21)
  subtotalSatang: integer("subtotal_satang").notNull(),
  // Phase-2 payment hold + QR (D-10/D-11): holdExpiresAt is the authoritative
  // hold deadline the 02-07 safety-net sweep reads (RESEARCH Pitfall 2).
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }), // nullable
  qrPayload: text("qr_payload"), // nullable EMVCo PromptPay string snapshot
  // Delivery snapshot alongside subtotalSatang (D-10/D-12/D-14/D-15). Nullable
  // so Phase-1 orders (no delivery choice) remain valid.
  deliveryMethod: text("delivery_method"), // nullable
  deliveryZone: text("delivery_zone"), // nullable
  deliveryFeeSatang: integer("delivery_fee_satang"), // nullable, integer satang
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const orderLines = pgTable("order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  lineKind: text("line_kind").notNull(), // "variety" | "box"
  varietyId: uuid("variety_id").references(() => varieties.id), // nullable (box lines)
  boxId: uuid("box_id").references(() => boxes.id), // nullable (variety lines)
  varietyName: text("variety_name"), // snapshot (D-16)
  unitLabel: text("unit_label"), // snapshot
  plantsPerUnit: integer("plants_per_unit"),
  pricePerKgSatang: integer("price_per_kg_satang"),
  tier: tierEnum("tier").notNull(),
  unitPriceSatang: integer("unit_price_satang"),
  qty: integer("qty").notNull(),
  plantsDecremented: integer("plants_decremented").notNull(),
  boxBomJson: jsonb("box_bom_json"), // nullable full BOM snapshot (D-18)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Sold-out back-in-stock requests (data-only, INV-08 / D-20) ────────────────
export const backInStockRequests = pgTable("back_in_stock_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id),
  varietyId: uuid("variety_id")
    .notNull()
    .references(() => varieties.id),
  customerId: uuid("customer_id").references(() => customers.id), // nullable
  contact: text("contact"), // nullable — free-form contact when no customer row
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Payments: slip/QR verification + system-wide dedup (PAY-02 / D-06) ─────────
// status ∈ {"verifying","awaiting_review","clean","rejected"} (plain text, no enum:
// the code owns these values and slip-verify (02-06) may add branches without a
// schema migration). transRef carries a UNIQUE partial index so a duplicate slip
// (same bank reference) can never pay two orders — the unique-violation IS the
// dedup (D-06, RESEARCH Pitfall 3). NULL trans_ref rows (awaiting-review, not yet
// verified) coexist because the index is partial (WHERE trans_ref IS NOT NULL).
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    status: text("status").notNull(), // "verifying" | "awaiting_review" | "clean" | "rejected"
    transRef: text("trans_ref"), // nullable — bank reference; UNIQUE when present
    amountSatang: integer("amount_satang"), // nullable, integer satang
    rejectReason: text("reject_reason"), // nullable
    slipKey: text("slip_key"), // nullable — server-assigned R2 key (slips/{orderId}/…)
    rawJson: jsonb("raw_json"), // nullable — provider response snapshot
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // System-wide dedup (D-06). Partial so multiple NULL-transRef awaiting-review
    // rows coexist — mirrors the prices_default_uniq partial-index idiom (0002).
    uniqueIndex("payments_trans_ref_idx")
      .on(t.transRef)
      .where(sql`${t.transRef} IS NOT NULL`),
  ],
);

// ── Consent logs: PDPA usage/marketing grants, append-only (PLAT-04 / D-25/26) ─
// Two separate rows (usage + marketing) per grant, each stamped with the policy
// version it consented to — the audit trail for PDPA withdrawal/reconsent.
export const consentLogs = pgTable("consent_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => customers.id), // nullable
  orderId: uuid("order_id").references(() => orders.id), // nullable
  consentType: text("consent_type").notNull(), // "usage" | "marketing"
  granted: boolean("granted").notNull(),
  policyVersion: text("policy_version").notNull(),
  source: text("source"), // nullable — where the consent was captured
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
