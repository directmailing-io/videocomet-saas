/**
 * Google-Docs render pipeline (gemeinsam für Modal-Vorschau + Worker-Render).
 *
 * Idee: Wir wollen pixel-genau aussehen wie der echte Google-Docs-Output
 * (Seitenränder, Schriftarten, Bilder, Tabellen — alles). Das schaffen
 * weder die HTML-Export-Variante (zu plain) noch ein iframe (Cross-Origin).
 *
 * Lösung: DOCX downloaden → optional Platzhalter ersetzen → mit LibreOffice
 * zu PDF konvertieren → mit Poppler zu PNGs rastern → in einer HTML-Seite
 * untereinander stacken (mit Google-Docs-Style-Frame + Shadow). Das
 * Resultat ist ein langes Bild, das in Puppeteer beliebig gescrollt werden
 * kann; Modal und Render-Worker nutzen die exakt gleiche Pipeline und
 * damit das gleiche Layout — Scroll-ratios passen 1:1.
 *
 * Performance: LibreOffice braucht 5-15s pro Konvertierung. Das ist okay
 * für eine Lead-Pipeline; für die Modal-Vorschau cachen wir das Ergebnis
 * pro URL für 5 Minuten via `gdocs-render-cache.ts`.
 *
 * Zwei Output-Varianten:
 *   - `renderGDocsToHtml` (lokal, file://) — für Worker & Lead-Render.
 *   - `renderGDocsToBunnyHostedHtml` — lädt Page-PNGs + HTML nach Bunny
 *     hoch, damit das Modal das identische Markup via iframe öffnen kann.
 */

import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { open as openFile } from "node:fs/promises";
import {
  fetchGoogleDocAsDocx,
  extractGoogleDocId,
} from "./google-docs";
import { loadDocx, replacePlaceholders, saveDocx } from "./docx";
import { convertDocxToPdf } from "./libreoffice";
import { pdfToPng } from "./pdf-to-image";
import {
  getGDocsToolbarCss,
  getGDocsToolbarHtml,
} from "./gdocs-toolbar-html";
import { uploadFile } from "@/lib/bunny/storage";

/** Doc-stack max width in CSS pixels. Must match the value used in the HTML. */
export const GDOCS_DOC_WIDTH_PX = 850;
/** Gap between stacked pages, in CSS pixels. Must match the HTML. */
export const GDOCS_PAGE_GAP_PX = 24;
/** Total fixed toolbar height (title 44 + menu 32 + format 40 + ruler 24 + ~20 padding). */
export const GDOCS_TOOLBAR_HEIGHT_PX = 160;

export interface RenderedGDocs {
  /** Absolute path to the HTML page that wraps the rendered PNGs. */
  htmlPath: string;
  /** Absolute path to the work directory (caller decides when to clean up). */
  workDir: string;
  /** Page count. */
  pageCount: number;
  /** docId derived from the URL — useful as a cache key. */
  docId: string;
}

export interface RenderGDocsToHtmlOpts {
  docsUrl: string;
  /** When supplied, every `{{key}}` in the DOCX is replaced before conversion. */
  vars?: Record<string, string>;
  /** Reuse an existing work dir (skip cleanup). Default: fresh tmp dir. */
  workDir?: string;
  /** DPI for the PNG rasterisation. Default 150. */
  dpi?: number;
  /** Optional doc title shown in the toolbar. */
  docTitle?: string;
}

/** Internal: results of the shared docx→pdf→png step. */
interface ComposeResult {
  workDir: string;
  pages: string[]; // absolute local PNG paths
  docId: string;
}

/**
 * Internal helper: runs the DOCX → PDF → PNG pipeline. Both the local-HTML
 * and the Bunny-hosted variant call this; only the HTML wrapping step
 * differs (file:// vs https://).
 */
