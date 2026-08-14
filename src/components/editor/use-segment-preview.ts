"use client";

/**
 * use-segment-preview — Client-Hook + Cache für Website-/GDocs-Screenshots.
 *
 * Kapselt den Screenshot-Job-Flow aus `scroll-recorder-modal.tsx`:
 *   1. POST /api/screenshot { url }        → { jobId }
 *   2. GET  /api/screenshot/[jobId]        → 1s-Polling bis done/failed
 *      (60s-Timeout — identisch zum Recorder-Modal)
 *
 * Ergebnisse werden in einem Modul-Level-Cache pro normalisierter URL
 * gehalten (inkl. laufender Promises), damit mehrere Segmente/Re-Mounts
 * denselben Job teilen und keine doppelten Worker-Jobs entstehen.
 */

import * as React from "react";
import { friendlyScreenshotError } from "@/lib/screenshot-error-text";

/**
 * Vereinigtes Ergebnis beider Screenshot-Flows. Die API liefert je nach
 * Ziel-URL unterschiedliche Felder — wir lesen defensiv beides:
 *   - Website:      imageUrl + width/height (fullPage-JPG)
 *   - Google Docs:  pageImageUrls + docWidth/docHeight/pageCount
 *                   (permanente Bunny-Seiten-PNGs, NIE die TTL-previewUrl)
 */
export interface SegmentPreviewData {
  /** FullPage-Screenshot (Website-Flow). */
  imageUrl?: string;
  width?: number;
  height?: number;
  /** Seiten-PNGs (GDocs-Flow, permanente Bunny-URLs). */
  pageImageUrls?: string[];
  /** Pixel-Maße EINER Seite (150 dpi). */
  docWidth?: number;
  docHeight?: number;
  pageCount?: number;
}

