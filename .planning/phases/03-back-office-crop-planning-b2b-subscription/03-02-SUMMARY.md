---
phase: 03-back-office-crop-planning-b2b-subscription
plan: 02
subsystem: api
tags: [pdfmake, pdfkit, thai-font, sarabun, bun, pdf, spike]

# Dependency graph
requires:
  - phase: 02-commerce-core
    provides: notify.ts baht(satang) money-format helper + doc-tree build style
provides:
  - "renderPackSlip(doc): Promise<Buffer> — server-side Thai PDF via PdfPrinter + on-disk Sarabun TTF"
  - "renderLabelSlip(doc): Promise<Buffer> — sibling reusing the same PdfPrinter seam"
  - "Sarabun-Regular.ttf / Sarabun-SemiBold.ttf committed under api/src/fonts/ (SIL OFL)"
  - "A1 Wave-0 risk gate CLEARED — pdfmake 0.3.11 proven to render Thai on Bun 1.3"
affects: [03-09-packing, invoice-pdf, PAY-04]

# Tech tracking
tech-stack:
  added: [pdfmake@0.3.11, "@types/pdfmake@0.3.3"]
  patterns:
    - "Server-side Thai PDF: PdfPrinter + URLResolver + virtual-fs, on-disk TTF (NOT vfs base64 blob)"
    - "pdfmake 0.3.x createPdfKitDocument is ASYNC (await) — differs from 0.2.x sync docs"
    - "Ambient .d.ts for untyped server entrypoints (pdfmake/src/printer, /URLResolver, /virtual-fs)"

key-files:
  created:
    - api/src/pdf/pack-slip.ts
    - api/src/pdf/label-slip.ts
    - api/src/pdf/pdfmake-printer.d.ts
    - api/src/fonts/Sarabun-Regular.ttf
    - api/src/fonts/Sarabun-SemiBold.ttf
    - api/tests/pdf-thai.test.ts
  modified:
    - api/package.json

key-decisions:
  - "PdfPrinter + on-disk TTF (RESEARCH §Pattern 6) — vfs fallback NOT needed, spike passed cleanly"
  - "Font paths resolved from import.meta.dir (module-relative), not process cwd — robust across callers"
  - "localAccessPolicy = undefined (allow local reads) — fonts are our own committed files, no user-path surface"

patterns-established:
  - "Thai PDF render seam: pack-slip.ts owns the single PdfPrinter; label-slip delegates to it"
  - "Smoke test proves render (not just return): %PDF- header + %%EOF trailer + embedded Sarabun/FontFile2"

requirements-completed: [ORD-03]

coverage:
  - id: D1
    description: "renderPackSlip/renderLabelSlip render a valid Thai (Sarabun) PDF Buffer on Bun via PdfPrinter + on-disk TTF (A1 spike)"
    requirement: "ORD-03"
    verification:
      - kind: unit
        ref: "api/tests/pdf-thai.test.ts#renderPackSlip returns a valid Thai PDF buffer"
        status: pass
      - kind: unit
        ref: "api/tests/pdf-thai.test.ts#renderLabelSlip returns a valid Thai PDF buffer"
        status: pass
    human_judgment: false
  - id: D2
    description: "baht(satang) formats integer satang as th-TH money for PDF docs"
    verification:
      - kind: unit
        ref: "api/tests/pdf-thai.test.ts#baht formats integer satang as th-TH money"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-07
status: complete
---

# Phase 3 Plan 02: Wave-0 Thai-PDF Risk Spike Summary

**Proved pdfmake 0.3.11 renders Thai (Sarabun) PDF Buffers on Bun 1.3 via PdfPrinter + on-disk TTF — A1, the phase's highest risk, is cleared and 09-packing can depend on renderPackSlip/renderLabelSlip.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-07 (execution)
- **Completed:** 2026-07-07
- **Tasks:** 2
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- **A1 spike PASS:** Thai text renders on Bun — 5069-byte buffer, `%PDF-` header, `%%EOF` trailer, embedded `Sarabun` + `FontFile2` (real TTF, not tofu/standard-14 fallback). No vfs fallback needed.
- `renderPackSlip` / `renderLabelSlip` exported as the stable contract for 03-09 packing.
- Real Sarabun TTF (Regular 400 + SemiBold 600, SIL OFL, 90 KB each) committed under `api/src/fonts/`.
- Smoke test asserts actual Thai rendering (font-embedding + stream-completion), not just that a function returns.

## Task Commits

Each task was committed atomically:

1. **Task 1: pdfmake + Sarabun TTF + PdfPrinter render lib** - `98fa325` (feat)
2. **Task 2: Thai PDF smoke test (A1 gate) + 0.3.x server-API fix** - `87a1d4e` (test)

