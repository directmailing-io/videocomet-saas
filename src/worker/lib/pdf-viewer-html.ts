/**
 * Drive-Style PDF-Viewer-Chrome (Toolbar + Seiten-Stack-HTML).
 *
 * Rendert ein self-contained HTML-Fragment + CSS, das optisch dem
 * Google-Drive-/Chrome-PDF-Viewer entspricht: dunkle Toolbar oben
 * (Dateiname links, "Seite 1 / N"-Anzeige, dezente Zoom-/Aktions-Icons
 * rechts — reine Optik, keine Funktion), darunter weiße Seiten mit
 * Abstand auf dunkelgrauem Grund.
 *
 * Struktur-Vorbild ist `gdocs-toolbar-html.ts` / `gdocs-render-pipeline.ts`:
 * kein React/JSX, keine externen Font-/Icon-Requests (Icons sind Inline-
 * SVG-Strings), Seitenbreite + Gap identisch zur GDocs-Pipeline (850px /
 * 24px), damit der Look über alle Dokument-Segmente konsistent bleibt.
 *
 * Höhen-Konvention: Der Puppeteer-Viewport läuft mit deviceScaleFactor 1
 * (siehe pdf-segment-render.ts) — CSS-Pixel == Device-Pixel. Die GDocs-
 * Toolbar ist 160px hoch, weil sie 4 Zeilen stapelt (Titel/Menü/Format/
 * Lineal); der Drive-PDF-Viewer hat nur EINE dunkle Leiste, daher 56px.
 */

import {
  DOC_STACK_MAX_WIDTH_PX,
  DOC_STACK_HPAD_PX,
  DOC_PAGE_GAP_PX,
  PDF_TOOLBAR_HEIGHT_PX as SHARED_PDF_TOOLBAR_HEIGHT_PX,
} from "@/lib/segments/doc-geometry";

export interface PdfToolbarOptions {
  /** Sichtbarer Dateiname in der Toolbar (wird HTML-escaped). */
  fileName: string;
  /** Seitenanzahl für die "Seite 1 / N"-Anzeige. */
  pageCount: number;
}

/**
 * Höhe der fixen PDF-Toolbar in CSS-Pixeln (bei deviceScaleFactor 1
 * identisch zu Device-Pixeln — gleiche Konvention wie
 * `GDOCS_TOOLBAR_HEIGHT_PX` in gdocs-render-pipeline.ts).
 */
export const PDF_TOOLBAR_HEIGHT_PX = SHARED_PDF_TOOLBAR_HEIGHT_PX;

/** Seiten-Stack max-width in CSS-Pixeln — identisch zur GDocs-Pipeline. */
export const PDF_DOC_WIDTH_PX = DOC_STACK_MAX_WIDTH_PX;
/** Abstand zwischen gestapelten Seiten — identisch zur GDocs-Pipeline. */
export const PDF_PAGE_GAP_PX = DOC_PAGE_GAP_PX;

/**
 * Hintergrund der Dokument-Fläche (Drive-/Chrome-PDF-Viewer-Grau).
 * Muss mit dem sharp-Compose-Hintergrund in pdf-segment-render.ts
 * übereinstimmen.
 */
export const PDF_VIEWER_BG = { r: 82, g: 86, b: 89 } as const; // #525659

/* -------------------------------------------------------------------------- */
/* Inline-SVG-Icons (24x24 viewBox, currentColor — reine Optik).              */
/* -------------------------------------------------------------------------- */

// Rotes PDF-Datei-Icon (vereinfachtes Drive-Look-Tile mit Eselsohr).
const PDF_FILE_ICON = `
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#EA4335"/>
  <path d="M14 2l5 5h-4a1 1 0 0 1-1-1V2z" fill="#F5B7B1"/>
  <text x="12" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.5" font-weight="bold" fill="#fff">PDF</text>
</svg>`;

const ICON_ZOOM_OUT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_ZOOM_IN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_FIT_PAGE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><polyline points="9 9 12 6 15 9"/><polyline points="9 15 12 18 15 15"/></svg>';
const ICON_PRINT =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><rect x="6" y="14" width="12" height="7"/></svg>';
const ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/></svg>';
const ICON_MORE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';

/* -------------------------------------------------------------------------- */
/* Escaping                                                                   */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Liefert das Toolbar-HTML-Fragment. Ein einzelnes
 * `<div class="pdfv-toolbar">…</div>`-Root, das der Caller direkt in den
 * `<body>` vor den Seiten-Stack setzt (analog `getGDocsToolbarHtml`).
 */
export function buildPdfToolbarHtml(opts: PdfToolbarOptions): string {
  const name = escapeHtml(opts.fileName || "Dokument.pdf");
  const pages = Math.max(1, Math.floor(opts.pageCount) || 1);

  return `<div class="pdfv-toolbar" role="region" aria-label="PDF Toolbar">
    <div class="pdfv-left">
      <span class="pdfv-file-icon">${PDF_FILE_ICON}</span>
      <span class="pdfv-filename">${name}</span>
    </div>
    <div class="pdfv-center">
      <span class="pdfv-pageinfo">Seite&nbsp;<span class="pdfv-pageinfo-current">1</span>&nbsp;/&nbsp;${pages}</span>
    </div>
    <div class="pdfv-right">
      <button type="button" class="pdfv-icon-btn" title="Verkleinern">${ICON_ZOOM_OUT}</button>
      <span class="pdfv-zoom-value">100&nbsp;%</span>
      <button type="button" class="pdfv-icon-btn" title="Vergrößern">${ICON_ZOOM_IN}</button>
      <span class="pdfv-vdivider" aria-hidden="true"></span>
      <button type="button" class="pdfv-icon-btn" title="An Seite anpassen">${ICON_FIT_PAGE}</button>
      <button type="button" class="pdfv-icon-btn" title="Drucken">${ICON_PRINT}</button>
      <button type="button" class="pdfv-icon-btn" title="Herunterladen">${ICON_DOWNLOAD}</button>
      <button type="button" class="pdfv-icon-btn" title="Weitere Aktionen">${ICON_MORE}</button>
    </div>
  </div>`;
}

