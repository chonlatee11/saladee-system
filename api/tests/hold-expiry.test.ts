// Wave-0 scaffold (PAY-03 / D-09) — made green by 02-07 (hold-expiry job).
// Behavior: the hold-expiry handler cancels an awaiting_payment order and releases
// EXACTLY the reserved plants, but is a safe NO-OP on a paid order (applyTransition
// onlyIfHold gates on {created, awaiting_payment} — RESEARCH Pitfall 1 / T-02-01).
import { describe, it } from "bun:test";

describe("hold expiry (PAY-03 / D-09)", () => {
  it.todo("cancels an awaiting_payment order and releases exactly the reserved plants", () => {});
  it.todo("is a NO-OP on a paid order (never releases already-sold stock)", () => {});
});
