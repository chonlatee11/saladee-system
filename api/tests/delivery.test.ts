// Wave-0 scaffold (DEL-01..04) — made green by 02-04 (delivery service).
// Behavior: server-authoritative fee matrix — zone×method flat rate; free shipping
// over ฿500 (50000 satang) ONLY for self+general methods (D-15); the freshness
// intersection (ALLOWED_METHODS[deliveryClass]) blocks methods a very_fresh cart
// may not use (D-13). Fee is computed server-side, never trusted from the client.
import { describe, it } from "bun:test";

describe("delivery fee + freshness matrix (DEL-01..04)", () => {
  it.todo("returns the flat fee for a given (zone, method)", () => {});
  it.todo("applies free shipping over 50000 satang only for self+general", () => {});
  it.todo("blocks methods not allowed for a very_fresh cart (freshness intersection)", () => {});
});