/**
 * Toolbar- + Viewer-CSS, gescoped auf `.pdfv-*`-Selektoren. Wird als
 * `<style>`-Block in das Host-HTML inline eingebettet.
 */
export function getPdfViewerCss(): string {
  return `
    :root {
      --pdfv-bg: #525659;
      --pdfv-toolbar-bg: #323232;
      --pdfv-text: #E8EAED;
      --pdfv-text-dim: #BDC1C6;
      --pdfv-divider: rgba(255,255,255,0.18);
      --pdfv-toolbar-h: ${PDF_TOOLBAR_HEIGHT_PX}px;
      --pdfv-page-shadow: 0 2px 8px rgba(0,0,0,0.45);
      --pdfv-font: 'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif;
    }

    .pdfv-toolbar {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: var(--pdfv-toolbar-h);
      display: flex;
      align-items: center;
      background: var(--pdfv-toolbar-bg);
      color: var(--pdfv-text);
      font-family: var(--pdfv-font);
      padding: 0 16px;
      z-index: 10;
      user-select: none;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }
    .pdfv-toolbar * { box-sizing: border-box; }

    .pdfv-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1 1 0;
    }
    .pdfv-file-icon { display: inline-flex; align-items: center; }
    .pdfv-file-icon svg { display: block; }
    .pdfv-filename {
      font-size: 14px;
      font-weight: 400;
      color: var(--pdfv-text);
      max-width: 420px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.1px;
    }

    .pdfv-center {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      padding: 0 12px;
    }
    .pdfv-pageinfo {
      font-size: 13px;
      color: var(--pdfv-text-dim);
      white-space: nowrap;
    }
    .pdfv-pageinfo-current {
      display: inline-block;
      min-width: 22px;
      text-align: center;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 2px;
      color: var(--pdfv-text);
      padding: 1px 4px;
      line-height: 16px;
    }

    .pdfv-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
      flex: 1 1 0;
    }
    .pdfv-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px; height: 32px;
      border: none;
      background: transparent;
      color: var(--pdfv-text-dim);
      border-radius: 50%;
      cursor: pointer;
      padding: 0;
      flex: 0 0 32px;
    }
    .pdfv-icon-btn:hover { background: rgba(255,255,255,0.10); color: var(--pdfv-text); }
    .pdfv-icon-btn svg { display: block; }
    .pdfv-zoom-value {
      font-size: 13px;
      color: var(--pdfv-text-dim);
      padding: 0 4px;
      white-space: nowrap;
    }
    .pdfv-vdivider {
      width: 1px;
      height: 20px;
      background: var(--pdfv-divider);
      margin: 0 6px;
      flex: 0 0 1px;
    }

    /* Dokument-Fläche: zentrierter Seiten-Stack — Maße wie GDocs-Pipeline. */
    .pdfv-doc-stack {
      max-width: ${PDF_DOC_WIDTH_PX}px;
      /* Kein Außenrand: Doc sitzt bündig unter der Toolbar — identisch zum
         Screenshot-Crop im Worker und zur Client-Vorschau (doc-geometry). */
      margin: 0 auto;
      padding: 0 ${DOC_STACK_HPAD_PX}px;
      display: flex;
      flex-direction: column;
      gap: ${PDF_PAGE_GAP_PX}px;
    }
    .pdfv-page {
      background: #fff;
      box-shadow: var(--pdfv-page-shadow);
      overflow: hidden;
    }
    .pdfv-page img {
      display: block;
      width: 100%;
      height: auto;
      user-select: none;
      -webkit-user-drag: none;
    }
  `;
}

/* -------------------------------------------------------------------------- */
/* Vollständiger HTML-Wrapper                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Baut das komplette Viewer-HTML: fixe Toolbar + Seiten-Stack aus den
 * übergebenen Seiten-Bild-URLs (file:// oder https:// — die Funktion ist
 * quellen-agnostisch, analog `buildGDocsHtml`).
 */
export function buildPdfViewerHtml(
  pageImageUrls: string[],
  opts: PdfToolbarOptions,
): string {
  const imgs = pageImageUrls
    .map(
      (url) =>
        `<div class="pdfv-page"><img src="${escapeAttr(url)}" alt="" draggable="false" /></div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.fileName || "Dokument.pdf")}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--pdfv-bg, #525659);
    font-family: 'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  }
  body {
    padding-top: ${PDF_TOOLBAR_HEIGHT_PX}px;
    min-height: 100vh;
  }
  ${getPdfViewerCss()}
</style>
</head>
<body>
${buildPdfToolbarHtml(opts)}
<div class="pdfv-doc-stack">
${imgs}
</div>
</body>
</html>`;
}
