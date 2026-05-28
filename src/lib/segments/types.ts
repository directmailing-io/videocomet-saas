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

export type SegmentKind = "text" | "image" | "video" | "website" | "gdocs";

export type TextAlign = "left" | "center" | "right";
export type FontWeight = "400" | "600" | "700";
export type ImageDisplayMode = "fullscreen" | "slide";
export type CropRatio = "16:9" | "4:3" | "1:1" | "9:16";
/**
 * Aufnahme-Modi für Website- und Google-Docs-Segmente.
 *
 * - `static-hero`        Standbild des oberen Bereichs (nach Cookie-Dismiss).
 * - `smooth-scroll`      Lineares Scrollen von oben nach unten über die Dauer.
 * - `slow-scroll-pauses` Langsam scrollen mit kurzen Pausen bei 25/50/75 %.
 * - `quick-scroll`       Erste Hälfte schnell scrollen, zweite Hälfte halten.
 */
export type WebCaptureMode =
  | "static-hero"
  | "smooth-scroll"
  | "slow-scroll-pauses"
  | "quick-scroll";

/** Keyframe für Scroll-Animation (Website/GDocs). */
export interface ScrollKeyframe {
  /** Zeitpunkt in Millisekunden, relativ zum Segment-Start. */
  time: number;
  /** Vertikale Scroll-Position in Pixeln. */
  scrollY: number;
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
  /** Optional, nur relevant bei captureMode = "scroll". */
  scrollKeyframes?: ScrollKeyframe[];
}

export interface GDocsSegment extends SegmentBase {
  kind: "gdocs";
  /** Public Google-Docs-URL. */
  docsUrl: string;
  captureMode: WebCaptureMode;
  /** Optional, nur relevant bei captureMode = "scroll". */
  scrollKeyframes?: ScrollKeyframe[];
}

/** Diskriminierte Union aller Segment-Varianten. */
export type Segment =
  | TextSegment
  | ImageSegment
  | VideoSegment
  | WebsiteSegment
  | GDocsSegment;

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
