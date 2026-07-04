// Wave-0 scaffold (PAY-02) — made green by 02-06 (slip-verify adapter).
// Behavior: the SlipOK adapter maps a mocked HTTP response onto the
// SlipVerifyResult union — clean vs rejected(wrong_amount|wrong_payee|duplicate|
// not_a_slip) vs unavailable (API down/quota → D-04 awaiting-review). The API key
// is read from env only and NEVER logged (Phase-0 D-15).
import { describe, it } from "bun:test";

describe("slip-verify adapter (PAY-02)", () => {
  it.todo("maps a matching slip response to { status: 'clean', transRef, amountSatang }", () => {});
  it.todo("maps wrong amount / wrong payee to { status: 'rejected', reason }", () => {});
  it.todo("maps API down / quota to { status: 'unavailable' } (→ awaiting-review)", () => {});
});
