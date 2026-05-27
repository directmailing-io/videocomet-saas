"use client";

import * as React from "react";
import {
  Circle,
  Square,
  RotateCcw,
  Check,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RecorderState = "preview" | "recording" | "review";

export interface WebcamRecorderProps {
  /** Called with the recorded blob wrapped as a File. */
  onConfirm: (file: File) => void | Promise<void>;
  /** Optional cancel handler (used by callers that show this in a Dialog). */
  onCancel?: () => void;
  /** Max recording duration in seconds. Default: 120s. */
  maxDurationSec?: number;
  /** Optional className for the outer wrapper. */
  className?: string;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
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

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60).toString().padStart(2, "0");
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function WebcamRecorder({
  onConfirm,
  onCancel,
  maxDurationSec = 120,
  className,
}: WebcamRecorderProps) {
  const liveVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const reviewVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const mimeRef = React.useRef<string>("video/webm");
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = React.useState<RecorderState>("preview");
  const [elapsed, setElapsed] = React.useState(0);
  const [permError, setPermError] = React.useState<string | null>(null);
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = React.useState<Blob | null>(null);
  const [reviewUrl, setReviewUrl] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [hasStream, setHasStream] = React.useState(false);

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasStream(false);
  }, []);

  const clearTimers = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoStopRef.current !== null) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const initCamera = React.useCallback(async () => {
    setPermError(null);
    setRecordError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      setHasStream(true);
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error("[webcam-recorder] getUserMedia failed:", err);
      const name = err instanceof Error && "name" in err ? (err as Error).name : "Error";
      let msg = "Mikrofon/Kamera-Zugriff erforderlich.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg = "Zugriff auf Kamera und Mikrofon wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "Keine Kamera oder kein Mikrofon gefunden. Bitte schliesse ein Geraet an und versuche es erneut.";
      } else if (name === "NotReadableError") {
        msg = "Kamera oder Mikrofon werden bereits von einer anderen Anwendung verwendet.";
      }
      setPermError(msg);
    }
  }, []);

  React.useEffect(() => {
    void initCamera();
    return () => {
      clearTimers();
      stopStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [reviewUrl]);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setElapsed(0);
    setRecordError(null);

    const mimeType = pickMimeType();
    mimeRef.current = mimeType;

    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(streamRef.current, { mimeType });
    } catch (err) {
      console.error("[webcam-recorder] MediaRecorder init failed:", err);
      setRecordError("Aufnahme nicht moeglich. Bitte aktualisiere den Browser.");
      return;
    }

    rec.ondataavailable = (e) => {
      console.log("[webcam-recorder] dataavailable: size=" + (e.data?.size ?? 0));
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = (e) => {
      console.error("[webcam-recorder] recorder error:", e);
      setRecordError("Aufnahmefehler. Bitte erneut versuchen.");
    };
    rec.onstop = () => {
      clearTimers();
      console.log(
        "[webcam-recorder] onstop: chunks=" +
          chunksRef.current.length +
          " totalBytes=" +
          chunksRef.current.reduce((s, c) => s + c.size, 0),
      );
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      if (blob.size === 0) {
        setRecordError(
          "Aufnahme war leer. Bitte erneut versuchen (mindestens 1 Sekunde aufnehmen).",
        );
        // Stay in recording state allowing user to retry by going back to preview.
        setState("preview");
        return;
      }
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setReviewUrl(url);
      setState("review");
      stopStream();
    };

    // 1 second timeslice → reliable dataavailable events even on Chromium edge cases.
    try {
      rec.start(1000);
    } catch (err) {
      console.error("[webcam-recorder] start failed:", err);
      setRecordError("Aufnahme konnte nicht gestartet werden.");
      return;
    }
    recorderRef.current = rec;
    setState("recording");

    timerRef.current = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);

    autoStopRef.current = setTimeout(() => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try { r.requestData(); } catch { /* ignore */ }
        try { r.stop(); } catch { /* ignore */ }
      }
    }, maxDurationSec * 1000);
  }

  function stopRecording() {
    console.log("[webcam-recorder] stopRecording clicked");
    const r = recorderRef.current;
    if (!r) {
      console.warn("[webcam-recorder] no recorder ref");
      return;
    }
    if (r.state === "inactive") {
      console.warn("[webcam-recorder] recorder already inactive");
      return;
    }
    // Flush any buffered data before stopping → guarantees ondataavailable fires.
    try { r.requestData(); } catch { /* ignore */ }
    try { r.stop(); } catch (err) {
      console.error("[webcam-recorder] stop failed:", err);
      setRecordError("Beenden fehlgeschlagen.");
    }
  }

  async function reRecord() {
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl);
      setReviewUrl(null);
    }
    setRecordedBlob(null);
    setElapsed(0);
    setRecordError(null);
    setState("preview");
    await initCamera();
  }

  async function handleConfirm() {
    if (!recordedBlob) return;
    setConfirming(true);
    try {
      const filename = `videocomet-webcam-${Date.now()}.webm`;
      const file = new File([recordedBlob], filename, {
        type: recordedBlob.type || "video/webm",
      });
      await onConfirm(file);
    } finally {
      setConfirming(false);
    }
  }

  function handleCancel() {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    stopStream();
    onCancel?.();
  }

  const remaining = Math.max(0, maxDurationSec - elapsed);
  const overTime = elapsed >= maxDurationSec;

  return (
    <div className={cn("space-y-4", className)}>
      {permError ? (
        <div className="rounded-squircle-md border border-danger/30 bg-danger/5 p-6 text-center">
          <AlertCircle className="size-8 text-danger mx-auto mb-3" />
          <p className="text-sm font-semibold text-ink mb-1">
            Mikrofon/Kamera-Zugriff erforderlich
          </p>
          <p className="text-xs text-ink-muted mb-4 max-w-md mx-auto leading-relaxed">
            {permError}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={initCamera}>
              Erneut versuchen
            </Button>
            {onCancel && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                iconLeft={<X className="size-4" />}
              >
                Abbrechen
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Prominent timer banner — visible above the video while recording. */}
          {state === "recording" && (
            <div className="flex items-center justify-center gap-4 rounded-squircle-md border border-danger/20 bg-danger/5 px-5 py-4">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-danger">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60"></span>
                  <span className="relative inline-flex size-3 rounded-full bg-danger"></span>
                </span>
                Aufnahme laeuft
              </span>
              <div className="h-6 w-px bg-line" aria-hidden />
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-2xl font-bold text-ink">{formatTime(elapsed)}</span>
                <span className="text-sm text-ink-muted">/ {formatTime(maxDurationSec)}</span>
              </div>
              <div className="h-6 w-px bg-line" aria-hidden />
              <span className={cn(
                "text-xs font-semibold tabular-nums",
                remaining <= 10 ? "text-danger" : "text-ink-muted",
              )}>
                {overTime ? "Maximum erreicht" : `noch ${formatTime(remaining)}`}
              </span>
            </div>
          )}

          <div className="relative aspect-video w-full overflow-hidden rounded-squircle-md bg-ink">
            {state === "review" && reviewUrl ? (
              <video
                ref={reviewVideoRef}
                src={reviewUrl}
                controls
                className="h-full w-full object-cover"
              />
            ) : (
              <video
                ref={liveVideoRef}
                className="h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
            )}

            {/* Compact timer overlay on the video itself (also still visible). */}
            {state === "recording" && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span className="inline-block size-2 animate-pulse rounded-full bg-danger" />
                REC
                <span className="font-mono tabular-nums">{formatTime(elapsed)}</span>
              </div>
            )}
          </div>

          {recordError && (
            <div className="rounded-squircle-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {recordError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {state === "preview" && (
              <>
                <Button
                  type="button"
                  onClick={startRecording}
                  iconLeft={<Circle className="size-4 fill-current" />}
                  disabled={!hasStream}
                >
                  Aufnahme starten
                </Button>
                {onCancel && (
                  <Button type="button" variant="ghost" onClick={handleCancel}>
                    Abbrechen
                  </Button>
                )}
              </>
            )}

            {state === "recording" && (
              <Button
                type="button"
                variant="danger"
                onClick={stopRecording}
                iconLeft={<Square className="size-4 fill-current" />}
              >
                Aufnahme beenden
              </Button>
            )}

            {state === "review" && (
              <>
                <Button
                  type="button"
                  onClick={handleConfirm}
                  loading={confirming}
                  iconLeft={<Check className="size-4" />}
                >
                  Verwenden
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={reRecord}
                  disabled={confirming}
                  iconLeft={<RotateCcw className="size-4" />}
                >
                  Neu aufnehmen
                </Button>
                {onCancel && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleCancel}
                    disabled={confirming}
                  >
                    Abbrechen
                  </Button>
                )}
              </>
            )}
          </div>

          {state === "preview" && !hasStream && !permError && (
            <p className="text-center text-xs text-ink-muted">
              Initialisiere Kamera ...
            </p>
          )}
        </>
      )}
    </div>
  );
}
