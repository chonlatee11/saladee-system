// SlipOK adapter (D-01/D-02/D-03) — the first outbound HTTP client in the API.
// Verifies a customer's PromptPay slip against the shop's branch-linked receiving
// account and returns a narrow SlipVerifyResult the payments route can act on.
//
// Security invariants:
//   - The api key is read ONLY from validated env (env.SLIPOK_API_KEY) and rides
//     the `x-authorization` header — it is NEVER logged and NEVER placed in a body
//     (Phase-0 D-15 / T-02-24). This module logs nothing at all.
//   - Amount correctness is re-enforced HERE to the satang (D-03): even on a vendor
//     "success", we compare the returned baht amount to expectedAmountSatang and
//     reject a mismatch — we do not trust the vendor's own compare alone.
//   - Money-safety default: any UNRECOGNIZED or transient failure (network, 5xx,
//     quota, unknown code) maps to `unavailable`, which parks the order for admin
//     review (D-04) — we never auto-pay on ambiguity and never hard-reject a
//     possibly-valid payment on an unknown response.
//
// NOTE (Deferred — see SUMMARY): the numeric SlipOK error codes below are the
// documented set but could not be exercised against a live branch (no credential
// provisioned yet). They are isolated in CODE_REASON so a single constant edit
// re-maps them once verified against a real account.
import { env } from "../../env";
import type { SlipRejectReason, SlipVerifier, SlipVerifyInput, SlipVerifyResult } from "./types";

const SLIPOK_BASE = "https://api.slipok.com/api/line/apikey";

// SlipOK failure codes → our reason (or `unavailable` for transient/quota).
// Anything not listed here falls through to the money-safe `unavailable` default.
const CODE_REASON: Record<number, SlipRejectReason | "unavailable"> = {
  1002: "not_a_slip", // image is not a readable slip / invalid
  1004: "not_a_slip",
  1012: "duplicate", // slip already used (vendor-side dup; DB is the system-wide arbiter)
  1013: "unavailable", // quota / package exceeded → admin review, not a reject
  1010: "unavailable",
  1014: "wrong_amount",
  1015: "wrong_payee", // receiver / account mismatch
};

interface SlipOkOptions {
  branchId?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class SlipOkAdapter implements SlipVerifier {
  private readonly branchId: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SlipOkOptions = {}) {
    this.branchId = opts.branchId ?? env.SLIPOK_BRANCH_ID;
    this.apiKey = opts.apiKey ?? env.SLIPOK_API_KEY;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async verify(input: SlipVerifyInput): Promise<SlipVerifyResult> {
    const url = `${SLIPOK_BASE}/${this.branchId}`;
    const amountBaht = input.expectedAmountSatang / 100;

    let res: Response;
    try {
      if (input.image) {
        // Multipart: send the slip bytes. `log:true` enables the branch-linked
        // payee check + vendor duplicate detection (D-02/D-06).
        const form = new FormData();
        // WR-04: wrap in a fresh Uint8Array so the byte view is ArrayBuffer-backed
        // (Uint8Array<ArrayBuffer>) — a bare Uint8Array<ArrayBufferLike> is not a
        // valid BlobPart under the DOM lib, failing the vue-tsc typecheck gate.
        // Runtime behaviour is unchanged (Bun already accepted the view).
        form.append("files", new Blob([new Uint8Array(input.image)], { type: "image/jpeg" }), "slip.jpg");
        form.append("amount", String(amountBaht));
        form.append("log", "true");
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "x-authorization": this.apiKey }, // key: header only, never body/log
          body: form,
        });
      } else {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "x-authorization": this.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ data: input.qrPayload, amount: amountBaht, log: true }),
        });
      }
    } catch {
      // Network / DNS / abort → vendor unreachable → admin review (D-04).
      return { status: "unavailable" };
    }

    const body = await safeJson(res);

    // Non-2xx OR an explicit vendor failure → classify from the code.
    if (!res.ok || (body && body.success === false)) {
      return classifyFailure(res.status, body);
    }

    // Success shape may be flat or nested under `data`.
    const d = (body?.data ?? body ?? {}) as Record<string, unknown>;
    const transRef = typeof d.transRef === "string" ? d.transRef : undefined;
    const returnedSatang = toSatang(d.amount);

    if (!transRef || returnedSatang === null) {
      // Missing the fields we require to safely record a payment → review.
      return { status: "unavailable", raw: body };
    }
    // D-03: exact satang compare in OUR code, not only the vendor's.
    if (returnedSatang !== input.expectedAmountSatang) {
      return { status: "rejected", reason: "wrong_amount", raw: body };
    }
    // A branch-linked success means the payee matched the shop's account (D-02).
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
async function safeJson(res: Response): Promise<{ success?: boolean; code?: number; data?: unknown } & Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Map a vendor failure onto the result union. Quota/5xx/unknown → unavailable. */
function classifyFailure(httpStatus: number, body: Record<string, unknown> | null): SlipVerifyResult {
  // Transport-level transient conditions are always review, never reject.
  if (httpStatus === 429 || httpStatus >= 500) return { status: "unavailable", raw: body };

  const code = typeof body?.code === "number" ? body.code : undefined;
  const mapped = code !== undefined ? CODE_REASON[code] : undefined;
  switch (mapped) {
    case "wrong_amount":
    case "wrong_payee":
    case "duplicate":
    case "not_a_slip":
      return { status: "rejected", reason: mapped, raw: body };
    case "unavailable":
      return { status: "unavailable", raw: body };
    default:
      // Unknown code on a 4xx → money-safe: park for admin, do not hard-reject.
      return { status: "unavailable", raw: body };
  }
}
