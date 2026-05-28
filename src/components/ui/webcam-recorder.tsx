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
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - CJS module, importing both ways for robustness
import * as fixWebmDurationModule from "fix-webm-duration";

/** Resolve fix-webm-duration export robustly across CJS/ESM interop. */
function getFixFn(): (
  blob: Blob,
  durationMs: number,
  options?: { logger?: false | ((m: string) => void) },
) => Promise<Blob> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = fixWebmDurationModule as any;
  if (typeof m === "function") return m;
  if (typeof m.default === "function") return m.default;
  // Final fallback: no-op patch
  return async (blob: Blob) => blob;
}
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RecorderState = "preview" | "recording" | "review";

export interface WebcamRecorderProps {
  /** Called with the recorded blob wrapped as a File. */
  onConfirm: (file: File) => void | Promise<void>;
  /** Optional cancel handler (used by callers that show this in a Dialog). */
  onCancel?: () => void;
  /**
   * Optional max recording duration in seconds. If omitted, there is no
   * auto-stop and no countdown — the user records as long as they want.
   */
  maxDurationSec?: number;
  /** Optional className for the outer wrapper. */
  className?: string;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  // Order matters. vp8+opus produces a webm whose intrinsic videoWidth /
  // videoHeight is correctly populated by the <video> decoder in Chrome and
  // Firefox; vp9 frequently reports width=2 height=2 = unplayable preview.
  // mp4 last for Safari.
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
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
  maxDurationSec,
  className,
}: WebcamRecorderProps) {
  const hasLimit = typeof maxDurationSec === "number" && maxDurationSec > 0;
  const liveVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const reviewVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const recordingStartMsRef = React.useRef<number | null>(null);
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
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
          aspectRatio: { ideal: 16 / 9 },
          facingMode: { ideal: "user" },
        },
        audio: true,
      });
      streamRef.current = stream;
      setHasStream(true);
      // Log actual track settings so we know what resolution we got.
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        const s = vt.getSettings();
        console.log(
          `[webcam-recorder] video track: ${s.width}x${s.height} @${s.frameRate}fps`,
        );
      }
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
        msg = "Keine Kamera oder kein Mikrofon gefunden. Bitte schliesse ein Gerät an und versuche es erneut.";
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
      setRecordError("Aufnahme nicht möglich. Bitte aktualisiere den Browser.");
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
      const totalBytes = chunksRef.current.reduce((s, c) => s + c.size, 0);
      const recordedMs = Date.now() - (recordingStartMsRef.current ?? Date.now());
      console.log(
        `[webcam-recorder] onstop: chunks=${chunksRef.current.length} totalBytes=${totalBytes} recordedMs=${recordedMs} mime=${mimeRef.current}`,
      );
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      if (blob.size === 0) {
        setRecordError(
          "Aufnahme war leer. Bitte erneut versuchen (mindestens 1 Sekunde aufnehmen).",
        );
        setState("preview");
        return;
      }
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      console.log(`[webcam-recorder] setting review url=${url}`);
      setReviewUrl(url);
      setState("review");
      stopStream();
    };

    // 1 second timeslice → reliable dataavailable events even on Chromium edge cases.
    try {
      rec.start(1000);
      recordingStartMsRef.current = Date.now();
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

    if (hasLimit) {
      autoStopRef.current = setTimeout(() => {
        const r = recorderRef.current;
        if (r && r.state !== "inactive") {
          try { r.requestData(); } catch { /* ignore */ }
          try { r.stop(); } catch { /* ignore */ }
        }
      }, (maxDurationSec as number) * 1000);
    }
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

  const remaining = hasLimit
    ? Math.max(0, (maxDurationSec as number) - elapsed)
    : 0;
  const overTime = hasLimit && elapsed >= (maxDurationSec as number);

  // Force the browser to compute duration + decode the first frame for blobs
  // that lack a finite duration in their container header. Tries autoplay so
  // the user immediately sees the recording move; the controls=true lets them
  // pause/scrub. Muted so autoplay isn't blocked by browser policy.
  const onReviewLoadedMetadata = React.useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      console.log(
        `[webcam-recorder] review onLoadedMetadata: duration=${v.duration} readyState=${v.readyState}`,
      );
      if (!Number.isFinite(v.duration) || v.duration === 0) {
        const onUpdate = () => {
          v.removeEventListener("timeupdate", onUpdate);
          console.log(
            `[webcam-recorder] review duration after seek: ${v.duration}`,
          );
          try {
            v.currentTime = 0.05;
          } catch { /* ignore */ }
        };
        v.addEventListener("timeupdate", onUpdate);
        try {
          v.currentTime = Number.MAX_SAFE_INTEGER;
        } catch { /* ignore */ }
      } else {
        // Nudge currentTime off zero so the decoder draws a non-black frame
        try {
          v.currentTime = 0.05;
        } catch { /* ignore */ }
      }
    },
    [],
  );

  const onReviewLoadedData = React.useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      console.log(
        `[webcam-recorder] review onLoadedData: width=${v.videoWidth} height=${v.videoHeight}`,
      );
      // Try to play right away — muted, so browser policy allows it.
      v.play().catch((err) => {
        console.warn("[webcam-recorder] review autoplay rejected:", err);
      });
    },
    [],
  );

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
                Aufnahme läuft
              </span>
              <div className="h-6 w-px bg-line" aria-hidden />
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-2xl font-bold text-ink">{formatTime(elapsed)}</span>
                {hasLimit && (
                  <span className="text-sm text-ink-muted">
                    / {formatTime(maxDurationSec as number)}
                  </span>
                )}
              </div>
              {hasLimit && (
                <>
                  <div className="h-6 w-px bg-line" aria-hidden />
                  <span className={cn(
                    "text-xs font-semibold tabular-nums",
                    remaining <= 10 ? "text-danger" : "text-ink-muted",
                  )}>
                    {overTime ? "Maximum erreicht" : `noch ${formatTime(remaining)}`}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="relative aspect-video w-full overflow-hidden rounded-squircle-md bg-ink">
            {state === "review" && reviewUrl ? (
              <video
                ref={reviewVideoRef}
                src={reviewUrl}
                controls
                preload="auto"
                playsInline
                autoPlay
                muted
                onLoadedMetadata={onReviewLoadedMetadata}
                onLoadedData={onReviewLoadedData}
                onError={(e) => {
                  console.error(
                    "[webcam-recorder] review video error:",
                    e.currentTarget.error,
                  );
                }}
                className="h-full w-full object-contain bg-ink"
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

            {/*
              Composition guide: a subtle vertically-tight circle, centered on
              the frame. Visible during preview + recording (not in review).
              Helps the user frame themselves so that when the final clip is
              displayed as a circular PiP overlay, nothing important gets
              cropped off the top or bottom.
              - aspect-square + h-full → diameter equals frame height
              - centered horizontally via inset-y-0 + mx-auto
              - dezent: 1px weisse Linie mit 35% Alpha + sehr leichter Schatten
            */}
            {(state === "preview" || state === "recording") && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 aspect-square h-full rounded-full border border-white/35"
                style={{
                  boxShadow:
                    "0 0 0 1px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.06)",
                }}
              />
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
