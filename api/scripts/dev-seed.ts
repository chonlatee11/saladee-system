// Dev/UAT seed — idempotent. Arranges the full back-office fixture the Phase-3
// UAT needs: staff (owner/grower/packer), varieties w/ crop params, an open round
// with stock+prices+sale units, a planting mix template, near-harvest batches, a
// mixed box, B2B customers (pending + approved) with a standing order, a LINE
// member with an active subscription. Re-runnable: get-or-create by natural keys,
// children cleared+reinserted. NOT wired into app boot — run manually:
//   bun run scripts/dev-seed.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  boxComponents,
  boxes,
  customers,
  plantingBatches,
  plantingMixItems,
  plantingMixTemplates,
  prices,
  quotaOverflowFlags,
  roundStock,
  rounds,
  saleUnits,
  standingOrderItems,
  standingOrders,
  subscriptionOrders,
  subscriptions,
  users,
  varieties,
} from "../src/db/schema";

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 86400_000);
// Round harvest day = today (UTC midnight). Batches are planted exactly
// daysToHarvest before this so projectedHarvestDate == round.harvestDate — the
// equality computeDraftQuota() requires for a batch to feed the round's forecast.
const HARVEST_STR = new Date().toISOString().slice(0, 10);
const HARVEST_MIDNIGHT = new Date(`${HARVEST_STR}T00:00:00.000Z`);
const plantDateFor = (daysToHarvest: number) =>
  new Date(HARVEST_MIDNIGHT.getTime() - daysToHarvest * 86400_000);

// ── staff ────────────────────────────────────────────────────────────────────
const STAFF = [
  { email: "owner@saladee.local", role: "owner" as const, password: "owner1234" },
  { email: "grower@saladee.local", role: "grower" as const, password: "grower1234" },
  { email: "packer@saladee.local", role: "packer" as const, password: "packer1234" },
];
for (const s of STAFF) {
  const passwordHash = await Bun.password.hash(s.password, { algorithm: "argon2id" });
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, s.email))
    .limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, role: s.role }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email: s.email, passwordHash, role: s.role });
  }
}
console.log("staff ready:", STAFF.map((s) => `${s.email}/${s.password}`).join("  "));

// ── varieties (fixture, distinct crop params) ─────────────────────────────────
const VAR = [
  { name: "กรีนโอ๊ค (fixture)", avg: 120, days: 32, survival: 92, shelf: 7 },
  { name: "เรดโอ๊ค (fixture)", avg: 110, days: 35, survival: 88, shelf: 6 },
  { name: "บัตเตอร์เฮด (fixture)", avg: 140, days: 40, survival: 90, shelf: 8 },
];
const varietyIds: string[] = [];
for (const v of VAR) {
  const [ex] = await db
    .select({ id: varieties.id })
    .from(varieties)
    .where(eq(varieties.name, v.name))
    .limit(1);
  const vals = {
    name: v.name,
    avgGramsPerPlant: v.avg,
    daysToHarvest: v.days,
    survivalPct: v.survival,
    harvestWindowDays: 2,
    shelfLifeDays: v.shelf,
    active: true,
  };
  if (ex) {
    await db.update(varieties).set(vals).where(eq(varieties.id, ex.id));
    varietyIds.push(ex.id);
  } else {
    const [row] = await db.insert(varieties).values(vals).returning({ id: varieties.id });
    varietyIds.push(row!.id);
  }
}
console.log("varieties ready:", varietyIds.length);

// ── open round (reuse by name) ────────────────────────────────────────────────
const ROUND_NAME = "รอบทดสอบ live";
let roundId: string;
{
  const [ex] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.name, ROUND_NAME))
    .limit(1);
  const vals = {
    name: ROUND_NAME,
    status: "open" as const,
    cutoffAt: days(7),
    harvestDate: HARVEST_STR,
    deliveryDate: days(1).toISOString().slice(0, 10),
  };
  if (ex) {
    await db.update(rounds).set(vals).where(eq(rounds.id, ex.id));
    roundId = ex.id;
  } else {
    const [row] = await db.insert(rounds).values(vals).returning({ id: rounds.id });
    roundId = row!.id;
  }
}