async function composePdfToPages(opts: {
  docsUrl: string;
  vars?: Record<string, string>;
  workDir?: string;
  dpi?: number;
}): Promise<ComposeResult> {
  const docId = extractGoogleDocId(opts.docsUrl);
  const workDir =
    opts.workDir ??
    join(
      tmpdir(),
      `videocomet-gdocs-${docId.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
    );
  await mkdir(workDir, { recursive: true });

  // 1. Download DOCX (cached by google-docs lib).
  const docxBuffer = await fetchGoogleDocAsDocx(opts.docsUrl);

  // 2. Optional placeholder substitution.
  let processedDocx = docxBuffer;
  if (opts.vars && Object.keys(opts.vars).length > 0) {
    const loaded = loadDocx(docxBuffer);
    replacePlaceholders(loaded.zip, opts.vars);
    processedDocx = saveDocx(loaded.zip);
  }

  const docxPath = join(workDir, "doc.docx");
  await writeFile(docxPath, processedDocx);

  // 3. DOCX -> PDF via LibreOffice.
  const pdfPath = await convertDocxToPdf({
    inputPath: docxPath,
    outputDir: workDir,
    timeoutMs: 60_000,
  });

  // 4. PDF -> PNG sequence via Poppler.
  const { pages } = await pdfToPng({
    pdfPath,
    outDir: workDir,
    dpi: opts.dpi ?? 150,
  });

  if (pages.length === 0) {
    throw new Error("[gdocs-render-pipeline] pdftoppm produced zero pages");
  }

  return { workDir, pages, docId };
}

/**
 * Downloads, optionally personalises, and rasterises a Google Doc into a
 * page that Puppeteer can open and scroll locally via file://. Returns the
 * HTML file path plus the work dir so the caller can clean up.
 */
export async function renderGDocsToHtml(
  opts: RenderGDocsToHtmlOpts,
): Promise<RenderedGDocs> {
  const composed = await composePdfToPages({
    docsUrl: opts.docsUrl,
    vars: opts.vars,
    workDir: opts.workDir,
    dpi: opts.dpi,
  });

  // Wrap the local file:// paths in the shared HTML wrapper.
  const urls = composed.pages.map((p) => `file://${p}`);
  const html = buildGDocsHtml(urls, { docTitle: opts.docTitle });
  const htmlPath = join(composed.workDir, "render.html");
  await writeFile(htmlPath, html, "utf8");

  return {
    htmlPath,
    workDir: composed.workDir,
    pageCount: composed.pages.length,
    docId: composed.docId,
  };
}

/* -------------------------------------------------------------------------- */
/* Bunny-hosted variant                                                       */
/* -------------------------------------------------------------------------- */

export interface RenderToBunnyOpts {
  docsUrl: string;
  vars?: Record<string, string>;
  /** Storage prefix used to upload pages + html. e.g. "screenshots/<jobId>". */
  storagePrefix: string;
  /** Optional doc title shown in the toolbar. */
  docTitle?: string;
  /** DPI for the PNG rasterisation. Default 150. */
  dpi?: number;
}

export interface BunnyHostedRenderResult {
  /** Public Bunny CDN URL to the HTML wrapper. */
  htmlUrl: string;
  /** Public Bunny CDN URLs of each page PNG, in page order. */
  pageUrls: string[];
  /** CSS pixel width each page will render at in the wrapper. */
  docWidth: number;
  /**
   * Sum of rendered page heights + (pageCount - 1) * GAP. Excludes the
   * fixed toolbar — this is what `iframe.scrollHeight - toolbar` will be.
   */
  docHeight: number;
  /** Number of pages. */
  pageCount: number;
}

/**
 * Reads the first 24 bytes of a PNG and returns its width/height. PNG
 * dimensions live in the IHDR chunk: width @ offset 16, height @ offset 20,
 * each as big-endian uint32. We avoid pulling in `sharp` for one-shot dim
 * reads.
 */
async function readPngDimensions(
  pngPath: string,
): Promise<{ width: number; height: number }> {
  const fh = await openFile(pngPath, "r");
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    // Quick PNG signature check.
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      throw new Error(`[gdocs-render-pipeline] not a PNG: ${pngPath}`);
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } finally {
    await fh.close();
  }
}

/**
 * Full pipeline: docx → pdf → pngs → upload pngs → render HTML →
 * upload HTML → return CDN URLs + dims. Cleans up the local work dir.
 */
