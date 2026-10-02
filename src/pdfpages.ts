// A PDF's pages, as JPEGs the model can read.
//
// The model takes images, not documents — and reading a page as an image is
// what recovers the notation text extraction drops (CLAUDE.md: "Reading a
// paper as pages, when extraction is not enough"). So a PDF a teacher attaches
// to Seyari AI is rendered page by page in the browser and sent as the same
// base64 JPEGs a photograph would be. Nothing is uploaded until the pages are
// pixels, and the PDF itself never leaves the phone.
//
// pdf.js is imported DYNAMICALLY, so it lives in its own chunk and costs a
// phone nothing until a PDF is actually chosen. Its worker is bundled by Vite
// as a same-origin asset (`?url`), which the strict `script-src 'self'`
// already allows — no CSP change, no CDN.

import { encodeJpeg } from "./answerphotos";

/** The longest edge a rendered page is given, matching an answer photo. */
const PAGE_EDGE = 1600;

export interface PdfPages {
  /** Base64 JPEGs, no `data:` prefix, in page order. */
  pages: string[];
  /** How many pages the document has, so the panel can say "first 10 of 23". */
  total: number;
}

/**
 * Render up to `maxPages` pages of `file`. Pages past the cap are not rendered
 * at all — the cap is there to bound the bill, so the work stops at it too.
 */
export async function pdfPagesToJpeg(file: File, maxPages: number): Promise<PdfPages> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // pdf.js 5 uses no `eval` (the old `isEvalSupported` switch is gone), so
  // the strict `script-src` holds with nothing to turn off.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = doc.numPages;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(total, maxPages); n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_EDGE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot render the PDF");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push(encodeJpeg(canvas));
    page.cleanup();
  }
  await doc.destroy();
  return { pages, total };
}
