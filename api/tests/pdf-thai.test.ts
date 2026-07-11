// A1 Wave-0 RISK SPIKE (RESEARCH Pitfall 3 / §Pattern 6): prove pdfmake 0.3.11 +
// pdfkit render a VALID Thai (Sarabun) PDF Buffer under Bun 1.3 via PdfPrinter +
// on-disk TTF — BEFORE 09-packing depends on renderPackSlip / renderLabelSlip.
//
// This is NOT a "does the function return" test. It asserts the three concrete
// Pitfall-3 failure modes are ruled out:
//   1. Buffer never resolves — the pdfkit stream 'end' never fires on Bun.
//      → guarded by: Promise resolves within timeout AND the buffer ends with the
//        PDF trailer "%%EOF" (a truncated/never-ended stream has no trailer).
//   2. Empty/blank PDF.
//      → guarded by: %PDF- magic header + a non-trivial byte length.
//   3. Thai glyphs render as tofu (□) because the font silently fell back to a
//      standard-14 font instead of embedding Sarabun.
//      → guarded by: the embedded font object carries the "Sarabun" name AND the
//        PDF contains a "FontFile2" (an actual TrueType face embedded from disk).
//        Standard-14 fallback embeds NO FontFile2 — its presence is the proof the
//        on-disk Sarabun TTF was read and embedded for the Thai text.
import { describe, expect, test } from "bun:test";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { baht, renderPackSlip } from "../src/pdf/pack-slip";
import { renderLabelSlip } from "../src/pdf/label-slip";

// A one-page doc with real Thai content (the copy a pack slip would carry).
const thaiPackDoc: TDocumentDefinitions = {
  content: [
    { text: "ใบแพ็ค รอบส่ง — ผักสลัด", style: "header" },
    { text: "ลูกค้า: คุณสมชาย ใจดี", margin: [0, 4, 0, 0] },
    { text: "โซนจัดส่ง: กรุงเทพฯ (ในเมือง)", margin: [0, 2, 0, 0] },
    {
      text: [
        "รายการ: กรีนโอ๊ค 2 ถุง, เรดโครอล 1 ถุง — ",
        { text: `ยอดรวม ฿${baht(18500)}`, bold: true },
      ],
      margin: [0, 8, 0, 0],
    },
  ],
  styles: { header: { fontSize: 18, bold: true } },
};

const thaiLabelDoc: TDocumentDefinitions = {
  pageSize: "A6",
  content: [
    { text: "ป้ายพัสดุ", style: "header" },
    { text: "ผู้รับ: คุณสมหญิง รักผัก", margin: [0, 4, 0, 0] },
    { text: "โซน: นนทบุรี", margin: [0, 2, 0, 0] },
  ],
  styles: { header: { fontSize: 16, bold: true } },
};

function assertValidThaiPdf(buf: Buffer): void {
  // (2) real Buffer, non-trivial length
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(1000);
  // (2) %PDF- magic header
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // (1) stream fully flushed → trailer present ('end' fired on Bun)
  expect(buf.subarray(-1024).toString("latin1")).toContain("%%EOF");
  // (3) Sarabun embedded, not a standard-14 fallback → Thai is NOT tofu
  const raw = buf.toString("latin1");
  expect(raw).toContain("Sarabun");
  expect(raw).toContain("FontFile2");
}

describe("A1 spike: Thai PDF renders on Bun via PdfPrinter + on-disk Sarabun", () => {
  test(
    "renderPackSlip returns a valid Thai PDF buffer",
    async () => {
      const buf = await renderPackSlip(thaiPackDoc);
      assertValidThaiPdf(buf);
    },
    10_000,
  );

  test(
    "renderLabelSlip returns a valid Thai PDF buffer",
    async () => {
      const buf = await renderLabelSlip(thaiLabelDoc);
      assertValidThaiPdf(buf);
    },
    10_000,
  );

  test("baht formats integer satang as th-TH money", () => {
    expect(baht(18500)).toBe("185.00");
    expect(baht(100000)).toBe("1,000.00");
  });
});
