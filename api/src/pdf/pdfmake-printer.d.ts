// Ambient types for pdfmake's SERVER-side entrypoint. @types/pdfmake only types the
// browser API (createPdf/vfs); the Node/Bun path — `pdfmake/src/printer`, the
// PdfPrinter class that reads TTF from disk (RESEARCH §Pattern 6) — is untyped in
// DefinitelyTyped. This minimal declaration types exactly what pack-slip.ts uses:
// the constructor (font dictionary) and createPdfKitDocument → a pdfkit document,
// which is a Node stream (has .on / .end).
declare module "pdfmake/src/printer" {
  import type { TDocumentDefinitions, TFontDictionary, BufferOptions } from "pdfmake/interfaces";

  interface PdfKitDocument {
    on(event: "data", listener: (chunk: Buffer) => void): PdfKitDocument;
    on(event: "end", listener: () => void): PdfKitDocument;
    on(event: "error", listener: (err: Error) => void): PdfKitDocument;
    end(): void;
  }

  export default class PdfPrinter {
    constructor(fonts: TFontDictionary);
    createPdfKitDocument(docDefinition: TDocumentDefinitions, options?: BufferOptions): PdfKitDocument;
  }
}
