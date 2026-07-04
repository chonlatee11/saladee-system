// Wave-0 scaffold (PAY-01) — made green by 02-05 (PromptPay QR service).
// Behavior: buildPromptPayPayload(payeeId, amountBaht) emits the EMVCo
// merchant-presented payload with a correct CRC-16 for a KNOWN golden vector
// (payee + amount), and QR amount = (subtotal + delivery fee) / 100 (Pitfall 5).
import { describe, it } from "bun:test";

describe("promptpay payload (PAY-01)", () => {
  it.todo("emits the correct CRC-16 EMVCo payload for a golden payee+amount vector", () => {});
  it.todo("QR amount (baht) equals (subtotalSatang + deliveryFeeSatang) / 100", () => {});
});
