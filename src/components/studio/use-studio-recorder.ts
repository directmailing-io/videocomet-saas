"use client";

/**
 * use-studio-recorder — MediaRecorder + Event-Log für die Live-Aufnahme.
 *
 * Zeitbasis: t=0 ist das `MediaRecorder.onstart`-Event (NICHT der
 * `start()`-Aufruf — 10–150 ms Browser-Latenz). Im onstart-Handler wird das
 * erste tabSwitch-Event auf t=0 geloggt.
 *
 * Scroll-Sampling: Wheel-Events melden nur den letzten Wert (`noteScroll`);
 * ein Sampler-Intervall (STUDIO_SCROLL_SAMPLE_MS) loggt ihn, sobald er sich
 * geändert hat. Beim Stop wird der finale Wert geflusht — Muster aus
 * scroll-recorder-modal.tsx.
 */

import * as React from "react";
import { STUDIO_SCROLL_SAMPLE_MS, type StudioEvent } from "@/lib/studio/types";
import { pickStudioMimeType, type StudioRecording } from "./internal";

export interface UseStudioRecorderResult {
  /** true zwischen onstart und Blob-Fertigstellung. */
  recording: boolean;
  error: string | null;
  /** Startet die Aufnahme; false = MediaRecorder-Init fehlgeschlagen. */
  start: (stream: MediaStream, initialTabId: string) => boolean;
  /** Beendet die Aufnahme; `onFinished` liefert das Ergebnis. */
  stop: () => void;
  /** Szenenwechsel loggen (nur während laufender Aufnahme wirksam). */
  logTabSwitch: (tabId: string) => void;
  /** Aktuelle Scroll-Position melden (wird 50-ms-gesampelt). */
  noteScroll: (tabId: string, y: number) => void;
  /** Video-Szene: Play geloggt (nur während laufender Aufnahme wirksam). */
  logMediaPlay: (tabId: string) => void;
  /** Video-Szene: Pause geloggt (nur während laufender Aufnahme wirksam). */
  logMediaPause: (tabId: string) => void;
}

