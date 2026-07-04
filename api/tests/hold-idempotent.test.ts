// Wave-0 scaffold (PAY-03 / D-11) — made green by 02-07 (order QR schedule).
// Behavior: re-showing the QR re-sends the hold-expiry job with the SAME
// singletonKey (orderId), so pg-boss dedups it — a second timer is never added and
// the hold is never extended (idempotent QR display).
import { describe, it } from "bun:test";

describe("hold schedule idempotency (PAY-03 / D-11)", () => {
  it.todo("re-scheduling with singletonKey=orderId does not add a second timer", () => {});
});
