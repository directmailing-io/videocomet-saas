/**
 * Interne Typen + Helfer für den Studio-Flow (nicht Teil des
 * Export-Vertrags von studio-flow.tsx).
 */

import type {
  ImageSegment,
  Segment,
  VideoSegment,
} from "@/lib/segments/types";
import {
  createImageSegment,
  createVideoSegment,
} from "@/lib/segments/defaults";
import type { StudioEvent, StudioTab } from "@/lib/studio/types";

/**
 * Szenen-Typen, die im Studio angelegt werden können.
 * "website" = personalisiert pro Empfänger, "ownsite" = feste Webseite für
 * alle (WebsiteSegment mit personalized === false). "image"/"video" =
 * hochgeladene Medien (für alle Empfänger gleich).
 */
export type StudioSceneKind =
  | "website"
  | "ownsite"
  | "gdocs"
  | "pdf"
  | "text"
  | "image"
  | "video";

/** Ergebnis einer beendeten Live-Aufnahme (vor dem Upload). */
export interface StudioRecording {
  blob: Blob;
  mimeType: string;
  /** Browser-gemessene Dauer (performance.now-Basis, ms). */
  recordedMs: number;
  events: StudioEvent[];
}

/** Gleicher Key wie der bestehende Webcam-Recorder — Skript wird geteilt. */
export const STUDIO_PROMPTER_STORAGE_KEY = "vc-teleprompter-script";

/** Szenen-Typ eines Studio-Tabs (null = im Studio nicht unterstützt). */
export function sceneKindOf(tab: StudioTab): StudioSceneKind | null {
  const seg = tab.segment;
  if (seg.kind === "website") {
    return seg.personalized === false ? "ownsite" : "website";
  }
  const k = seg.kind;
  if (k === "gdocs" || k === "pdf" || k === "text") return k;
  if (k === "image" || k === "video") return k;
  return null;
}

/**
 * „Bereit"-Check pro Szene: alle Assets liegen als permanente Bunny-URLs
 * am Segment-Draft (Voraussetzung für die netzfreie Live-Aufnahme).
 */
export function isTabReady(tab: StudioTab): boolean {
  const seg = tab.segment;
  switch (seg.kind) {
    case "website":
      return !!seg.previewImageUrl;
    case "gdocs":
      return !!seg.previewPageUrls && seg.previewPageUrls.length > 0;
    case "pdf":
      return seg.pageUrls.length > 0;
    case "text":
      return true;
    case "image":
    case "video":
      // Entstehen erst NACH dem Upload → publicUrl liegt sofort vor.
      return !!seg.publicUrl;
    default:
      return false;
  }
}

/** Alle Bild-URLs einer Szene (fürs decode()-Preloading vor Phase 3). */
export function tabImageUrls(tab: StudioTab): string[] {
  const seg = tab.segment;
  switch (seg.kind) {
    case "website":
      return seg.previewImageUrl ? [seg.previewImageUrl] : [];
    case "gdocs":
      return seg.previewPageUrls ?? [];
    case "pdf":
      return seg.pageUrls;
    case "image":
      return seg.publicUrl ? [seg.publicUrl] : [];
    // "video": das Poster ist ein Video-Frame (kein Bild-Asset) — das
    // <video preload>-Element der Stage übernimmt das Vorladen selbst.
    default:
      return [];
  }
}

/** Mini-Thumbnail-URL für Tab-Pills (null = Farbfläche rendern). */
export function tabThumbUrl(tab: StudioTab): string | null {
  const urls = tabImageUrls(tab);
  return urls.length > 0 ? urls[0] : null;
}

/** Anzeigename einer Szene (Label-Fallback pro Typ). */
export function tabLabel(tab: StudioTab): string {
  const seg = tab.segment;
  if (seg.label && seg.label.trim().length > 0) return seg.label;
  switch (seg.kind) {
    case "website":
      return "Website";
    case "gdocs":
      return "Google Docs";
    case "pdf":
      return seg.fileName || "PDF";
    case "text":
      return "Text-Folie";
    case "image":
      return "Bild";
    case "video":
      return "Video";
    default:
      return "Szene";
  }
}

/** mm:ss aus Millisekunden. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Segment-Dauer laienfreundlich: „12,4 s" bzw. „1:05 min". */
export function formatSegmentDuration(ms: number): string {
  const sec = Math.max(0, ms) / 1000;
  if (sec < 60) return `${sec.toFixed(1).replace(".", ",")} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")} min`;
}

/**
 * Mimetype-Kette identisch zum bestehenden Webcam-Recorder:
 * vp8+opus hat das robusteste Verhalten über alle Browser hinweg.
 */
export function pickStudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "video/webm";
}