// Reset the round to an UNPUBLISHED state so the grower's next publish is a genuine
// FIRST publish — publishQuota() gates standing-reservation + subscription generation
// on "round has no round_stock rows yet". Pre-seeding round_stock (the earlier bug)
// silently consumed that first publish, so reserve-before-B2C never fired. Clear the
// round's counters + generated artifacts (fixture round only) to re-arm the chain.
await db.delete(subscriptionOrders).where(eq(subscriptionOrders.roundId, roundId));
await db.delete(quotaOverflowFlags).where(eq(quotaOverflowFlags.roundId, roundId));
await db.delete(roundStock).where(eq(roundStock.roundId, roundId));
console.log("round ready (unpublished, harvest =", HARVEST_STR, "):", roundId);

// ── per-variety: sale unit + prices (b2c/b2b) ─────────────────────────────────
// NOTE: round_stock is intentionally NOT seeded — publishQuota() must create it on
// the first publish (see the reset above) so the reserve-before-B2C chain runs.
for (const vid of varietyIds) {
  // sale unit (pack 250g) — get-or-create by variety+label
  const [su] = await db
    .select({ id: saleUnits.id })
    .from(saleUnits)
    .where(and(eq(saleUnits.varietyId, vid), eq(saleUnits.label, "250g")))
    .limit(1);
  if (!su) {
    await db.insert(saleUnits).values({
      varietyId: vid,
      kind: "pack",
      label: "250g",
      gramsPerUnit: 250,
      plantsPerUnit: 2,
    });
  }
  // prices — default (null date) b2c + b2b, unique partial index arbiter
  for (const [tier, price] of [
    ["b2c", 20000],
    ["b2b", 17000],
  ] as const) {
    const [p] = await db
      .select({ id: prices.id })
      .from(prices)
      .where(
        and(
          eq(prices.roundId, roundId),
          eq(prices.varietyId, vid),
          eq(prices.tier, tier),
          isNull(prices.effectiveDate),
        ),
      )
      .limit(1);
    if (!p) {
      await db
        .insert(prices)
        .values({ roundId, varietyId: vid, tier, pricePerKgSatang: price, effectiveDate: null });
    }
  }
}
console.log("units/prices ready");

// ── planting mix template + items ─────────────────────────────────────────────
const MIX_NAME = "มิกซ์สลัดประจำสัปดาห์ (fixture)";
{
  const [ex] = await db
    .select({ id: plantingMixTemplates.id })
    .from(plantingMixTemplates)
    .where(eq(plantingMixTemplates.name, MIX_NAME))
    .limit(1);
  let tid: string;
  if (ex) {
    tid = ex.id;
    await db
      .update(plantingMixTemplates)
      .set({ active: true })
      .where(eq(plantingMixTemplates.id, tid));
    await db.delete(plantingMixItems).where(eq(plantingMixItems.templateId, tid));
  } else {
    const [row] = await db
      .insert(plantingMixTemplates)
      .values({ name: MIX_NAME, active: true })
      .returning({ id: plantingMixTemplates.id });
    tid = row!.id;
  }
  await db
    .insert(plantingMixItems)
    .values(
      varietyIds.map((vid, i) => ({ templateId: tid, varietyId: vid, plantCount: 40 + i * 10 })),
    );
}
console.log("mix template ready");

// ── planting batches aligned to the round's harvest day (bed marker = guard) ──
// plantDate = harvestDay − variety.daysToHarvest ⇒ projectedHarvestDate == round
// harvestDate, so each batch feeds this round's forecast (computeDraftQuota equality).
for (let i = 0; i < varietyIds.length; i++) {
  const bed = `DEV-BED-${i + 1}`;
  const plantDate = plantDateFor(VAR[i]!.days);
  const [ex] = await db
    .select({ id: plantingBatches.id })
    .from(plantingBatches)
    .where(eq(plantingBatches.bed, bed))
    .limit(1);
  if (ex) {
    await db
      .update(plantingBatches)
      .set({ plantDate, plantCount: 60, varietyId: varietyIds[i]! })
      .where(eq(plantingBatches.id, ex.id));
  } else {
    await db
      .insert(plantingBatches)
      .values({ varietyId: varietyIds[i]!, plantDate, plantCount: 60, bed });
  }
}
console.log("planting batches ready (projected harvest =", HARVEST_STR, ")");

