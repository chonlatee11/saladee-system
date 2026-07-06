// PUBLIC delivery quote (DEL-04 / D-03/D-14). Analog: routes/catalog.ts — a
// no-guard read surface that returns SERVER-authoritative computed values. Given a
// cart (variety ids + box ids) and a zone, the handler reads each variety's
// delivery_class, computes the freshness intersection + the flat fee per method,
// and reads the round's read-only deliveryDate. The fee is display-only here; the
// checkout API (02-04) recomputes + snapshots it, so a client can never set it
// (T-02-09). DI mirrors makeCatalogRoutes(db); index.ts composes the default.
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Elysia, t } from "elysia";
import { deliveryConfig } from "../config/delivery";
import { db as defaultDb } from "../db/client";
import type * as schema from "../db/schema";
import { boxComponents, rounds, varieties } from "../db/schema";
import {
  type DeliveryClass,
  type DeliveryMethod,
  allowedMethodsForCart,
  computeDeliveryFee,
} from "../services/delivery";

type DeliveryDb = PostgresJsDatabase<typeof schema>;

// Query input: the round (for deliveryDate + fee context), the zone, the cart's
// variety + box ids, and the subtotal (drives the ฿500 free-shipping rule). Arrays
// arrive as repeated query params (?varietyIds=..&varietyIds=..). subtotalSatang is
// coerced from the query string via t.Numeric.
const QuoteQuery = t.Object({
  roundId: t.String({ format: "uuid" }),
  zoneId: t.String({ minLength: 1 }),
  subtotalSatang: t.Optional(t.Numeric({ minimum: 0 })),
  varietyIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
  boxIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
});

export function makeDeliveryRoutes(database: DeliveryDb = defaultDb) {
  return new Elysia().get(
    "/delivery/quote",
    async ({ query, set }) => {
      const [round] = await database
        .select()
        .from(rounds)
        .where(eq(rounds.id, query.roundId))
        .limit(1);
      if (!round) {
        set.status = 404;
        return { error: "round_not_found" };
      }

      // Collect every variety in the cart: direct items + each box's BOM components.
      const varietyIds = new Set<string>(query.varietyIds ?? []);
      const boxIds = query.boxIds ?? [];
      if (boxIds.length > 0) {
        const comps = await database
          .select({ varietyId: boxComponents.varietyId })
          .from(boxComponents)
          .where(inArray(boxComponents.boxId, boxIds));
        for (const c of comps) varietyIds.add(c.varietyId);
      }

      // Read each variety's freshness class → the strictest-wins intersection (D-13).
      const classes: DeliveryClass[] = [];
      if (varietyIds.size > 0) {
        const vs = await database
          .select({ deliveryClass: varieties.deliveryClass })
          .from(varieties)
          .where(inArray(varieties.id, [...varietyIds]));
        for (const v of vs) classes.push(v.deliveryClass as DeliveryClass);
      }
      const allowedMethods = allowedMethodsForCart(classes);

      // Compute the flat fee per allowed method; a method not offered in this zone
      // is simply omitted from the fee map (never trusted from the client).
      const subtotal = query.subtotalSatang ?? 0;
      const fees: Partial<Record<DeliveryMethod, number>> = {};
      for (const method of allowedMethods) {
        try {
          fees[method] = computeDeliveryFee(query.zoneId, method, subtotal, deliveryConfig);
        } catch {
          // method_not_available_in_zone → not offered here; skip it.
        }
      }

      return { allowedMethods, fees, deliveryDate: round.deliveryDate };
    },
    { query: QuoteQuery },
  );
}

// Default instance bound to the runtime db — composed in index.ts.
export const deliveryRoutes = makeDeliveryRoutes();
