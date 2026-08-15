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
  | "gslide"
  | "canva"
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
  if (
    k === "gdocs" ||
    k === "gslide" ||
    k === "canva" ||
    k === "pdf" ||
    k === "text"
  )
    return k;
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
    case "gslide":
    case "canva":
      // Thumbnail kommt direkt aus dem Import/Upload → sofort bereit.
      return !!seg.thumbnailUrl;
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
    case "gslide":
    case "canva":
      return seg.thumbnailUrl ? [seg.thumbnailUrl] : [];
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
    case "gslide":
    case "canva":
      return "Folie";
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

/* ------------------------------------------------------------------ */
/* Deck-Gruppierung (Google Slides / Canva)                            */
/* ------------------------------------------------------------------ */

/**
 * Deck-Zugehörigkeit eines Tabs: Folien desselben Slides-/Canva-Imports
 * teilen sich einen Key. null = keine Folie / kein Deck.
 */
export function deckKeyOf(tab: StudioTab): string | null {
  const seg = tab.segment;
  if (seg.kind === "gslide" && seg.publishedUrl) {
    return `gslide:${seg.publishedUrl}`;
  }
  if (seg.kind === "canva" && seg.pptxMediaId) {
    return `canva:${seg.pptxMediaId}`;
  }
  return null;
}

/** Ein Eintrag der Tab-Leiste: Einzel-Szene oder ganzes Folien-Deck. */
export interface StudioTabGroup {
  /** Stabiler Render-Key (Tab-ID der ersten Folie). */
  id: string;
  /** null = Einzel-Szene. */
  deckKey: string | null;
  tabs: StudioTab[];
}

/**
 * Aufeinanderfolgende Folien desselben Decks zu EINEM Leisten-Eintrag
 * gruppieren. Reine Anzeige-Logik — das Szenen-Array selbst (Datenmodell,
 * Aufnahme, Segment-Ableitung) bleibt unverändert eine flache Liste.
 */
export function groupStudioTabs(tabs: StudioTab[]): StudioTabGroup[] {
  const groups: StudioTabGroup[] = [];
  for (const tab of tabs) {
    const key = deckKeyOf(tab);
    const last = groups[groups.length - 1];
    if (key && last && last.deckKey === key) {
      last.tabs.push(tab);
    } else {
      groups.push({ id: tab.id, deckKey: key, tabs: [tab] });
    }
  }
  return groups;
}

/** Anzeigename eines Decks (Canva: Dateiname, sonst „Präsentation"). */
export function deckLabel(group: StudioTabGroup): string {
  const seg = group.tabs[0]?.segment;
  if (seg?.kind === "canva" && seg.fileName) {
    return stripExtension(seg.fileName);
  }
  return "Präsentation";
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

const CLOUD_FILE_HINT =
  "Die Datei konnte nicht gelesen werden. Sie liegt vermutlich nur in der " +
  "Cloud (Google Drive oder iCloud) und nicht wirklich auf deinem Rechner. " +
  "Kopiere die Datei z. B. auf den Schreibtisch und wähle sie von dort aus.";

/**
 * Datei vollständig in den Speicher lesen, BEVOR der Upload startet.
 * Cloud-Platzhalter (Google Drive Streaming, iCloud „Speicher optimieren")
 * liefern dem Browser sonst keine Bytes — der Upload hängt still bei 0 %.
 * Das Lesen zwingt den Download an und macht Lesefehler als Klartext
 * sichtbar; ein Watchdog bricht ab, wenn 20 s lang keine Bytes ankommen.
 */
function readFileFully(
  file: File,
  onProgress: (pct: number) => void,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let lastActivity = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > 20_000) {
        clearInterval(watchdog);
        reader.abort();
        reject(new Error(CLOUD_FILE_HINT));
      }
    }, 5_000);
    reader.onprogress = (e) => {
      lastActivity = Date.now();
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    reader.onerror = () => {
      clearInterval(watchdog);
      reject(new Error(CLOUD_FILE_HINT));
    };
    reader.onload = () => {
      clearInterval(watchdog);
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error(CLOUD_FILE_HINT));
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Upload einer PPTX-Datei zu POST /api/canva/upload — Datei wird erst
 * komplett gelesen (erzwingt Cloud-Download), dann per XHR mit
 * Fortschritt hochgeladen; Hänger enden in verständlichen Fehlertexten.
 */
export async function uploadCanvaPptxFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ mediaId: string; publicUrl: string; fileName: string | null }> {
  if (file.size === 0) throw new Error(CLOUD_FILE_HINT);
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(
      "Die Datei ist zu groß zum Hochladen (max. 50 MB). Exportiere die Präsentation ggf. neu.",
    );
  }

  // Lesen = 0–30 %, Upload = 30–100 % der Fortschrittsanzeige.
  const buf = await readFileFully(file, (p) => onProgress(Math.round(p * 0.3)));
  const blob = new Blob([buf], {
    type:
      file.type ||
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", blob, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/canva/upload");
    xhr.withCredentials = true;
    const abortMsg =
      "Der Upload wurde unterbrochen. Prüfe dein Internet und versuche es erneut.";
    // Watchdog: 45 s ohne Upload-Fortschritt → abbrechen statt ewig warten.
    let lastActivity = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > 45_000) {
        clearInterval(watchdog);
        xhr.abort();
      }
    }, 5_000);
    xhr.upload.onprogress = (e) => {
      lastActivity = Date.now();
      if (e.lengthComputable && e.total > 0) {
        onProgress(30 + Math.round((e.loaded / e.total) * 70));
      }
    };
    xhr.onerror = () => {
      clearInterval(watchdog);
      reject(new Error(abortMsg));
    };
    xhr.onabort = () => {
      clearInterval(watchdog);
      reject(new Error(abortMsg));
    };
    xhr.onload = () => {
      clearInterval(watchdog);
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg =
          xhr.status === 413
            ? "Die Datei ist zu groß zum Hochladen (max. 50 MB). Exportiere die Präsentation ggf. neu."
            : `Die Datei konnte nicht hochgeladen werden (Fehler ${xhr.status}). Bitte versuche es erneut.`;
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
          mediaId?: string;
          publicUrl?: string;
          fileName?: string;
        };
        if (!j.mediaId || !j.publicUrl) {
          return reject(
            new Error(
              "Die Datei konnte nicht hochgeladen werden. Bitte versuche es erneut.",
            ),
          );
        }
        resolve({
          mediaId: j.mediaId,
          publicUrl: j.publicUrl,
          fileName: j.fileName ?? null,
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
