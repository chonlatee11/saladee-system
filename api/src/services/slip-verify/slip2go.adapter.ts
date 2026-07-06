// Slip2Go adapter (D-01/D-02/D-03) — the default slip verifier (replaces SlipOK).
// Verifies a customer's PromptPay slip against the shop's receiving account and the
// order amount, returning a narrow SlipVerifyResult the payments route can act on.
// Docs: Slip2Go API v1.2 (base https://connect.slip2go.com/api).
//
// Security invariants (mirrors the SlipOK adapter):
//   - The api secret is read ONLY from validated env (env.SLIP2GO_API_SECRET) and
//     rides the `Authorization: Bearer` header — NEVER logged, NEVER in a body
//     (Phase-0 D-15 / T-02-24). This module logs nothing.
//   - Amount correctness is re-enforced HERE to the satang (D-03): even when
//     Slip2Go's own `checkAmount` passes, we compare the returned baht amount to
//     expectedAmountSatang and reject a mismatch — we never trust the vendor alone.
//   - Money-safety default: any UNRECOGNIZED or transient failure (network, 401,
//     429, 5xx, date-mismatch, unknown code) maps to `unavailable`, which parks the
//     order for admin review (D-04) — never auto-pay on ambiguity, never hard-reject
//     a possibly-valid payment on an unknown response.
//
// Receiver check reuses PROMPTPAY_PAYEE_ID (the merchant QR payee) as a partial
// `accountNumber` match — no extra config. Slip2Go's duplicate check is enabled so a
// re-used slip hard-rejects here, but our DB unique(transRef) stays the system-wide
// arbiter (slip-dedup). Every logical outcome comes back HTTP 200 with a `code`.
import { env } from "../../env";
import type { SlipRejectReason, SlipVerifier, SlipVerifyInput, SlipVerifyResult } from "./types";

const SLIP2GO_BASE = "https://connect.slip2go.com/api";

// Slip2Go `code` (String) → our outcome. Anything not listed → money-safe unavailable.
const CODE_OUTCOME: Record<string, SlipRejectReason | "clean" | "unavailable"> = {
  "200000": "clean", // Slip found (bank has the transfer)
  "200200": "clean", // Slip is Valid (all requested conditions passed)
  "200401": "wrong_payee", // Recipient Account Not Match
  "200402": "wrong_amount", // Transfer Amount Not Match
  "200403": "unavailable", // Transfer Date Not Match (we don't send checkDate) → review
  "200404": "not_a_slip", // Slip Not Found in the bank system
  "200501": "duplicate", // Slip is Duplicated (vendor-side)
};

interface Slip2GoOptions {
  apiSecret?: string;
  payeeId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class Slip2GoAdapter implements SlipVerifier {
  private readonly apiSecret: string;
  private readonly payeeId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: Slip2GoOptions = {}) {
    this.apiSecret = opts.apiSecret ?? env.SLIP2GO_API_SECRET;
    this.payeeId = opts.payeeId ?? env.PROMPTPAY_PAYEE_ID;
    this.baseUrl = opts.baseUrl ?? SLIP2GO_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async verify(input: SlipVerifyInput): Promise<SlipVerifyResult> {
    const amountBaht = input.expectedAmountSatang / 100;
    // Ask Slip2Go to check the shop is the receiver + the exact amount. We STILL
    // re-check the satang ourselves below (D-03). checkDuplicate flags vendor-side
    // reuse; our DB remains the arbiter.
    const checkCondition = {
      checkDuplicate: true,
      checkReceiver: [{ accountNumber: this.payeeId }],
      checkAmount: { type: "eq", amount: amountBaht },
    };
    const authHeader = `Bearer ${this.apiSecret}`; // key: header only, never body/log

    let res: Response;
    try {
      if (input.image) {
        // Multipart: the slip image file + the condition JSON string (qr-image/info).
        const form = new FormData();
        // Wrap in a fresh Uint8Array so the view is ArrayBuffer-backed (valid BlobPart).
        form.append(
          "file",
          new Blob([new Uint8Array(input.image)], { type: "image/jpeg" }),
          "slip.jpg",
        );
        form.append("payload", JSON.stringify(checkCondition));
        res = await this.fetchImpl(`${this.baseUrl}/verify-slip/qr-image/info`, {
          method: "POST",
          headers: { authorization: authHeader },
          body: form,
        });
      } else {
        // JSON: the decoded QR string + condition (qr-code/info).
        res = await this.fetchImpl(`${this.baseUrl}/verify-slip/qr-code/info`, {
          method: "POST",
          headers: { authorization: authHeader, "content-type": "application/json" },
          body: JSON.stringify({ payload: { qrCode: input.qrPayload }, checkCondition }),
        });
      }
    } catch {
      // Network / DNS / abort → vendor unreachable → admin review (D-04).
      return { status: "unavailable" };
    }

    const body = await safeJson(res);

    // Transport-level failures are always review, never reject: 401 (bad/absent
    // secret), 429 (quota), 5xx (vendor down). Logical outcomes come back as 200.
    if (res.status === 401 || res.status === 429 || res.status >= 500) {
      return { status: "unavailable", raw: body };
    }

    const code = typeof body?.code === "string" ? body.code : undefined;
    const outcome = code !== undefined ? CODE_OUTCOME[code] : undefined;

    switch (outcome) {
      case "wrong_amount":
      case "wrong_payee":
      case "duplicate":
      case "not_a_slip":
        return { status: "rejected", reason: outcome, raw: body };
      case "clean":
        break; // fall through to field extraction + satang re-check
      default:
        // Unknown code, date-mismatch, or a generic 4xx → money-safe review.
        return { status: "unavailable", raw: body };
    }

    // outcome === "clean": pull the fields we need to record the payment.
    const d = (body?.data ?? {}) as Record<string, unknown>;
    const transRef = typeof d.transRef === "string" ? d.transRef : undefined;
    const returnedSatang = toSatang(d.amount);
    if (!transRef || returnedSatang === null) {
      // Missing the fields required to safely record a payment → review.
      return { status: "unavailable", raw: body };
    }
    // D-03: exact satang compare in OUR code, not only the vendor's condition.
    if (returnedSatang !== input.expectedAmountSatang) {
      return { status: "rejected", reason: "wrong_amount", raw: body };
    }
    // A passing checkReceiver condition means the payee matched the shop (D-02).
    return { status: "clean", transRef, amountSatang: returnedSatang, payeeOk: true, raw: body };
  }
}

/** Parse baht (number | numeric string) → integer satang; null when unparseable. */
function toSatang(amount: unknown): number | null {
  const n = typeof amount === "string" ? Number(amount) : typeof amount === "number" ? amount : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Read a JSON body defensively — never throw out of the parse. */
async function safeJson(
  res: Response,
): Promise<({ code?: string; message?: string; data?: unknown } & Record<string, unknown>) | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
