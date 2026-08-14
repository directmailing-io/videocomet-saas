/**
 * Segment-Schema für den Kampagnen-Editor (Schritt 3).
 *
 * Eine Kampagne im Modus "with-presentation" besteht aus einer geordneten
 * Liste von Segmenten. Jedes Segment beschreibt einen Slide-Abschnitt
 * (Text, Bild, Video, Website-Screenshot/Scroll oder Google Docs).
 *
 * Dauer ist immer in Millisekunden (ms) ausgedrückt, damit Trimming
 * und Keyframe-Animationen frame-genau steuerbar bleiben.
 */

export type SegmentKind =
  | "text"
  | "image"
  | "video"
  | "website"
  | "gdocs"
  | "pdf"
  | "gslide"
  | "canva"
  | "slide";

export type TextAlign = "left" | "center" | "right";
export type FontWeight = "400" | "600" | "700";
export type ImageDisplayMode = "fullscreen" | "slide";
export type CropRatio = "16:9" | "4:3" | "1:1" | "9:16";
/**
 * Aufnahme-Modi für Website- und Google-Docs-Segmente.
 *
 * - `static-hero`     Standbild des oberen Bereichs (nach Cookie-Dismiss).
 * - `scroll-recorded` Wiedergabe der vom Nutzer interaktiv aufgezeichneten
 *                     Scroll-Bewegung über einer fullPage-Vorschau.
 */
export type WebCaptureMode = "static-hero" | "scroll-recorded";

/**
 * Ein einzelner Scroll-Frame aus dem interaktiven Recorder.
 *
 * Der Frontend-Recorder zeichnet die vertikale Scroll-Position eines
 * fullPage-Screenshots als zeitgestempelte Sample-Liste auf. Der Worker
 * spielt diese Sequenz beim Render frame-by-frame ab.
 */
export interface ScrollFrame {
  /** ms since recording start */
  t: number;
  /** vertical ratio of the captured image, 0..1 */
  y: number;
}

/** Basis-Felder, die jedes Segment besitzt. */
interface SegmentBase {
  /** Stabile UUID (crypto.randomUUID()). */
  id: string;
  kind: SegmentKind;
  /** Anzeigedauer in Millisekunden. */
  durationMs: number;
  /** Optionaler Anzeigename. Wenn leer wird ein Default aus kind generiert. */
  label?: string;
}

export interface TextSegment extends SegmentBase {
  kind: "text";
  text: string;
  /** Hintergrundfarbe, hex (z. B. "#FAFAFA"). */
  bgColor: string;
  /** Textfarbe, hex. */
  textColor: string;
  /** Schriftgröße in Pixeln. */
  fontSize: number;
  textAlign: TextAlign;
  fontWeight: FontWeight;
  italic: boolean;
}

export interface ImageSegment extends SegmentBase {
  kind: "image";
  /** Verweis auf media_items.id. null = noch keine Auswahl. */
  mediaId: string | null;
  /** CDN-URL aus der Mediathek. */
  publicUrl: string | null;
  displayMode: ImageDisplayMode;
  /** Hintergrundfarbe (nur relevant bei displayMode = "slide"). */
  bgColor: string;
  /** X-Position des Bildmittelpunkts in % (0-100), nur "slide". */
  posXPct: number;
  /** Y-Position des Bildmittelpunkts in % (0-100), nur "slide". */
  posYPct: number;
  /** Breite in % der Bühne (0-100). */
  widthPct: number;
  /** Höhe in % der Bühne (0-100). */
  heightPct: number;
}

/**
 * Wiedergabe-Fenster eines Video-Segments (Studio-Modus).
 *
 * Zeiten sind RELATIV zum Segment-Start in ms. Semantik:
 *   - Außerhalb der Fenster steht das Video als Standbild (Poster = Frame
 *     bei `trimStartMs`, nach einem Fenster = eingefrorener letzter Frame).
 *   - Innerhalb eines Fensters läuft das Video ab der aufsummierten bereits
 *     abgespielten Stelle weiter (Quell-Startpunkt des ersten Fensters =
 *     `trimStartMs`; jedes weitere Fenster setzt dort fort, wo das vorige
 *     endete). Ein Szenenwechsel pausiert implizit — offene Fenster enden
 *     deshalb spätestens bei `durationMs`.
 *   - Der Original-Ton des Videos läuft GENAU in den Fenstern mit und wird
 *     im Worker mit der Webcam-Stimme gemischt.
 */
