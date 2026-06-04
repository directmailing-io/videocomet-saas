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
  | "gslide"
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
}

export interface WebsiteSegment extends SegmentBase {
  kind: "website";
  /** CSV-Spalte, die die URL pro Lead enthält. */
  urlColumn: string;
  /** Fallback-URL, falls Lead keinen Wert in urlColumn hat. */
  fallbackUrl: string;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll-recorded". */
  scrollFrames?: ScrollFrame[];
}

export interface GDocsSegment extends SegmentBase {
  kind: "gdocs";
  /** Public Google-Docs-URL. */
  docsUrl: string;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll-recorded". */
  scrollFrames?: ScrollFrame[];
}

/**
 * Google-Slides-Folie als personalisiertes Segment.
 *
 * Quelle: User veröffentlicht seine Präsentation einmalig per
 * „Datei → Im Web veröffentlichen". Wir laden die `pubembed`-HTML einer
 * einzelnen Folie in Puppeteer, ersetzen `{{key}}`-TextNodes durch
 * Lead-Werte per `page.evaluate` und screenshotten 1280×720.
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

/** Diskriminierte Union aller Segment-Varianten. */
export type Segment =
  | TextSegment
  | ImageSegment
  | VideoSegment
  | WebsiteSegment
  | GDocsSegment
  | GSlideSegment
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

export function isGSlideSegment(s: Segment): s is GSlideSegment {
  return s.kind === "gslide";
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
