// Wave-0 scaffold (PAY-02 / D-06) — made green by 02-06 (payments route).
// Behavior: the partial UNIQUE index payments_trans_ref_idx enforces system-wide
// dedup — a second order presenting a slip with an ALREADY-USED transRef is
// rejected by a unique-violation on insert (the violation IS the dedup, not a
// vendor-only check). Multiple NULL-transRef awaiting-review rows still coexist.
import { describe, it } from "bun:test";

describe("slip dedup — UNIQUE trans_ref (PAY-02 / D-06)", () => {
  it.todo("rejects a second payment reusing an existing transRef (unique violation)", () => {});
  it.todo("allows multiple NULL-transRef awaiting-review payments to coexist", () => {});
});