export interface VideoPlaybackWindow {
  /** Wiedergabe-Start relativ zum Segment-Start in ms. */
  startMs: number;
  /** Wiedergabe-Stopp relativ zum Segment-Start in ms (> startMs). */
  stopMs: number;
}

export interface VideoSegment extends SegmentBase {
  kind: "video";
  mediaId: string | null;
  publicUrl: string | null;
  /** Originaldauer des Quellvideos in Sekunden (für Trim-UI). */
  originalDurationSec: number | null;
  /** Trim-Start (wo im Original-Video das Segment beginnt) in ms. */
  trimStartMs: number;
  /** Trim-Ende in ms. null = bis Original-Ende. */
  trimEndMs: number | null;
  cropRatio: CropRatio;
  /** Optional als Browser-Frame mit Tab anzeigen (Demo-Look). */
  showAsBrowserFrame: boolean;
  browserTabName: string;
  browserTabUrl: string;
  /**
   * Studio-Modus: Wiedergabe-Fenster aus den mediaPlay/mediaPause-Events
   * der Live-Aufnahme (siehe `VideoPlaybackWindow`). undefined/leer =
   * Poster-Standbild über die gesamte Segmentdauer.
   */
  playbackWindows?: VideoPlaybackWindow[];
}

/**
 * Hintergrundfarbe der Bühne für Bild-/Video-Szenen (contain auf dunklem
 * Grund). MUSS zwischen Studio-Stage (CSS) und Worker-Render (sharp/ffmpeg)
 * identisch sein, damit Vorschau und fertiges Video übereinstimmen.
 */
export const MEDIA_STAGE_BG = "#101014";

export interface WebsiteSegment extends SegmentBase {
  kind: "website";
  /**
   * CSV-Spalte, die die URL pro Lead enthält. Darf leer sein — dann wird
   * die Spalte erst im Mapping-Schritt des Run-Wizards zugewiesen
   * (Mapping-Key "website", s. `@/lib/placeholders/website-url`).
   */
  urlColumn: string;
  /** Fallback-URL, falls Lead keinen Wert in urlColumn hat. */
  fallbackUrl: string;
  /**
   * false = feste Webseite für ALLE Empfänger (immer fallbackUrl, kein
   * Mapping-Schritt). undefined/true = pro Lead personalisiert (Legacy).
   */
  personalized?: boolean;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll-recorded". */
  scrollFrames?: ScrollFrame[];
  /**
   * FullPage-Screenshot der fallbackUrl (Bunny-CDN) für die Editor-Vorschau.
   * Wird beim „Vorschau laden" / Scroll-Recorder als Nebeneffekt persistiert.
   */
  previewImageUrl?: string;
  previewImageWidth?: number;
  previewImageHeight?: number;
}

export interface GDocsSegment extends SegmentBase {
  kind: "gdocs";
  /** Public Google-Docs-URL. */
  docsUrl: string;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll-recorded". */
  scrollFrames?: ScrollFrame[];
  /**
   * Seiten-PNGs auf Bunny (permanente URLs, NIE die 30min-TTL-previewUrl!)
   * für die Editor-Vorschau. Persistiert nach Screenshot-Job.
   */
  previewPageUrls?: string[];
  /** Pixel-Maße EINER Seite (150 dpi). */
  previewDocWidth?: number;
  previewDocHeight?: number;
}

/**
 * PDF als Präsentations-Segment (nicht personalisiert).
 *
 * Der Upload rastert das PDF synchron in der API-Route (`pdftoppm`, 150 dpi)
 * zu Seiten-PNGs auf Bunny. Editor-Vorschau UND Worker-Render nutzen dieselbe
 * Rasterung — die Vorschau ist damit exakt. Im Video wird das PDF wie in
 * einem PDF-Viewer (Drive-Look: Seiten-Stack auf grauem Grund + Toolbar)
 * durchgescrollt, gesteuert über `captureMode`/`scrollFrames` wie bei
 * Website/GDocs.
 */
export interface PdfSegment extends SegmentBase {
  kind: "pdf";
  /** Bunny-CDN-URL des Original-PDF (Worker-Render-Quelle). */
  pdfUrl: string;
  /** Originaler Dateiname für UI + Viewer-Toolbar. */
  fileName: string;
  /** Vorgerenderte Seiten-PNGs (Bunny, 150 dpi). */
  pageUrls: string[];
  pageCount: number;
  /** Pixel-Maße EINER Seite bei 150 dpi (Scroll-Mathe). */
  docWidth: number;
  docHeight: number;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll-recorded". */
  scrollFrames?: ScrollFrame[];
}