// ── mixed box + components ────────────────────────────────────────────────────
const BOX_NAME = "กล่องสลัดรวม (fixture)";
{
  const [ex] = await db
    .select({ id: boxes.id })
    .from(boxes)
    .where(eq(boxes.name, BOX_NAME))
    .limit(1);
  let bid: string;
  if (ex) {
    bid = ex.id;
    await db.delete(boxComponents).where(eq(boxComponents.boxId, bid));
  } else {
    const [row] = await db
      .insert(boxes)
      .values({ name: BOX_NAME, fixedPriceSatang: null })
      .returning({ id: boxes.id });
    bid = row!.id;
  }
  await db
    .insert(boxComponents)
    .values(varietyIds.map((vid) => ({ boxId: bid, varietyId: vid, plantsPerBox: 2 })));
}
console.log("box ready");

// ── B2B customers: pending + approved ─────────────────────────────────────────
async function getOrCreateCustomer(
  name: string,
  extra: Partial<typeof customers.$inferInsert>,
): Promise<string> {
  const [ex] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.name, name))
    .limit(1);
  if (ex) {
    await db.update(customers).set(extra).where(eq(customers.id, ex.id));
    return ex.id;
  }
  const [row] = await db
    .insert(customers)
    .values({ name, ...extra })
    .returning({ id: customers.id });
  return row!.id;
}
// pending B2B — created for its side-effect (the approval-flow fixture); id unused.
await getOrCreateCustomer("บริษัท ครัวใบเขียว (pending)", {
  phone: "0810000001",
  b2bStatus: "pending",
});
const b2bApprovedId = await getOrCreateCustomer("โรงแรมสวนผัก (approved)", {
  phone: "0810000002",
  b2bStatus: "approved",
  creditTerms: "เครดิต 30 วัน",
  b2bApprovedAt: now,
});
console.log("B2B customers ready (pending + approved)");

// ── standing order for the approved B2B (reserves before B2C) ─────────────────
{
  const [ex] = await db
    .select({ id: standingOrders.id })
    .from(standingOrders)
    .where(eq(standingOrders.customerId, b2bApprovedId))
    .limit(1);
  let sid: string;
  if (ex) {
    sid = ex.id;
    await db.update(standingOrders).set({ active: true }).where(eq(standingOrders.id, sid));
    await db.delete(standingOrderItems).where(eq(standingOrderItems.standingId, sid));
  } else {
    const [row] = await db
      .insert(standingOrders)
      .values({ customerId: b2bApprovedId, active: true })
      .returning({ id: standingOrders.id });
    sid = row!.id;
  }
  await db
    .insert(standingOrderItems)
    .values(
      varietyIds
        .slice(0, 2)
        .map((vid) => ({ standingId: sid, varietyId: vid, plantsPerRound: 20 })),
    );
}
console.log("standing order ready");

// ── LINE member + active subscription ─────────────────────────────────────────
const memberId = await getOrCreateCustomer("สมาชิกทดสอบ LINE (fixture)", {
  phone: "0820000003",
  isMember: true,
  lineUserId: "Udev-member-0001",
});
{
  const [ex] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.customerId, memberId))
    .limit(1);
  const vals = {
    customerId: memberId,
    packageCode: "M",
    packageValueSatang: 30000, // 300 บาท/รอบ
    frequency: "weekly",
    status: "active" as const,
  };
  if (ex) {
    await db.update(subscriptions).set(vals).where(eq(subscriptions.id, ex.id));
  } else {
    await db.insert(subscriptions).values(vals);
  }
}
console.log("member + active subscription ready");

console.log("\n✅ dev-seed complete");
process.exit(0);