/** Von der Aufnahme hochgeladenes Media-Item (POST /api/media Antwort). */
export interface StudioUploadedMedia {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

/**
 * Upload des Aufnahme-Blobs zu POST /api/media (kind=webcam) — XHR für
 * Fortschritts-Events, Muster 1:1 aus webcam-recorder.tsx.
 */
export function uploadStudioRecording(
  blob: Blob,
  recordedSeconds: number,
  onProgress: (pct: number) => void,
): Promise<StudioUploadedMedia> {
  return new Promise((resolve, reject) => {
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const filename = `videocomet-studio-${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: blob.type });

    const form = new FormData();
    form.append("file", file);
    form.append("kind", "webcam");
    if (recordedSeconds > 0) {
      form.append("durationSec", String(Math.round(recordedSeconds)));
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Keine Verbindung zum Server. Prüfe dein Internet und versuche es erneut — deine Aufnahme bleibt erhalten.",
        ),
      );
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        // Laienfreundliche Standard-Meldung; eine konkrete Server-Meldung
        // (j.error) hat Vorrang. Nie rohes „HTTP 413" anzeigen.
        let msg =
          xhr.status === 413
            ? "Die Aufnahme ist zu groß zum Hochladen. Bitte nimm ein kürzeres Video auf."
            : `Das Speichern hat nicht geklappt (Fehler ${xhr.status}). Bitte versuche es erneut — deine Aufnahme bleibt erhalten.`;
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        return reject(new Error(msg));
      }
      try {
        const j = JSON.parse(xhr.responseText) as {
          media: {
            id: string;
            name: string;
            publicUrl: string;
            durationSec: number | null;
          };
        };
        resolve({
          id: j.media.id,
          name: j.media.name,
          publicUrl: j.media.publicUrl,
          durationSec: j.media.durationSec ?? null,
        });
      } catch (e) {
        reject(
          e instanceof Error
            ? e
            : new Error("Antwort konnte nicht gelesen werden."),
        );
      }
    };
    xhr.send(form);
  });
}

/** Erlaubte Datei-Typen pro Medien-Szene (muss zu src/lib/upload.ts passen). */
export const STUDIO_MEDIA_ACCEPT: Record<"image" | "video", string> = {
  image: "image/jpeg,image/png,image/svg+xml",
  video: "video/mp4,video/webm,video/quicktime",
};

/**
 * Upload einer Bild-/Video-Datei zu POST /api/media — gleiches XHR-Muster
 * wie `uploadStudioRecording`, aber mit medienspezifischen Fehlertexten.
 */
export function uploadStudioMediaFile(
  file: File,
  kind: "image" | "video",
  onProgress: (pct: number) => void,
): Promise<StudioUploadedMedia> {
  return new Promise((resolve, reject) => {
    const noun = kind === "image" ? "Das Bild" : "Das Video";

    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Keine Verbindung zum Server. Prüfe dein Internet und versuche es erneut.",
        ),
      );
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg =
          xhr.status === 413
            ? `${noun} ist zu groß zum Hochladen. Bitte wähle eine kleinere Datei.`
            : `${noun} konnte nicht hochgeladen werden (Fehler ${xhr.status}). Bitte versuche es erneut.`;
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        return reject(new Error(msg));
      }
      try {
        const j = JSON.parse(xhr.responseText) as {
          media: {
            id: string;
            name: string;
            publicUrl: string;
            durationSec: number | null;
          };
        };
        resolve({
          id: j.media.id,
          name: j.media.name,
          publicUrl: j.media.publicUrl,
          durationSec: j.media.durationSec ?? null,
        });
      } catch (e) {
        reject(
          e instanceof Error
            ? e
            : new Error("Antwort konnte nicht gelesen werden."),
        );
      }
    };
    xhr.send(form);
  });
}

/** Dateiname ohne Endung (für Szenen-Labels). */
function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Bild-Szene nach erfolgreichem Upload: Vollbild (contain rendert der
 * Worker/Stage auf MEDIA_STAGE_BG — siehe Segment-Typen).
 */
export function createStudioImageSegment(
  media: StudioUploadedMedia,
): ImageSegment {
  const seg = createImageSegment({ label: stripExtension(media.name) });
  seg.mediaId = media.id;
  seg.publicUrl = media.publicUrl;
  seg.displayMode = "fullscreen";
  return seg;
}

/**
 * Video-Szene nach erfolgreichem Upload: kein Browser-Frame, contain auf
 * dunklem Grund; Wiedergabefenster entstehen erst aus der Live-Aufnahme.
 */
export function createStudioVideoSegment(
  media: StudioUploadedMedia,
): VideoSegment {
  const seg = createVideoSegment({ label: stripExtension(media.name) });
  seg.mediaId = media.id;
  seg.publicUrl = media.publicUrl;
  seg.originalDurationSec = media.durationSec;
  seg.showAsBrowserFrame = false;
  return seg;
}

/** Anzahl clamp-en (Hilfsfunktion für Scroll-Ratios). */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Type-Guard-freundliche Segment-Update-Signatur für den Flow. */
export type UpdateSegmentFn = (
  tabId: string,
  update: (segment: Segment) => Segment,
) => void;