/**
 * Google-Slides-Folie als personalisiertes Segment.
 *
 * Zwei Pipelines, je nach `publishedUrl` (Mode wird zur Laufzeit aus der
 * URL via `parsePublishedSlidesUrl()` abgeleitet — kein eigenes Feld):
 *
 *   1. Edit-URL („Anyone with link" / Viewer) — bevorzugt.
 *      Wir laden den PPTX-Export, ersetzen `{{key}}` direkt im
 *      Office-Open-XML und rendern via LibreOffice headless. Vollwertige
 *      Personalisierung.
 *
 *   2. Pubembed-URL (Legacy „Im Web veröffentlichen") — Bestandskampagnen.
 *      Puppeteer screenshottet die fertig gerenderte Folie; Platzhalter
 *      werden NICHT mehr ersetzt (Google rendert Text server-seitig zu
 *      SVG-Pfaden).
 *
 * `publishedUrl` + `slideIndex` sind Single Source of Truth.
 * `thumbnailUrl` und `detectedPlaceholders` werden beim Import +
 * beim manuellen „Aktualisieren" befüllt.
 */
export interface GSlideSegment extends SegmentBase {
  kind: "gslide";
  /** Published-Web-URL (`/d/e/…/pubembed` oder `/pub`). */
  publishedUrl: string;
  /** Index der Folie im Deck, 0-basiert. */
  slideIndex: number;
  /** Thumbnail in Bunny-Storage (für Editor-Vorschau). null = nicht generiert. */
  thumbnailUrl: string | null;
  /** Cache der zuletzt erkannten Platzhalter-Keys auf dieser Folie. */
  detectedPlaceholders: string[];
  /** Wann zuletzt mit Google synchronisiert (ISO-8601, für „Aktualisieren"). */
  lastFetchedAt: string;
}

/**
 * Canva-Folie als personalisiertes Segment.
 *
 * Analog zu `GSlideSegment` (Edit-Mode-Pipeline), aber mit einer vom User
 * hochgeladenen PPTX-Datei statt einem Google-Slides-URL-Fetch. Der
 * Upload landet in `media_items` (Bunny Storage), das Segment hält den
 * FK + die Bunny-CDN-URL für den Render-Worker.
 *
 * Render-Pipeline (siehe `worker/lib/canva-render.ts`):
 *
 *   1. PPTX-Buffer via Bunny-CDN-URL holen (mit LRU-Cache pro Render-Process).
 *   2. `{{key}}`-Tokens im Office-Open-XML mit Lead-Werten ersetzen.
 *   3. LibreOffice headless → PDF → PNG-Sequenz.
 *   4. PNG mit `slideIndex` als Standbild → FFmpeg-Loop → MP4.
 *
 * `pptxMediaId` + `slideIndex` sind Single Source of Truth.
 * `thumbnailUrl` und `detectedPlaceholders` werden beim Upload-Processing +
 * beim manuellen „Aktualisieren" gefüllt.
 */
export interface CanvaSegment extends SegmentBase {
  kind: "canva";
  /** FK auf `media_items.id` der hochgeladenen PPTX. */
  pptxMediaId: string;
  /** Bunny-CDN-URL der PPTX (für den Worker-Download). */
  pptxPublicUrl: string;
  /** Originaler Dateiname (z. B. "Pitch-Deck.pptx") für UI-Anzeige. null = unbekannt. */
  fileName: string | null;
  /** Index der Folie im Deck, 0-basiert. */
  slideIndex: number;
  /** Thumbnail in Bunny-Storage (für Editor-Vorschau). null = nicht generiert. */
  thumbnailUrl: string | null;
  /** Cache der zuletzt erkannten Platzhalter-Keys auf dieser Folie. */
  detectedPlaceholders: string[];
  /** Wann zuletzt aus dem PPTX gescannt (ISO-8601, für „Aktualisieren"). */
  lastFetchedAt: string;
}

// ── Freier Folien-Editor (kind: "slide") ────────────────────────────────────
//
// Eine Slide-Folie besteht aus einer Liste von Layers über einem Hintergrund.
// Der Bühnen-Bezugsrahmen ist konstant 1280×720 (matches Render-Pipeline).
// Z-Index ergibt sich aus der Array-Reihenfolge: layers[0] zuunterst.

