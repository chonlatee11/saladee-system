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
