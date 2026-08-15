/**
 * doc-geometry — die EINE Quelle der Wahrheit für die Viewer-Geometrie von
 * Dokument-Stapeln (GDocs + PDF) über alle drei Render-Orte hinweg:
 *
 *   1. Studio-Bühne (Aufnahme, studio-stage.tsx)
 *   2. Editor-/Sequenz-Vorschau (doc-stack-preview.tsx)
 *   3. Worker-Render fürs finale Video (gdocs-render-pipeline.ts /
 *      pdf-viewer-html.ts, Referenz-Viewport 1280×720)
 *
 * Hintergrund: Die drei Orte hatten historisch UNTERSCHIEDLICHE Proportionen
 * (Seitenbreite 56 % vs. 850px/1280, Toolbar 0/32px vs. 160/56px, Außen-
 * Padding vs. randlos). Ein `scrollRatio` von z. B. 0.5 zeigte dadurch im
 * finalen Video eine andere Dokumentstelle als während der Aufnahme — das
 * Dokument wirkte „zu weit oben". Seitdem alle Consumer `docStackLayout()`
 * benutzen, ist die Ratio 1:1 übertragbar: gleiche Ratio = gleicher
 * sichtbarer Inhalt, egal wie groß die Bühne gerade ist.
 *
 * Die Referenzwerte beschreiben EXAKT das Worker-HTML:
 *   - Stack `max-width: 850px` mit `padding: 0 12px` → Seitenbreite 826px
 *   - 24px Gap zwischen Seiten, KEIN führender/abschließender Rand
 *     (der Worker neutralisiert die Stack-Margins vor dem Screenshot und
 *     setzt den Doc-Crop bündig unter die Toolbar)
 *   - Toolbar: GDocs 160px (Docs-Chrome), PDF 56px (Drive-Viewer-Leiste)
 *   - sichtbarer Doc-Bereich = 720 − Toolbar; maxScroll = Stapel − sichtbar
 */

/** Referenz-Viewport des Worker-Renders (Puppeteer, deviceScaleFactor 1). */
export const DOC_VIEWER_WIDTH_PX = 1280;
export const DOC_VIEWER_HEIGHT_PX = 720;

/** `max-width` des Seiten-Stapels im Viewer-HTML. */
export const DOC_STACK_MAX_WIDTH_PX = 850;
/** Horizontales Innen-Padding des Stapels (`padding: 0 12px`). */
export const DOC_STACK_HPAD_PX = 12;
/** Effektive Seitenbreite im Referenz-Viewport (850 − 2×12). */
export const DOC_PAGE_WIDTH_PX = DOC_STACK_MAX_WIDTH_PX - 2 * DOC_STACK_HPAD_PX;
/** Vertikaler Abstand zwischen zwei Seiten. */
export const DOC_PAGE_GAP_PX = 24;

/** Docs-Chrome: Titel 44 + Menü 32 + Format 40 + Lineal 24 + ~20 Padding. */
export const GDOCS_TOOLBAR_HEIGHT_PX = 160;
/** Drive-PDF-Viewer: eine dunkle Leiste. */
export const PDF_TOOLBAR_HEIGHT_PX = 56;

export type DocViewerVariant = "gdocs" | "pdf";

export function docToolbarHeightPx(variant: DocViewerVariant): number {
  return variant === "gdocs" ? GDOCS_TOOLBAR_HEIGHT_PX : PDF_TOOLBAR_HEIGHT_PX;
}

export interface DocStackLayout {
  /** Skalierung der Bühne relativ zum Referenz-Viewport (stageWidth/1280). */
  scale: number;
  pageWidthPx: number;
  pageHeightPx: number;
  gapPx: number;
  toolbarPx: number;
  /** Sichtbare Doc-Fläche unter der Toolbar. */
  viewportPx: number;
  /** Gesamthöhe des Seiten-Stapels (ohne führende/abschließende Ränder). */
  stackPx: number;
  /** Scrollbare Strecke: `scrollRatio * maxScrollPx` = translateY. */
  maxScrollPx: number;
}

/**
 * Rechnet die Worker-Referenz-Geometrie proportional auf eine beliebige
 * (16:9-)Bühne um. `pageAspect` = Breite/Höhe EINER Seite.
 */
export function docStackLayout(opts: {
  stageWidth: number;
  stageHeight: number;
  pageAspect: number;
  pageCount: number;
  variant: DocViewerVariant;
}): DocStackLayout {
  const scale = opts.stageWidth > 0 ? opts.stageWidth / DOC_VIEWER_WIDTH_PX : 0;
  const aspect = opts.pageAspect > 0 ? opts.pageAspect : 1 / Math.SQRT2;
  const pageWidthPx = DOC_PAGE_WIDTH_PX * scale;
  const pageHeightPx = pageWidthPx / aspect;
  const gapPx = DOC_PAGE_GAP_PX * scale;
  const toolbarPx = docToolbarHeightPx(opts.variant) * scale;
  const viewportPx = Math.max(0, opts.stageHeight - toolbarPx);
  const n = Math.max(0, opts.pageCount);
  const stackPx = n > 0 ? n * pageHeightPx + (n - 1) * gapPx : 0;
  const maxScrollPx = Math.max(0, stackPx - viewportPx);
  return {
    scale,
    pageWidthPx,
    pageHeightPx,
    gapPx,
    toolbarPx,
    viewportPx,
    stackPx,
    maxScrollPx,
  };
}
