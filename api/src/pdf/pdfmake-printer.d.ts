// Ambient types for pdfmake's SERVER-side entrypoints. @types/pdfmake only types the
// browser API (createPdf/vfs); the Node/Bun path — the PdfPrinter class + its
// URLResolver/virtual-fs collaborators (RESEARCH §Pattern 6) — is untyped in
// DefinitelyTyped. These minimal declarations type exactly what pack-slip.ts uses.

declare module "pdfmake/src/virtual-fs" {
  // Default export is a VirtualFileSystem *instance* (base.js uses it directly).
  interface VirtualFileSystem {
    existsSync(filename: string): boolean;
    readFileSync(filename: string, options?: string | { encoding?: string }): string | Buffer;
    writeFileSync(filename: string, content: string | Buffer | ArrayBuffer): void;
  }
  const virtualfs: VirtualFileSystem;
  export default virtualfs;
}

declare module "pdfmake/src/URLResolver" {
  import type virtualfs from "pdfmake/src/virtual-fs";
  export default class URLResolver {
    constructor(fs: typeof virtualfs);
    setUrlAccessPolicy(callback?: (url: string) => boolean): void;
    resolve(url: string, headers?: Record<string, string>): Promise<void>;
    resolved(): Promise<unknown[]>;
  }
}

declare module "pdfmake/src/printer" {
  import type { TDocumentDefinitions, TFontDictionary, BufferOptions } from "pdfmake/interfaces";
  import type virtualfs from "pdfmake/src/virtual-fs";
  import type URLResolver from "pdfmake/src/URLResolver";

  // The pdfkit document createPdfKitDocument resolves to — a Node readable stream.
  interface PdfKitDocument {
    on(event: "data", listener: (chunk: Buffer) => void): PdfKitDocument;
    on(event: "end", listener: () => void): PdfKitDocument;
    on(event: "error", listener: (err: Error) => void): PdfKitDocument;
    end(): void;
  }

  // pdfmake 0.3.x server constructor + ASYNC createPdfKitDocument (returns a Promise).
  export default class PdfPrinter {
    constructor(
      fontDescriptors: TFontDictionary,
      virtualFs?: typeof virtualfs,
      urlResolver?: URLResolver,
      localAccessPolicy?: ((path: string) => boolean) | undefined,
    );
    createPdfKitDocument(
      docDefinition: TDocumentDefinitions,
      options?: BufferOptions,
    ): Promise<PdfKitDocument>;
  }
}
