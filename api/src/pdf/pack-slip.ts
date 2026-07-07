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
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

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

// ── Pack-slip docDefinition builder (ORD-03 / D-20/21) ─────────────────────────
// A pack slip is the packer's picking sheet for ONE delivery round: order lines
// grouped by route (deliveryMethod/deliveryZone snapshot on the order) so the
// packer walks the queue route-by-route. Print-safe per 03-UI-SPEC: a mono grid,
// NO reliance on color for meaning (headers use weight/borders only). The doc-tree
// build mirrors notify.ts buildOrderFlex's "return a plain nested spec" style.

/** One picked line on a pack slip (order-line snapshot). */
export interface PackSlipLine {
  varietyName: string | null;
  unitLabel: string | null;
  qty: number;
  unitPriceSatang: number | null;
}

/** One order block on a pack slip, carrying its route snapshot + lines. */
export interface PackSlipOrder {
  id: string;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientAddress: string | null;
  deliveryMethod: string | null;
  deliveryZone: string | null;
  subtotalSatang: number;
  deliveryFeeSatang: number | null;
  lines: PackSlipLine[];
}

/** The full pack-slip input: a round label + its paid orders. */
export interface PackSlipInput {
  roundName: string;
  orders: PackSlipOrder[];
}

/** Human route label from the delivery snapshot (method / zone), print-safe. */
function routeLabel(method: string | null, zone: string | null): string {
  const parts = [method ?? "ไม่ระบุวิธีส่ง", zone ?? "ไม่ระบุโซน"];
  return parts.join(" / ");
}

/**
 * Build the pack-slip document definition (orders grouped by route within the
 * round). Feed the result to renderPackSlip() to get a Sarabun-embedded Buffer.
 */
export function buildPackSlipDoc(input: PackSlipInput): TDocumentDefinitions {
  // Group orders by their route snapshot (method|zone), preserving input order.
  const byRoute = new Map<string, PackSlipOrder[]>();
  for (const o of input.orders) {
    const key = `${o.deliveryMethod ?? ""}|${o.deliveryZone ?? ""}`;
    const bucket = byRoute.get(key);
    if (bucket) bucket.push(o);
    else byRoute.set(key, [o]);
  }

  const content: Content[] = [
    { text: `ใบแพ็ค — ${input.roundName}`, style: "header" },
    {
      text: `จำนวนออเดอร์ที่ต้องแพ็ค: ${input.orders.length}`,
      style: "sub",
      margin: [0, 2, 0, 8],
    },
  ];

  for (const [, routeOrders] of byRoute) {
    const first = routeOrders[0];
    content.push({
      text: `เส้นทาง: ${routeLabel(first?.deliveryMethod ?? null, first?.deliveryZone ?? null)} (${routeOrders.length} ออเดอร์)`,
      style: "route",
      margin: [0, 10, 0, 4],
    });

    for (const o of routeOrders) {
      const lineRows = o.lines.map((l) => [
        { text: l.varietyName ?? "-", style: "cell" },
        { text: l.unitLabel ?? "-", style: "cell" },
        { text: String(l.qty), style: "cellNum", alignment: "right" as const },
        {
          text: l.unitPriceSatang != null ? `฿${baht(l.unitPriceSatang)}` : "-",
          style: "cellNum",
          alignment: "right" as const,
        },
      ]);
      content.push({
        margin: [0, 4, 0, 6],
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto"],
          body: [
            [
              {
                text: `ออเดอร์ #${o.id.slice(0, 8)} — ${o.recipientName ?? "ไม่ระบุผู้รับ"} (${o.recipientPhone ?? "-"})`,
                colSpan: 4,
                style: "orderHead",
              },
              {},
              {},
              {},
            ],
            [
              { text: "รายการ", style: "th" },
              { text: "หน่วย", style: "th" },
              { text: "จำนวน", style: "th", alignment: "right" as const },
              { text: "ราคา/หน่วย", style: "th", alignment: "right" as const },
            ],
            ...lineRows,
          ],
        },
        layout: "lightHorizontalLines",
      });
    }
  }

  return {
    pageSize: "A4",
    pageMargins: [32, 32, 32, 32],
    content,
    styles: {
      header: { fontSize: 18, bold: true },
      sub: { fontSize: 12, color: "#333333" },
      route: { fontSize: 14, bold: true },
      orderHead: { fontSize: 12, bold: true, fillColor: "#f1f5ec" },
      th: { fontSize: 11, bold: true },
      cell: { fontSize: 11 },
      cellNum: { fontSize: 11 },
    },
  };
}
