// Server-side Thai PDF (D-21 / ORD-03 / RESEARCH §Pattern 6, Pitfall 3, A1 spike).
//
// pdfmake's browser path ships a giant base64 `vfs_fonts` blob; server-side the
// cleaner path is `PdfPrinter` reading the Sarabun TTF straight from disk. This is
// the Wave-0 risk spike: it proves pdfmake 0.3.11 + pdfkit render a VALID Thai
// (Sarabun) PDF Buffer under Bun 1.3 (pdfkit uses Node stream/fs APIs — ~98%
// Node-compatible on Bun, must-verify). 09-packing imports renderPackSlip /
// renderLabelSlip as its contract, so the signatures here are load-bearing.
//
// Font paths are resolved from THIS module's location (import.meta.dir), not the
// process cwd — a bare "src/fonts/…" relative path only resolves when the server
// happens to run from api/, and would silently break when invoked from elsewhere
// (e.g. a worker, a test harness with a different cwd). Absolute resolution keeps
// the buffer render deterministic regardless of caller cwd.
import { join } from "node:path";
import PdfPrinter from "pdfmake/src/printer";
import virtualfs from "pdfmake/src/virtual-fs";
import URLResolver from "pdfmake/src/URLResolver";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

const FONTS_DIR = join(import.meta.dir, "..", "fonts");

// Sarabun weights 400 (normal) + 600 (SemiBold→bold) per 02-UI-SPEC typography.
// pdfmake requires all four slots; italics reuse the same faces (no Sarabun italic
// is shipped and slips never need italics).
const FONTS = {
  Sarabun: {
    normal: join(FONTS_DIR, "Sarabun-Regular.ttf"),
    bold: join(FONTS_DIR, "Sarabun-SemiBold.ttf"),
    italics: join(FONTS_DIR, "Sarabun-Regular.ttf"),
    bolditalics: join(FONTS_DIR, "Sarabun-SemiBold.ttf"),
  },
} as const;

// pdfmake 0.3.x's server-side PdfPrinter constructor is
// (fontDescriptors, virtualfs, urlResolver, localAccessPolicy). The urlResolver is
// mandatory — createPdfKitDocument() calls resolveUrls() on every font entry, and a
// missing resolver throws (`this.urlResolver.resolve` undefined). Local file-path
// fonts are a no-op for the resolver (it only fetches http/https), then PDFDocument
// reads the TTF straight from disk. localAccessPolicy = undefined ⇒ local reads
// allowed (fonts are our own committed files, not user input — no path-traversal
// surface). NOTE: 0.3.x changed createPdfKitDocument to ASYNC (returns a Promise
// of the pdfkit document), unlike the 0.2.x sync API shown in older docs.
const urlResolver = new URLResolver(virtualfs);
const printer = new PdfPrinter(FONTS, virtualfs, urlResolver, undefined);

/**
 * Money helper — mirrors notify.ts baht(satang) (55–60). Money is ALWAYS integer
 * satang; render as ฿ with Thai locale grouping + 2 decimals. Kept here so the PDF
 * lib has no import cycle back into the notify/order layer.
 */
export function baht(satang: number): string {
  return (satang / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Render a pdfmake document definition into a PDF Buffer, embedding Sarabun so Thai
 * glyphs render (not tofu). Resolves on the pdfkit stream 'end', rejects on 'error'
 * — the Pitfall-3 failure modes are (a) 'end' never firing (buffer never resolves)
 * and (b) squares instead of Thai. The smoke test asserts against both.
 */
export async function renderPackSlip(doc: TDocumentDefinitions): Promise<Buffer> {
  const pdf = await printer.createPdfKitDocument({
    ...doc,
    defaultStyle: { font: "Sarabun", ...doc.defaultStyle },
  });
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    pdf
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
    pdf.end();
  });
}
