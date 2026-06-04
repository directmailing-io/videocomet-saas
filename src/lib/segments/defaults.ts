/**
 * Default-Werte und Factory für Segmente.
 *
 * Alle Erzeuger sind pure: keine Side-Effects ausser dem Aufruf von
 * crypto.randomUUID() (deterministisch genug für unsere Zwecke).
 */

import type {
  GDocsSegment,
  GSlideSegment,
  ImageLayer,
  ImageSegment,
  Layer,
  LayerKind,
  Segment,
  SegmentKind,
  ShapeLayer,
  SlideSegment,
  TextLayer,
  TextSegment,
  VideoSegment,
  WebsiteSegment,
} from "./types";
import { SLIDE_STAGE_HEIGHT, SLIDE_STAGE_WIDTH } from "./types";

/** Standard-Dauer pro Segment in Millisekunden (5 Sekunden). */
export const DEFAULT_SEGMENT_DURATION_MS = 5000;

/**
 * Smart-Default für Google-Slides-Folien. Für Akquise-Videos ist 4s die
 * Lese-Geschwindigkeits-Faustregel — siehe Konzept-Dokument.
 */
export const DEFAULT_GSLIDE_DURATION_MS = 4000;

/** Lesbarer Default-Label pro Segment-Typ. */
export const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  text: "Textfolie",
  image: "Bild",
  video: "Video",
  website: "Website",
  gdocs: "Google Docs",
  gslide: "Google Slide",
  slide: "Freie Folie",
};

export interface CreateSegmentOptions {
  /** Eigene ID setzen (default: crypto.randomUUID()). */
  id?: string;
  /** Eigene Dauer setzen (default: DEFAULT_SEGMENT_DURATION_MS). */
  durationMs?: number;
  /** Eigener Label. */
  label?: string;
}

function newId(): string {
  // crypto.randomUUID() ist in Node 16+ und allen modernen Browsern verfügbar.
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback (sollte in unserem Stack nie greifen).
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `seg-${time}-${rand}`;
}

function baseFields(
  kind: SegmentKind,
  opts: CreateSegmentOptions | undefined,
): { id: string; durationMs: number; label: string } {
  return {
    id: opts?.id ?? newId(),
    durationMs: opts?.durationMs ?? DEFAULT_SEGMENT_DURATION_MS,
    label: opts?.label ?? SEGMENT_KIND_LABELS[kind],
  };
}

export function createTextSegment(opts?: CreateSegmentOptions): TextSegment {
  return {
    ...baseFields("text", opts),
    kind: "text",
    text: "Neuer Text",
    bgColor: "#FAFAFA",
    textColor: "#222222",
    fontSize: 48,
    textAlign: "center",
    fontWeight: "600",
    italic: false,
  };
}

export function createImageSegment(opts?: CreateSegmentOptions): ImageSegment {
  return {
    ...baseFields("image", opts),
    kind: "image",
    mediaId: null,
    publicUrl: null,
    displayMode: "fullscreen",
    bgColor: "#FFFFFF",
    posXPct: 50,
    posYPct: 50,
    widthPct: 80,
    heightPct: 80,
  };
}

export function createVideoSegment(opts?: CreateSegmentOptions): VideoSegment {
  return {
    ...baseFields("video", opts),
    kind: "video",
    mediaId: null,
    publicUrl: null,
    originalDurationSec: null,
    trimStartMs: 0,
    trimEndMs: null,
    cropRatio: "16:9",
    showAsBrowserFrame: false,
    browserTabName: "",
    browserTabUrl: "",
  };
}

export function createWebsiteSegment(
  opts?: CreateSegmentOptions,
): WebsiteSegment {
  return {
    ...baseFields("website", opts),
    kind: "website",
    urlColumn: "website",
    fallbackUrl: "https://example.com",
    captureMode: "static-hero",
  };
}

export function createGDocsSegment(opts?: CreateSegmentOptions): GDocsSegment {
  return {
    ...baseFields("gdocs", opts),
    kind: "gdocs",
    docsUrl: "",
    captureMode: "static-hero",
  };
}

/**
 * Factory für ein Google-Slides-Segment.
 *
 * Default-Dauer 4 s (statt DEFAULT_SEGMENT_DURATION_MS=5000) — passt zu
 * Akquise-Videos. Der Caller kann via `opts.durationMs` überschreiben.
 *
 * `publishedUrl` startet leer; das UI füllt sie nach erfolgreichem Import.
 * `lastFetchedAt` wird auf "now" gesetzt, damit der "Aktualisieren"-Button
 * im Editor von Anfang an einen sinnvollen Wert anzeigt.
 */
