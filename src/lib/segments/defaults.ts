/**
 * Default-Werte und Factory für Segmente.
 *
 * Alle Erzeuger sind pure: keine Side-Effects ausser dem Aufruf von
 * crypto.randomUUID() (deterministisch genug für unsere Zwecke).
 */

import type {
  GDocsSegment,
  ImageSegment,
  Segment,
  SegmentKind,
  TextSegment,
  VideoSegment,
  WebsiteSegment,
} from "./types";

/** Standard-Dauer pro Segment in Millisekunden (5 Sekunden). */
export const DEFAULT_SEGMENT_DURATION_MS = 5000;

/** Lesbarer Default-Label pro Segment-Typ. */
export const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  text: "Textfolie",
  image: "Bild",
  video: "Video",
  website: "Website",
  gdocs: "Google Docs",
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
    captureMode: "smooth-scroll",
  };
}

export function createGDocsSegment(opts?: CreateSegmentOptions): GDocsSegment {
  return {
    ...baseFields("gdocs", opts),
    kind: "gdocs",
    docsUrl: "",
    captureMode: "smooth-scroll",
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
    default: {
      // Erschöpfungs-Check: kompiliert nur, wenn alle Varianten behandelt sind.
      const _exhaustive: never = kind;
      throw new Error(`Unknown segment kind: ${String(_exhaustive)}`);
    }
  }
}
