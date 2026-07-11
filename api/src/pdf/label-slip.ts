// Label slip PDF (D-21 / ORD-03) — sibling of pack-slip.ts. Same PdfPrinter +
// on-disk Sarabun path (RESEARCH §Pattern 6); a label is a small per-parcel slip
// (recipient + zone), a pack slip is the full picking sheet. Both render a Thai
// PDF Buffer under Bun. 09-packing imports renderLabelSlip as its contract, so the
// signature is load-bearing — keep it identical in shape to renderPackSlip.
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { renderPackSlip } from "./pack-slip";

/**
 * Render a label document definition into a PDF Buffer with Sarabun embedded. The
 * printer/font registration lives in pack-slip.ts (single PdfPrinter instance);
 * this reuses the same render seam so both slips share one proven Thai-PDF path.
 */
export function renderLabelSlip(doc: TDocumentDefinitions): Promise<Buffer> {
  return renderPackSlip(doc);
}

// ── Label-slip docDefinition builder (ORD-03 / D-21) ───────────────────────────
// A label is a small per-parcel slip: recipient + address + zone + round, sized
// A6 for a shipping label. Thai + print-safe (weight/borders only, no color for
// meaning), same voice as the pack slip. PDPA: the label carries a customer
// address — the endpoint that renders it is packer-gated and never cached (T-03-24).

/** The by-value payload a label slip needs (order + delivery snapshot). */
export interface LabelSlipInput {
  id: string;
  roundName: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  deliveryMethod: string | null;
  deliveryZone: string | null;
}

/**
 * Build the label-slip document definition (one parcel). Feed the result to
 * renderLabelSlip() to get a Sarabun-embedded Buffer.
 */
export function buildLabelSlipDoc(input: LabelSlipInput): TDocumentDefinitions {
  return {
    pageSize: "A6",
    pageMargins: [24, 24, 24, 24],
    content: [
      { text: "ป้ายส่ง", style: "header" },
      { text: `รอบส่ง: ${input.roundName}`, style: "meta", margin: [0, 6, 0, 0] },
      {
        text: `โซน: ${input.deliveryZone ?? "ไม่ระบุ"} · ${input.deliveryMethod ?? "ไม่ระบุวิธีส่ง"}`,
        style: "meta",
        margin: [0, 2, 0, 8],
      },
      { text: "ผู้รับ", style: "label" },
      { text: input.recipientName ?? "ไม่ระบุผู้รับ", style: "recipient" },
      { text: `โทร: ${input.recipientPhone ?? "-"}`, style: "meta", margin: [0, 2, 0, 6] },
      { text: "ที่อยู่จัดส่ง", style: "label" },
      { text: input.recipientAddress ?? "-", style: "address" },
      {
        text: `ออเดอร์ #${input.id.slice(0, 8)}`,
        style: "meta",
        margin: [0, 10, 0, 0],
      },
    ],
    styles: {
      header: { fontSize: 18, bold: true },
      label: { fontSize: 11, bold: true, color: "#333333", margin: [0, 4, 0, 0] },
      recipient: { fontSize: 16, bold: true },
      address: { fontSize: 13 },
      meta: { fontSize: 11, color: "#333333" },
    },
  };
}