export function useStudioRecorder(
  onFinished: (rec: StudioRecording) => void,
): UseStudioRecorderResult {
  const [recording, setRecording] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const mimeRef = React.useRef("video/webm");
  /** performance.now() beim onstart-Event; null = noch nicht gestartet. */
  const t0Ref = React.useRef<number | null>(null);
  const eventsRef = React.useRef<StudioEvent[]>([]);
  const recordedMsRef = React.useRef(0);
  const samplerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const disposedRef = React.useRef(false);

  /** Letzter gemeldeter Scroll-Wert (noch nicht geloggt). */
  const pendingScrollRef = React.useRef<{ tabId: string; y: number } | null>(
    null,
  );
  /** Zuletzt GELOGGTER y-Wert pro Tab (nur Änderungen loggen). */
  const lastLoggedYRef = React.useRef<Map<string, number>>(new Map());

  const onFinishedRef = React.useRef(onFinished);
  React.useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const clearSampler = React.useCallback(() => {
    if (samplerRef.current !== null) {
      clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
  }, []);

  /** Pending-Scroll loggen (optional mit explizitem Zeitstempel). */
  const flushScroll = React.useCallback((atMs?: number) => {
    const t0 = t0Ref.current;
    const p = pendingScrollRef.current;
    if (t0 === null || !p) return;
    const last = lastLoggedYRef.current.get(p.tabId);
    if (last !== undefined && Math.abs(last - p.y) < 0.0005) return;
    const t = atMs ?? performance.now() - t0;
    eventsRef.current.push({ t, type: "scroll", tabId: p.tabId, y: p.y });
    lastLoggedYRef.current.set(p.tabId, p.y);
  }, []);

  const start = React.useCallback(
    (stream: MediaStream, initialTabId: string): boolean => {
      setError(null);
      chunksRef.current = [];
      eventsRef.current = [];
      pendingScrollRef.current = null;
      lastLoggedYRef.current = new Map();
      t0Ref.current = null;
      recordedMsRef.current = 0;

      const mimeType = pickStudioMimeType();
      mimeRef.current = mimeType;

      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, { mimeType });
      } catch (err) {
        console.error("[studio-recorder] MediaRecorder init failed:", err);
        setError("Aufnahme nicht möglich. Bitte aktualisiere deinen Browser.");
        return false;
      }

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = (e) => {
        console.error("[studio-recorder] recorder error:", e);
        setError("Aufnahmefehler. Bitte erneut versuchen.");
      };
      rec.onstart = () => {
        // t=0 der gesamten Event-Zeitbasis.
        t0Ref.current = performance.now();
        eventsRef.current.push({ t: 0, type: "tabSwitch", tabId: initialTabId });
        samplerRef.current = setInterval(
          () => flushScroll(),
          STUDIO_SCROLL_SAMPLE_MS,
        );
        setRecording(true);
      };
      rec.onstop = () => {
        clearSampler();
        if (disposedRef.current) return;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        if (blob.size === 0) {
          setError(
            "Die Aufnahme war leer. Bitte erneut versuchen (mindestens 1 Sekunde aufnehmen).",
          );
          return;
        }
        onFinishedRef.current({
          blob,
          mimeType: mimeRef.current,
          recordedMs: recordedMsRef.current,
          events: [...eventsRef.current],
        });
      };

      try {
        rec.start(1000);
      } catch (err) {
        console.error("[studio-recorder] start failed:", err);
        setError("Aufnahme konnte nicht gestartet werden.");
        return false;
      }
      recorderRef.current = rec;
      return true;
    },
    [clearSampler, flushScroll],
  );

  const stop = React.useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    const t0 = t0Ref.current;
    if (t0 !== null) {
      const t = performance.now() - t0;
      // Finalen Scroll-Wert knapp VOR dem Ende loggen, damit er beim
      // Ableiten nicht aus dem letzten Segment-Fenster fällt.
      flushScroll(Math.max(0, t - 1));
      recordedMsRef.current = t;
    }
    clearSampler();
    try {
      rec.requestData();
    } catch {
      /* ignore */
    }
    try {
      rec.stop();
    } catch (err) {
      console.error("[studio-recorder] stop failed:", err);
      setError("Beenden fehlgeschlagen.");
    }
  }, [clearSampler, flushScroll]);

  const logTabSwitch = React.useCallback(
    (tabId: string) => {
      const t0 = t0Ref.current;
      if (t0 === null) return;
      // Erst den letzten Scroll-Stand der alten Szene sichern.
      flushScroll();
      eventsRef.current.push({
        t: performance.now() - t0,
        type: "tabSwitch",
        tabId,
      });
    },
    [flushScroll],
  );

  const noteScroll = React.useCallback((tabId: string, y: number) => {
    if (t0Ref.current === null) return;
    pendingScrollRef.current = { tabId, y };
  }, []);

  const logMediaPlay = React.useCallback((tabId: string) => {
    const t0 = t0Ref.current;
    if (t0 === null) return;
    eventsRef.current.push({
      t: performance.now() - t0,
      type: "mediaPlay",
      tabId,
    });
  }, []);

  const logMediaPause = React.useCallback((tabId: string) => {
    const t0 = t0Ref.current;
    if (t0 === null) return;
    eventsRef.current.push({
      t: performance.now() - t0,
      type: "mediaPause",
      tabId,
    });
  }, []);

  // Cleanup beim Unmount: Recorder hart stoppen, Ergebnis verwerfen.
  React.useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearSampler();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recorderRef.current = null;
    };
  }, [clearSampler]);

  // Stabile Identität: Effekte in phase-live hängen (transitiv) am Hook-
  // Ergebnis — ein neues Objekt pro Render würde z. B. den Countdown-Effekt
  // bei jedem Tick zurücksetzen (Countdown käme nie bei 0 an).
  return React.useMemo(
    () => ({
      recording,
      error,
      start,
      stop,
      logTabSwitch,
      noteScroll,
      logMediaPlay,
      logMediaPause,
    }),
    [
      recording,
      error,
      start,
      stop,
      logTabSwitch,
      noteScroll,
      logMediaPlay,
      logMediaPause,
    ],
  );
}