export const SLIDE_STAGE_WIDTH = 1280;
export const SLIDE_STAGE_HEIGHT = 720;

export interface SlideBackgroundColor {
  type: "color";
  color: string;
}
export interface SlideBackgroundImage {
  type: "image";
  mediaId: string;
  publicUrl: string;
  fit: "cover" | "contain";
}
export type SlideBackground = SlideBackgroundColor | SlideBackgroundImage;

interface LayerBase {
  /** Stabile UUID. */
  id: string;
  /** Linke obere Ecke in Stage-Pixeln (Stage 1280×720). */
  x: number;
  y: number;
  /** Breite/Höhe in Stage-Pixeln. */
  w: number;
  h: number;
  /** Rotation in Grad, im Uhrzeigersinn. */
  rot: number;
  /** Opazität 0..1. */
  opacity: number;
  /** Optional sperren — kann im Editor nicht selektiert werden. */
  locked?: boolean;
  /** Optional ausblenden im Editor und Render. */
  hidden?: boolean;
}

export interface TextLayer extends LayerBase {
  kind: "text";
  /** Tiptap-HTML mit <span data-placeholder="key"> Nodes. */
  contentHtml: string;
  /** Vertikale Ausrichtung im Container. */
  vAlign: "top" | "middle" | "bottom";
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  mediaId: string;
  publicUrl: string;
  fit: "cover" | "contain";
}

export type LayerShape = "rect" | "ellipse";
export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: LayerShape;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  /** Border-Radius in Pixeln (nur rect). */
  cornerRadius: number;
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;
export type LayerKind = Layer["kind"];

export interface SlideSegment extends SegmentBase {
  kind: "slide";
  background: SlideBackground;
  layers: Layer[];
}

/**
 * Thumbnail-Bild einer Kampagne (Migration 0018).
 *
 * Strukturell identisch zur `SlideSegment`-Konfiguration (Background +
 * Layers), aber OHNE `durationMs` / `kind` / `id` — das Thumbnail ist
 * ein einzelnes statisches Bild, kein Segment im Timeline-Sinn. Wir
 * re-usen denselben Stage-Bezugsrahmen 1280×720 und dieselben Layer-
 * Typen, damit Editor und Render-Pipeline `SlideSegment`-Code direkt
 * teilen können.
 *
 * Wird in `campaigns.thumbnail_image` als JSONB persistiert. NULL =
 * Thumbnail-Generator deaktiviert oder noch nicht konfiguriert
 * (Feature-Toggle: `campaigns.thumbnail_image_enabled`).
 */
export interface CampaignThumbnailImage {
  background: SlideBackground;
  layers: Layer[];
}

/** Diskriminierte Union aller Segment-Varianten. */
export type Segment =
  | TextSegment
  | ImageSegment
  | VideoSegment
  | WebsiteSegment
  | GDocsSegment
  | PdfSegment
  | GSlideSegment
  | CanvaSegment
  | SlideSegment;

// ── Type Guards ──────────────────────────────────────────────────────────────

export function isTextSegment(s: Segment): s is TextSegment {
  return s.kind === "text";
}

export function isImageSegment(s: Segment): s is ImageSegment {
  return s.kind === "image";
}

export function isVideoSegment(s: Segment): s is VideoSegment {
  return s.kind === "video";
}

export function isWebsiteSegment(s: Segment): s is WebsiteSegment {
  return s.kind === "website";
}

export function isGDocsSegment(s: Segment): s is GDocsSegment {
  return s.kind === "gdocs";
}

export function isPdfSegment(s: Segment): s is PdfSegment {
  return s.kind === "pdf";
}

export function isGSlideSegment(s: Segment): s is GSlideSegment {
  return s.kind === "gslide";
}

export function isCanvaSegment(s: Segment): s is CanvaSegment {
  return s.kind === "canva";
}

export function isSlideSegment(s: Segment): s is SlideSegment {
  return s.kind === "slide";
}

export function isTextLayer(l: Layer): l is TextLayer {
  return l.kind === "text";
}
export function isImageLayer(l: Layer): l is ImageLayer {
  return l.kind === "image";
}
export function isShapeLayer(l: Layer): l is ShapeLayer {
  return l.kind === "shape";
}
