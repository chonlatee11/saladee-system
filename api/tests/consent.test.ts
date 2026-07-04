// Wave-0 scaffold (PLAT-04 / D-25/26) — made green by 02-09 (consent logging).
// Behavior: usage + marketing consent are logged as TWO SEPARATE consent_logs rows
// per grant, each stamped with the policy_version it consented to (the PDPA audit
// trail for withdrawal/reconsent). customerId/orderId may be null.
import { describe, it } from "bun:test";

describe("consent logging (PLAT-04)", () => {
  it.todo("writes separate usage and marketing rows, each with a policy_version", () => {});
});
