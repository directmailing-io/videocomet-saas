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
 */

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  fetchGoogleDocAsDocx,
  extractGoogleDocId,
} from "./google-docs";
import { loadDocx, replacePlaceholders, saveDocx } from "./docx";
import { convertDocxToPdf } from "./libreoffice";
import { pdfToPng } from "./pdf-to-image";

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
}

/**
 * Downloads, optionally personalises, and rasterises a Google Doc into a
 * page that Puppeteer can open and scroll. Returns the HTML file path plus
 * the work dir so the caller can clean up.
 */
export async function renderGDocsToHtml(
  opts: RenderGDocsToHtmlOpts,
): Promise<RenderedGDocs> {
  const docId = extractGoogleDocId(opts.docsUrl);
  const workDir =
    opts.workDir ??
    join(tmpdir(), `videocomet-gdocs-${docId.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
  await mkdir(workDir, { recursive: true });

  // 1. Download DOCX (cached by google-docs lib).
  const docxBuffer = await fetchGoogleDocAsDocx(opts.docsUrl);

  // 2. Optional placeholder substitution. We rewrite the DOCX in place so
  //    the LibreOffice conversion sees the personalised values.
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

  // 5. Wrap the pages in a Google-Docs-look-alike HTML stack.
  const html = buildGDocsHtml(pages);
  const htmlPath = join(workDir, "render.html");
  await writeFile(htmlPath, html, "utf8");

  return {
    htmlPath,
    workDir,
    pageCount: pages.length,
    docId,
  };
}

/**
 * Builds an HTML document that stacks each PDF page as an image, framed
 * with Google-Docs-style page shadows and a fixed top-toolbar mock so the
 * final render visually matches what a user sees in their browser when
 * looking at docs.google.com.
 *
 * The page widths are not hardcoded — we use 100% within a centred wrapper
 * so the layout adapts to whatever DPI the caller chose.
 */
function buildGDocsHtml(pagePaths: string[]): string {
  const imgs = pagePaths
    .map(
      (p) =>
        `<div class="page"><img src="file://${escapeAttr(p)}" alt="" draggable="false" /></div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Doc</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #F1F3F4; font-family: 'Google Sans', Roboto, Arial, sans-serif; }
  body { padding-top: 96px; }

  /* Google-Docs-Look: feste Toolbar oben. */
  .gdocs-bar {
    position: fixed; top: 0; left: 0; right: 0; height: 96px;
    background: #fff; border-bottom: 1px solid #E0E0E0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    z-index: 10;
    display: flex; flex-direction: column;
  }
  .gdocs-bar .row1 {
    flex: 0 0 56px;
    display: flex; align-items: center; gap: 16px;
    padding: 0 16px;
    border-bottom: 1px solid #F0F0F0;
  }
  .gdocs-bar .row2 {
    flex: 0 0 40px;
    display: flex; align-items: center; gap: 4px;
    padding: 0 16px;
    color: #5F6368;
    font-size: 13px;
  }
  .docs-icon {
    width: 36px; height: 36px; border-radius: 6px;
    background: #4285F4;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 14px;
    font-family: 'Google Sans', Roboto, Arial, sans-serif;
  }
  .doc-title {
    color: #202124; font-size: 18px; font-weight: 500;
    max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row1 .spacer { flex: 1; }
  .row1 .pill {
    background: #1A73E8; color: #fff; font-size: 13px; font-weight: 500;
    padding: 8px 16px; border-radius: 18px;
  }
  .menu { padding: 4px 10px; border-radius: 4px; }
  .menu:hover { background: #F1F3F4; }

  /* Doc-Fläche: zentriert, breite ~ A4. */
  .doc-stack {
    max-width: 850px;
    margin: 24px auto;
    display: flex; flex-direction: column;
    gap: 24px;
  }
  .page {
    background: #fff;
    box-shadow: 0 1px 3px rgba(60,64,67,0.16), 0 1px 2px rgba(60,64,67,0.10);
    overflow: hidden;
  }
  .page img {
    display: block; width: 100%; height: auto;
    user-select: none; -webkit-user-drag: none;
  }
</style>
</head>
<body>
<div class="gdocs-bar">
  <div class="row1">
    <div class="docs-icon">D</div>
    <div class="doc-title">Dokument</div>
    <div class="spacer"></div>
    <div class="pill">Freigeben</div>
  </div>
  <div class="row2">
    <span class="menu">Datei</span>
    <span class="menu">Bearbeiten</span>
    <span class="menu">Ansicht</span>
    <span class="menu">Einfügen</span>
    <span class="menu">Format</span>
    <span class="menu">Tools</span>
    <span class="menu">Erweiterungen</span>
    <span class="menu">Hilfe</span>
  </div>
</div>
<div class="doc-stack">
${imgs}
</div>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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