export async function renderGDocsToBunnyHostedHtml(
  opts: RenderToBunnyOpts,
): Promise<BunnyHostedRenderResult> {
  const composed = await composePdfToPages({
    docsUrl: opts.docsUrl,
    vars: opts.vars,
    dpi: opts.dpi,
  });

  // Strip leading/trailing slashes; mirrors `uploadFile`'s normalisation but
  // we also need a clean prefix string ourselves for building remote paths.
  const prefix = opts.storagePrefix.replace(/^\/+/, "").replace(/\/+$/, "");

  try {
    // 1. Measure + upload each page PNG.
    const pageUrls: string[] = [];
    let totalRenderedHeight = 0;
    const targetWidth = GDOCS_DOC_WIDTH_PX;

    for (let i = 0; i < composed.pages.length; i++) {
      const pagePath = composed.pages[i];
      const remotePath = `${prefix}/page-${i + 1}.png`;
      const [stats, dims, buffer] = await Promise.all([
        stat(pagePath),
        readPngDimensions(pagePath),
        readFile(pagePath),
      ]);
      void stats;

      const renderedHeight = dims.width > 0
        ? Math.round((dims.height * targetWidth) / dims.width)
        : dims.height;
      totalRenderedHeight += renderedHeight;

      const uploaded = await uploadFile({
        buffer,
        remotePath,
        contentType: "image/png",
      });
      pageUrls.push(uploaded.url);
    }

    // 2. Build the HTML referencing the absolute Bunny URLs.
    const html = buildGDocsHtml(pageUrls, { docTitle: opts.docTitle });

    // 3. Upload the HTML wrapper. Bunny storage serves the file with the
    // content-type we set here; the modal iframe will get a proper text/html
    // response.
    const htmlRemotePath = `${prefix}/preview.html`;
    const htmlUpload = await uploadFile({
      buffer: Buffer.from(html, "utf8"),
      remotePath: htmlRemotePath,
      contentType: "text/html; charset=utf-8",
    });

    const docHeight =
      totalRenderedHeight +
      Math.max(0, composed.pages.length - 1) * GDOCS_PAGE_GAP_PX;

    return {
      htmlUrl: htmlUpload.url,
      pageUrls,
      docWidth: targetWidth,
      docHeight,
      pageCount: composed.pages.length,
    };
  } finally {
    // Always clean up the local work dir — we don't need the PNGs/PDF/DOCX
    // any more once they're on the CDN.
    await cleanupRenderedGDocs(composed.workDir);
  }
}

/* -------------------------------------------------------------------------- */
/* HTML wrapper                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Builds an HTML document that stacks each page image (file:// OR https://)
 * in a Google-Docs-style frame. Caller supplies the URLs — the function is
 * agnostic about the source.
 *
 * Layout:
 *   - Fixed toolbar (~160px) at the top, opaque white.
 *   - Body padding-top reserves toolbar height.
 *   - `.gd-doc-stack` is a vertical column centered at max-width 850.
 *   - Each page is `<img>` at width:100%, white background, shadow, gap 24px.
 */
export function buildGDocsHtml(
  pageImageUrls: string[],
  opts?: { docTitle?: string },
): string {
  const imgs = pageImageUrls
    .map(
      (url) =>
        `<div class="gd-page"><img src="${escapeAttr(url)}" alt="" draggable="false" /></div>`,
    )
    .join("\n");

  const toolbarHtml = getGDocsToolbarHtml({ docTitle: opts?.docTitle });
  const toolbarCss = getGDocsToolbarCss();

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts?.docTitle ?? "Dokument")}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--gd-bg, #F1F3F4);
    font-family: 'Google Sans', 'Google Sans Text', 'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    color: #202124;
  }
  body {
    padding-top: ${GDOCS_TOOLBAR_HEIGHT_PX}px;
    min-height: 100vh;
  }
  ${toolbarCss}

  /* Doc-Fläche: zentriert, breite ~ A4. */
  .gd-doc-stack {
    max-width: ${GDOCS_DOC_WIDTH_PX}px;
    margin: 24px auto;
    padding: 0 12px;
    display: flex;
    flex-direction: column;
    gap: ${GDOCS_PAGE_GAP_PX}px;
  }
  .gd-page {
    background: #fff;
    box-shadow: var(--gd-page-shadow);
    overflow: hidden;
    border-radius: 1px;
  }
  .gd-page img {
    display: block;
    width: 100%;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }
</style>
</head>
<body>
${toolbarHtml}
<div class="gd-doc-stack">
${imgs}
</div>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Best-effort cleanup of a work dir produced by `renderGDocsToHtml`.
 */
export async function cleanupRenderedGDocs(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Reads the rendered HTML so the caller can stream it as a response.
 * (Used by the screenshot processor — Puppeteer can also load it directly
 * from disk via `file://`, but having both options is useful.)
 */
export async function readRenderedGDocsHtml(htmlPath: string): Promise<string> {
  return readFile(htmlPath, "utf8");
}
