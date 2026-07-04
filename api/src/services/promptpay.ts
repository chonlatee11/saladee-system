// PromptPay QR service (PAY-01 / D-02 / RESEARCH Pitfall 5). Pure library wrap —
// the same "pure function, no DB, exported and unit-tested" shape as
// services/pricing.ts. The EMVCo merchant-presented payload (and its trailing
// CRC-16) is produced ENTIRELY by promptpay-qr — CRC is NEVER hand-rolled here
// (RESEARCH "Don't Hand-Roll"). qrcode renders the payload to a data URL.
//
// Money is integer satang everywhere in the codebase; baht conversion (/100) is
// the caller's responsibility and happens ONCE at this boundary. The QR amount
// MUST equal (subtotalSatang + deliveryFeeSatang) / 100 — the full order total,
// never the subtotal alone (RESEARCH Pitfall 5) — so a delivery-charged slip
// matches what the customer actually owes.
import generatePayload from "promptpay-qr";
import QRCode from "qrcode";

/**
 * Build the EMVCo merchant-presented PromptPay payload (incl. a correct CRC-16)
 * for a fixed payee + amount. `amountBaht` is whole-baht X.00 because order
 * totals are multiples of 100 satang (Phase-1 ceil-to-baht pricing + whole-baht
 * delivery fees), converted at the /100 boundary by the caller.
 */
export function buildPromptPayPayload(payeeId: string, amountBaht: number): string {
  return generatePayload(payeeId, { amount: amountBaht });
}

/** Render an EMVCo payload string to a `data:image/png;base64,…` URL for the LIFF checkout. */
export function renderQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1 });
}