export function createGSlideSegment(
  opts?: CreateSegmentOptions,
): GSlideSegment {
  const base = {
    id: opts?.id ?? newId(),
    durationMs: opts?.durationMs ?? DEFAULT_GSLIDE_DURATION_MS,
    label: opts?.label ?? SEGMENT_KIND_LABELS.gslide,
  };
  return {
    ...base,
    kind: "gslide",
    publishedUrl: "",
    slideIndex: 0,
    thumbnailUrl: null,
    detectedPlaceholders: [],
    lastFetchedAt: new Date().toISOString(),
  };
}

export function createTextLayer(overrides?: Partial<TextLayer>): TextLayer {
  return {
    id: newId(),
    kind: "text",
    x: 160,
    y: 280,
    w: 960,
    h: 160,
    rot: 0,
    opacity: 1,
    contentHtml:
      "<p>Hallo <span data-placeholder=\"firstName\">{{firstName}}</span></p>",
    vAlign: "middle",
    ...overrides,
  };
}

export function createImageLayer(
  mediaId: string,
  publicUrl: string,
  overrides?: Partial<ImageLayer>,
): ImageLayer {
  return {
    id: newId(),
    kind: "image",
    x: 320,
    y: 160,
    w: 640,
    h: 400,
    rot: 0,
    opacity: 1,
    mediaId,
    publicUrl,
    fit: "cover",
    ...overrides,
  };
}

export function createShapeLayer(
  shape: "rect" | "ellipse",
  overrides?: Partial<ShapeLayer>,
): ShapeLayer {
  return {
    id: newId(),
    kind: "shape",
    x: 400,
    y: 200,
    w: 480,
    h: 320,
    rot: 0,
    opacity: 1,
    shape,
    fill: "#AA8CF5",
    stroke: null,
    strokeWidth: 0,
    cornerRadius: shape === "rect" ? 16 : 0,
    ...overrides,
  };
}

export function createLayer(
  kind: LayerKind,
  args?: { mediaId?: string; publicUrl?: string; shape?: "rect" | "ellipse" },
): Layer {
  if (kind === "text") return createTextLayer();
  if (kind === "image") {
    return createImageLayer(args?.mediaId ?? "", args?.publicUrl ?? "");
  }
  return createShapeLayer(args?.shape ?? "rect");
}

export function createSlideSegment(opts?: CreateSegmentOptions): SlideSegment {
  return {
    ...baseFields("slide", opts),
    kind: "slide",
    background: { type: "color", color: "#FAFAFA" },
    layers: [createTextLayer()],
  };
}

/** Konvertiert ein altes TextSegment in eine freie Folie (1 Text-Layer). */
export function textSegmentToSlide(seg: TextSegment): SlideSegment {
  const fontWeightCss = seg.fontWeight;
  const align = seg.textAlign;
  const italicTag = seg.italic ? "<em>" : "";
  const italicEnd = seg.italic ? "</em>" : "";
  // Escape HTML special chars in the original raw text
  const escaped = seg.text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Replace {{key}} with <span data-placeholder="key">{{key}}</span>
  const withPlaceholders = escaped.replace(
    /\{\{\s*([\w-]+)\s*\}\}/g,
    (_m, key: string) =>
      `<span data-placeholder="${key}">{{${key}}}</span>`,
  );
  // Newlines -> <br> within a single paragraph; preserve textAlign + size + color
  const html =
    `<p style="text-align:${align};font-size:${seg.fontSize}px;font-weight:${fontWeightCss};color:${seg.textColor}">` +
    italicTag +
    withPlaceholders.replace(/\n/g, "<br>") +
    italicEnd +
    `</p>`;
  return {
    id: seg.id,
    kind: "slide",
    durationMs: seg.durationMs,
    label: seg.label,
    background: { type: "color", color: seg.bgColor },
    layers: [
      {
        id: newId(),
        kind: "text",
        x: 40,
        y: 40,
        w: SLIDE_STAGE_WIDTH - 80,
        h: SLIDE_STAGE_HEIGHT - 80,
        rot: 0,
        opacity: 1,
        contentHtml: html,
        vAlign: "middle",
      },
    ],
  };
}

/**
 * Erstellt eine neue Segment-Instance mit sinnvollen Defaults für den
 * gewählten Typ.
 */
export function createSegment(
  kind: SegmentKind,
  opts?: CreateSegmentOptions,
): Segment {
  switch (kind) {
    case "text":
      return createTextSegment(opts);
    case "image":
      return createImageSegment(opts);
    case "video":
      return createVideoSegment(opts);
    case "website":
      return createWebsiteSegment(opts);
    case "gdocs":
      return createGDocsSegment(opts);
    case "gslide":
      return createGSlideSegment(opts);
    case "slide":
      return createSlideSegment(opts);
    default: {
      // Erschöpfungs-Check: kompiliert nur, wenn alle Varianten behandelt sind.
      const _exhaustive: never = kind;
      throw new Error(`Unknown segment kind: ${String(_exhaustive)}`);
    }
  }
}
