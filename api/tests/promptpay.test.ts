// PAY-01 — the PromptPay QR service. Pure, no DB (analog: pricing.test.ts).
// Pins the server-authoritative EMVCo contract the checkout slice (02-04)
// snapshots onto the order and renders in the LIFF:
//   - buildPromptPayPayload emits the merchant-presented payload with a CORRECT
//     CRC-16 for a KNOWN golden payee+amount vector (a wrong byte fails).
//   - the trailing CRC-16 is independently re-derived here (CRC-16/CCITT-FALSE,
//     poly 0x1021, init 0xFFFF over everything up to "6304") so the golden string
//     is proven, not merely asserted equal to the library's own output.
//   - QR amount (baht) = (subtotalSatang + deliveryFeeSatang) / 100 (Pitfall 5).
//   - renderQrDataUrl returns a data:image/png;base64 URL.
import { describe, expect, test } from "bun:test";
import { buildPromptPayPayload, renderQrDataUrl } from "../src/services/promptpay";

// Independent CRC-16/CCITT-FALSE — the EMVCo checksum. Re-deriving it here proves
// the payload's trailing 4 hex chars are a correct checksum, not a copy of the lib.
function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("promptpay payload (PAY-01)", () => {
  test("emits the correct CRC-16 EMVCo payload for a golden payee+amount vector", () => {
    // Golden vector: payee 0899999999, amount ฿100.00. The full expected EMVCo
    // string (incl. CRC "CB89") is pinned so a single wrong byte fails the test.
    const GOLDEN =
      "00020101021229370016A000000677010111011300668999999995802TH53037645406100.006304CB89";
    const payload = buildPromptPayPayload("0899999999", 100);
    expect(payload).toBe(GOLDEN);

    // Independently re-derive the CRC over the body (everything up to & incl "6304").
    const body = payload.slice(0, payload.length - 4);
    expect(crc16(body)).toBe(payload.slice(-4));
    expect(payload.slice(-4)).toBe("CB89");
  });

  test("QR amount (baht) equals (subtotalSatang + deliveryFeeSatang) / 100", () => {
    // A delivery-charged order (Pitfall 5): subtotal ฿200 + fee ฿50 → QR bills ฿250.
    const subtotalSatang = 20000;
    const deliveryFeeSatang = 5000;
    const amountBaht = (subtotalSatang + deliveryFeeSatang) / 100; // 250.00
    const payload = buildPromptPayPayload("0000000000", amountBaht);
    // The EMVCo amount tag (54) carries "250.00", NOT the subtotal "200.00".
    expect(payload).toContain("5406250.00");
    expect(payload).not.toContain("5406200.00");
    // CRC still self-consistent for the full-total payload.
    const body = payload.slice(0, payload.length - 4);
    expect(crc16(body)).toBe(payload.slice(-4));
  });

  test("renderQrDataUrl returns a PNG data URL", async () => {
    const url = await renderQrDataUrl(buildPromptPayPayload("0899999999", 100));
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  });
});
