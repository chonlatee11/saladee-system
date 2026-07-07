// Packing routes (Wave-2 packing slice, 03-09). Fills the 03-01 stub with the
// packer-gated pack-queue listing (grouped by round → delivery route, Pattern 5 /
// D-20), per-order packed_at state, and the pack/label PDF downloads (D-21). Every
// route closes over the injected db (makePackingRoutes(db) DI, mirrors crop.ts)
// and is guarded by requireRole("owner","admin","packer") — a grower or customer
// session can never reach these (D-19 / T-03-23).
//
// PDPA (T-03-24): the PDF endpoints carry customer names/addresses, so they are
// packer-gated and returned with `Cache-Control: no-store, private` (never cached
// by a shared proxy) and never logged. The Thai (Sarabun) render itself is the
// 03-02 spike's renderPackSlip/renderLabelSlip — reused verbatim, not re-built.
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { orderLines, orders, rounds } from "../db/schema";
import {
  buildLabelSlipDoc,
  renderLabelSlip,
} from "../pdf/label-slip";
import {
  buildPackSlipDoc,
  type PackSlipOrder,
  renderPackSlip,
} from "../pdf/pack-slip";
import { requireRole } from "../plugins/auth.plugin";

type CatalogDb = PostgresJsDatabase<typeof schema>;

const RoundQuery = t.Object({ roundId: t.Optional(t.String({ format: "uuid" })) });
const OrderQuery = t.Object({ orderId: t.String({ format: "uuid" }) });
const OrderIdParams = t.Object({ orderId: t.String({ format: "uuid" }) });

// Headers a packer-gated PDF must never let a shared cache keep (PDPA, T-03-24).
const PDF_HEADERS = {
  "content-type": "application/pdf",
  "cache-control": "no-store, private",
} as const;

/** A single paid order as the queue lists it (route snapshot + pack state). */
interface QueueOrder {
  id: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  deliveryMethod: string | null;
  deliveryZone: string | null;
  subtotalSatang: number;
  deliveryFeeSatang: number | null;
  packedAt: string | null;
}

/** Load the paid orders for the queue / a pack slip, ordered by (round, zone). */
async function loadPaidOrders(database: CatalogDb, roundId?: string) {
  // Single indexed query over the existing orders.deliveryMethod/deliveryZone
  // snapshot columns — NO new join (D-20). Ordered by (round_id, delivery_zone)
  // so grouping is a straight linear pass.
  return database
    .select()
    .from(orders)
    .where(
      roundId
        ? and(eq(orders.status, "paid"), eq(orders.roundId, roundId))
        : eq(orders.status, "paid"),
    )
    .orderBy(orders.roundId, orders.deliveryZone);
}

