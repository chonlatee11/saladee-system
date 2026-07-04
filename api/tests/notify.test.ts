// Wave-0 scaffold (ORD-04 / D-21/D-23) — made green by 02-07 (notify service).
// Behavior: the milestone Flex push targets ONLY customers with a line_user_id;
// guests are skipped silently. Pushes fire only on milestones {paid, packing/
// shipping, done, cancelled}. The channel token is never logged.
import { describe, it } from "bun:test";

describe("milestone notify (ORD-04)", () => {
  it.todo("pushes a Flex message only to members with a line_user_id", () => {});
  it.todo("skips guests (no line_user_id) silently", () => {});
});
