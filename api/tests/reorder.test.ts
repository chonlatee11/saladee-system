// Wave-0 scaffold (CUST-04) — made green by 02-08 (me-orders reorder).
// Behavior: reorder re-prices the previous order's lines at the CURRENTLY selected
// open round (dated-today wins, else NULL default — same rule as orders.ts), and
// flags sold-out/absent items rather than blindly duplicating the old snapshot
// (D-20). Members only; guests get neither history nor reorder (D-19).
import { describe, it } from "bun:test";

describe("reorder (CUST-04)", () => {
  it.todo("re-prices lines at the current open round (does not reuse the old snapshot)", () => {});
  it.todo("flags sold-out / absent items instead of duplicating them", () => {});
});