export function makePackingRoutes(database: CatalogDb = defaultDb) {
  const packer = requireRole("owner", "admin", "packer");

  return (
    new Elysia()
      // ── Pack queue grouped by round → route (ORD-03 / D-20, Pattern 5) ───────
      .get(
        "/packing/queue",
        async ({ query }) => {
          const rows = await loadPaidOrders(database, query.roundId);
          if (rows.length === 0) return [];

          // Round names for the group headers — a small inArray lookup (NOT a join
          // on the queue query itself, keeping that query index-only).
          const roundIds = [...new Set(rows.map((r) => r.roundId))];
          const roundRows = await database
            .select({ id: rounds.id, name: rounds.name })
            .from(rounds)
            .where(inArray(rounds.id, roundIds));
          const roundName = new Map(roundRows.map((r) => [r.id, r.name]));

          // Group: round → route (deliveryMethod|deliveryZone). The source rows are
          // already ordered by (round_id, delivery_zone) so insertion order is stable.
          const groups = new Map<
            string,
            {
              roundId: string;
              roundName: string;
              routes: Map<
                string,
                { deliveryMethod: string | null; deliveryZone: string | null; orders: QueueOrder[] }
              >;
            }
          >();
          for (const o of rows) {
            let g = groups.get(o.roundId);
            if (!g) {
              g = {
                roundId: o.roundId,
                roundName: roundName.get(o.roundId) ?? "รอบส่ง",
                routes: new Map(),
              };
              groups.set(o.roundId, g);
            }
            const routeKey = `${o.deliveryMethod ?? ""}|${o.deliveryZone ?? ""}`;
            let r = g.routes.get(routeKey);
            if (!r) {
              r = { deliveryMethod: o.deliveryMethod, deliveryZone: o.deliveryZone, orders: [] };
              g.routes.set(routeKey, r);
            }
            r.orders.push({
              id: o.id,
              recipientName: o.recipientName,
              recipientPhone: o.recipientPhone,
              recipientAddress: o.recipientAddress,
              deliveryMethod: o.deliveryMethod,
              deliveryZone: o.deliveryZone,
              subtotalSatang: o.subtotalSatang,
              deliveryFeeSatang: o.deliveryFeeSatang,
              packedAt: o.packedAt ? o.packedAt.toISOString() : null,
            });
          }

          return [...groups.values()].map((g) => ({
            roundId: g.roundId,
            roundName: g.roundName,
            routes: [...g.routes.values()],
          }));
        },
        { query: RoundQuery, beforeHandle: packer },
      )

      // ── Mark an order packed (D-20 per-order pack state) ─────────────────────
      .patch(
        "/packing/:orderId/packed",
        async ({ params, set }) => {
          const [row] = await database
            .update(orders)
            .set({ packedAt: new Date() })
            .where(eq(orders.id, params.orderId))
            .returning({ id: orders.id, packedAt: orders.packedAt });
          if (!row) {
            set.status = 404;
            return { error: "order_not_found" };
          }
          return { id: row.id, packedAt: row.packedAt ? row.packedAt.toISOString() : null };
        },
        { params: OrderIdParams, beforeHandle: packer },
      )

      // ── Pack slip PDF for a round (D-21) — Thai (Sarabun) via 03-02 spike ────
      .get(
        "/packing/pack-slip.pdf",
        async ({ query, set }) => {
          const rows = await loadPaidOrders(database, query.roundId);
          if (rows.length === 0) {
            set.status = 404;
            return { error: "no_orders_to_pack" };
          }
          // Round name for the slip header.
          const roundId = rows[0]?.roundId;
          const [round] = roundId
            ? await database
                .select({ name: rounds.name })
                .from(rounds)
                .where(eq(rounds.id, roundId))
                .limit(1)
            : [];

          // One line lookup for all orders (inArray) — snapshot columns only.
          const orderIds = rows.map((r) => r.id);
          const lines = await database
            .select({
              orderId: orderLines.orderId,
              varietyName: orderLines.varietyName,
              unitLabel: orderLines.unitLabel,
              qty: orderLines.qty,
              unitPriceSatang: orderLines.unitPriceSatang,
            })
            .from(orderLines)
            .where(inArray(orderLines.orderId, orderIds));
          const linesByOrder = new Map<string, PackSlipOrder["lines"]>();
          for (const l of lines) {
            const bucket = linesByOrder.get(l.orderId) ?? [];
            bucket.push({
              varietyName: l.varietyName,
              unitLabel: l.unitLabel,
              qty: l.qty,
              unitPriceSatang: l.unitPriceSatang,
            });
            linesByOrder.set(l.orderId, bucket);
          }

          const slipOrders: PackSlipOrder[] = rows.map((o) => ({
            id: o.id,
            recipientName: o.recipientName,
            recipientPhone: o.recipientPhone,
            recipientAddress: o.recipientAddress,
            deliveryMethod: o.deliveryMethod,
            deliveryZone: o.deliveryZone,
            subtotalSatang: o.subtotalSatang,
            deliveryFeeSatang: o.deliveryFeeSatang,
            lines: linesByOrder.get(o.id) ?? [],
          }));

          const buf = await renderPackSlip(
            buildPackSlipDoc({ roundName: round?.name ?? "รอบส่ง", orders: slipOrders }),
          );
          return new Response(new Uint8Array(buf), { headers: PDF_HEADERS });
        },
        { query: RoundQuery, beforeHandle: packer },
      )

      // ── Label slip PDF for one order (D-21) ──────────────────────────────────
      .get(
        "/packing/label-slip.pdf",
        async ({ query, set }) => {
          const [o] = await database
            .select()
            .from(orders)
            .where(eq(orders.id, query.orderId))
            .limit(1);
          if (!o) {
            set.status = 404;
            return { error: "order_not_found" };
          }
          const [round] = await database
            .select({ name: rounds.name })
            .from(rounds)
            .where(eq(rounds.id, o.roundId))
            .limit(1);

          const buf = await renderLabelSlip(
            buildLabelSlipDoc({
              id: o.id,
              roundName: round?.name ?? "รอบส่ง",
              recipientName: o.recipientName,
              recipientPhone: o.recipientPhone,
              recipientAddress: o.recipientAddress,
              deliveryMethod: o.deliveryMethod,
              deliveryZone: o.deliveryZone,
            }),
          );
          return new Response(new Uint8Array(buf), { headers: PDF_HEADERS });
        },
        { query: OrderQuery, beforeHandle: packer },
      )
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const packingRoutes = makePackingRoutes();