## Files Created/Modified
- `api/src/pdf/pack-slip.ts` - PdfPrinter registration (Sarabun) + `renderPackSlip(doc): Promise<Buffer>` + `baht(satang)` helper
- `api/src/pdf/label-slip.ts` - `renderLabelSlip(doc): Promise<Buffer>` delegating to the shared PdfPrinter seam
- `api/src/pdf/pdfmake-printer.d.ts` - Ambient types for untyped server entrypoints (`pdfmake/src/printer`, `/URLResolver`, `/virtual-fs`)
- `api/src/fonts/Sarabun-Regular.ttf`, `Sarabun-SemiBold.ttf` - SIL OFL Thai font faces
- `api/tests/pdf-thai.test.ts` - A1 smoke test (3 cases, all green)
- `api/package.json` - added pdfmake@0.3.11 + @types/pdfmake dev dep

## Decisions Made
- Used `PdfPrinter` + on-disk TTF exactly per RESEARCH §Pattern 6. The documented vfs base64 fallback was **not** needed — the spike passed on the first (corrected) construction.
- Font paths resolved via `import.meta.dir` rather than the plan's literal `"src/fonts/…"` cwd-relative strings, so the render works regardless of the caller's cwd (a worker or test harness with a different cwd would otherwise silently fail to find the font).
- `localAccessPolicy = undefined` (local file reads allowed): fonts are our own committed assets, not user input, so there is no path-traversal surface to gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pdfmake 0.3.x server API differs from the plan/RESEARCH snippet**
- **Found during:** Task 2 (smoke test — initial run failed with `pdf.on is not a function`)
- **Issue:** The RESEARCH §Pattern 6 snippet uses the pdfmake 0.2.x API: `new PdfPrinter(fonts)` and a synchronous `createPdfKitDocument` returning a stream. In 0.3.11 the constructor is `(fontDescriptors, virtualfs, urlResolver, localAccessPolicy)` and `createPdfKitDocument` is **async** (returns `Promise<PDFDocument>`). Omitting the urlResolver threw `this.urlResolver.resolve is undefined`; treating the result as a stream threw `pdf.on is not a function`.
- **Fix:** Construct `new URLResolver(virtualfs)` and pass `(FONTS, virtualfs, urlResolver, undefined)`; `await` `createPdfKitDocument` before attaching stream handlers. Added the four font slots (normal/bold/italics/bolditalics) pdfmake requires.
- **Files modified:** api/src/pdf/pack-slip.ts, api/src/pdf/pdfmake-printer.d.ts
- **Verification:** `bun test tests/pdf-thai.test.ts` → 3 pass; `bunx tsc --noEmit` clean
- **Committed in:** `87a1d4e` (Task 2 commit)

**2. [Rule 3 - Blocking] @types/pdfmake does not type the server-side entrypoints**
- **Found during:** Task 1 (typecheck failed: `Cannot find module 'pdfmake/src/printer'`)
- **Issue:** DefinitelyTyped only types pdfmake's browser API (`createPdf`/vfs); the Node/Bun `pdfmake/src/printer` (+ `/URLResolver`, `/virtual-fs`) are untyped.
- **Fix:** Added a minimal ambient declaration `api/src/pdf/pdfmake-printer.d.ts` typing exactly what the render lib uses.
- **Files modified:** api/src/pdf/pdfmake-printer.d.ts
- **Verification:** `bunx tsc --noEmit` clean
- **Committed in:** `98fa325` (Task 1) then refined in `87a1d4e` (Task 2)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Both fixes were required to complete the spike and reflect a documented library-version reality (0.3.x vs the 0.2.x snippet). No scope creep — the exported contract (renderPackSlip/renderLabelSlip signatures) is unchanged; only the internal construction adapted to the installed version. `signatures return Promise<Buffer>` as the plan specifies.

## Issues Encountered
- Fonts downloaded from `github.com/google/fonts/ofl/sarabun/` (SIL OFL). Verified as real TrueType data (`file` reports "TrueType Font data ... Copyright 2018 The Sarabun Project Authors"), 90 KB each — not placeholders.

## User Setup Required
None — the Sarabun fonts are committed to the repo; no external service or env var is required for PDF rendering.

## Next Phase Readiness
- **A1 (highest-risk item of Phase 3) is de-risked.** 03-09 packing can import `renderPackSlip`/`renderLabelSlip` with confidence they produce valid Thai PDF Buffers on Bun.
- The same seam is reusable for the invoice PDF (PAY-04 / D-21).
- No blockers.

## Self-Check: PASSED
- api/src/pdf/pack-slip.ts — FOUND
- api/src/pdf/label-slip.ts — FOUND
- api/src/pdf/pdfmake-printer.d.ts — FOUND
- api/src/fonts/Sarabun-Regular.ttf — FOUND
- api/src/fonts/Sarabun-SemiBold.ttf — FOUND
- api/tests/pdf-thai.test.ts — FOUND
- Commit 98fa325 — FOUND
- Commit 87a1d4e — FOUND

---
*Phase: 03-back-office-crop-planning-b2b-subscription*
*Completed: 2026-07-07*