interface ScreenshotJobResponse {
  status?: "pending" | "running" | "done" | "failed";
  imageUrl?: string;
  width?: number;
  height?: number;
  previewUrl?: string;
  pageImageUrls?: string[];
  docWidth?: number;
  docHeight?: number;
  pageCount?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * URL normalisieren, damit Cache-Hits nicht an Formatierungs-Details
 * scheitern: trim, Host lowercase, Hash entfernen.
 */
export function normalizePreviewUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.host = u.host.toLowerCase();
    return u.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Modul-Level-Cache: normalisierte URL → fertiges Ergebnis ODER laufendes
 * Promise. Laufende Promises werden geteilt (Dedupe paralleler Aufrufer);
 * fehlgeschlagene Promises werden aus dem Cache entfernt, damit ein
 * erneuter Versuch möglich bleibt.
 */
const previewCache = new Map<
  string,
  SegmentPreviewData | Promise<SegmentPreviewData>
>();

async function runScreenshotJob(url: string): Promise<SegmentPreviewData> {
  const res = await fetch("/api/screenshot", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const { jobId } = (await res.json()) as { jobId: string };
  if (!jobId) throw new Error("Screenshot-Job ohne jobId.");

  const startedAt = Date.now();
  // 1s-Polling bis done/failed — 60s-Timeout wie im Scroll-Recorder.
  for (;;) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error(
        "Vorschau-Erzeugung dauerte zu lange. Der Worker antwortet nicht.",
      );
    }
    const r = await fetch(`/api/screenshot/${jobId}`, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!r.ok) {
      throw new Error(`Vorschau konnte nicht geladen werden (HTTP ${r.status}).`);
    }
    const data = (await r.json()) as ScreenshotJobResponse;
    if (data.status === "done") {
      // Felder defensiv optional lesen — je nach Flow ist nur eine
      // Teilmenge gesetzt.
      const result: SegmentPreviewData = {
        imageUrl: data.imageUrl,
        width: data.width,
        height: data.height,
        pageImageUrls: data.pageImageUrls,
        docWidth: data.docWidth,
        docHeight: data.docHeight,
        pageCount: data.pageCount,
      };
      if (!result.imageUrl && (!result.pageImageUrls || result.pageImageUrls.length === 0)) {
        throw new Error(
          "Vorschau-Antwort ohne Bild- oder Seiten-Quelle. Bitte erneut versuchen.",
        );
      }
      return result;
    }
    if (data.status === "failed") {
      // Worker-Fehler sind rohe Puppeteer-/Netzwerk-Meldungen — für die
      // UI in Laien-Deutsch übersetzen.
      throw new Error(friendlyScreenshotError(data.error));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Cache-bewusster Einzelabruf (auch ohne Hook nutzbar, z. B. für
 * „Vorschau laden"-Buttons in den Editor-Panels).
 *
 * @param force Cache-Bust: verwirft den Eintrag und startet einen neuen Job
 *              („Vorschau aktualisieren").
 */
export function fetchSegmentPreview(
  rawUrl: string,
  opts?: { force?: boolean },
): Promise<SegmentPreviewData> {
  const key = normalizePreviewUrl(rawUrl);
  if (!key) return Promise.reject(new Error("Keine URL angegeben."));

  if (opts?.force) previewCache.delete(key);

  const cached = previewCache.get(key);
  if (cached) {
    return cached instanceof Promise ? cached : Promise.resolve(cached);
  }

  const promise = runScreenshotJob(key)
    .then((result) => {
      previewCache.set(key, result);
      return result;
    })
    .catch((err: unknown) => {
      // Fehlgeschlagene Jobs nicht cachen — nächster Aufruf darf retryen.
      previewCache.delete(key);
      throw err;
    });
  previewCache.set(key, promise);
  return promise;
}

export type SegmentPreviewStatus = "idle" | "loading" | "done" | "error";

export interface UseSegmentPreviewResult {
  status: SegmentPreviewStatus;
  data: SegmentPreviewData | null;
  error: string | null;
  /** Manuell (erneut) laden; `force` bustet den Cache. */
  load: (opts?: { force?: boolean }) => Promise<SegmentPreviewData | null>;
}

/**
 * React-Hook um `fetchSegmentPreview`. Bei `auto: true` (Default) wird der
 * Abruf gestartet, sobald eine URL vorliegt — dank Modul-Cache teilen sich
 * mehrere Konsumenten (Editor-Panel + Bühnen-Vorschau) denselben Job.
 */
export function useSegmentPreview(
  url: string | null | undefined,
  opts?: { auto?: boolean },
): UseSegmentPreviewResult {
  const auto = opts?.auto ?? true;
  const normalized = url ? normalizePreviewUrl(url) : "";

  const [state, setState] = React.useState<{
    key: string;
    status: SegmentPreviewStatus;
    data: SegmentPreviewData | null;
    error: string | null;
  }>({ key: "", status: "idle", data: null, error: null });

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = React.useCallback(
    async (loadOpts?: { force?: boolean }): Promise<SegmentPreviewData | null> => {
      if (!normalized) return null;
      const key = normalized;
      setState({ key, status: "loading", data: null, error: null });
      try {
        const data = await fetchSegmentPreview(key, loadOpts);
        if (mountedRef.current) {
          setState({ key, status: "done", data, error: null });
        }
        return data;
      } catch (err) {
        if (mountedRef.current) {
          setState({
            key,
            status: "error",
            data: null,
            error: err instanceof Error ? err.message : "Netzwerkfehler.",
          });
        }
        return null;
      }
    },
    [normalized],
  );

  // Auto-Load: sobald sich die (normalisierte) URL ändert, neu laden.
  React.useEffect(() => {
    if (!auto || !normalized) return;
    void load();
    // `load` ist an `normalized` gebunden — genau die gewünschte Dependency.
  }, [auto, normalized, load]);

  // Ergebnis nur melden, wenn es zur aktuellen URL gehört (Stale-Guard
  // beim schnellen URL-Wechsel im Panel).
  const isCurrent = state.key === normalized;
  return {
    status: isCurrent ? state.status : "idle",
    data: isCurrent ? state.data : null,
    error: isCurrent ? state.error : null,
    load,
  };
}
