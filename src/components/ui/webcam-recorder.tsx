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

/**
 * Best-effort MIME-type pick: vp9+opus is highest quality but not all browsers
 * support it (Safari, older Firefox). Falls back to plain video/webm, which is
 * universally supported by browsers exposing MediaRecorder.
 */
function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
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
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = React.useState<RecorderState>("preview");
  const [elapsed, setElapsed] = React.useState(0);
  const [permError, setPermError] = React.useState<string | null>(null);
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

  // Initialise camera on mount (and on retry).
  const initCamera = React.useCallback(async () => {
    setPermError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      setHasStream(true);
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        // play() can reject on autoplay policy; ignore.
        liveVideoRef.current.play().catch(() => {
          /* ignore */
        });
      }
    } catch (err) {
      console.error("[webcam-recorder] getUserMedia failed:", err);
      const name =
        err instanceof Error && "name" in err ? (err as Error).name : "Error";
      let msg = "Mikrofon/Kamera-Zugriff erforderlich.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg =
          "Zugriff auf Kamera und Mikrofon wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg =
          "Keine Kamera oder kein Mikrofon gefunden. Bitte schliesse ein Geraet an und versuche es erneut.";
      } else if (name === "NotReadableError") {
        msg =
          "Kamera oder Mikrofon werden bereits von einer anderen Anwendung verwendet.";
      }
      setPermError(msg);
    }
  }, []);

  // Initialise on mount; cleanup on unmount.
  React.useEffect(() => {
    void initCamera();
    return () => {
      clearTimers();
      stopStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke object URL when review changes / unmounts.
  React.useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [reviewUrl]);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    setElapsed(0);

    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(streamRef.current, { mimeType });
    } catch (err) {
      console.error("[webcam-recorder] MediaRecorder init failed:", err);
      setPermError("Aufnahme nicht moeglich. Bitte aktualisiere den Browser.");
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      clearTimers();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setReviewUrl(url);
      setState("review");
      // Stop camera stream once we have the recording.
      stopStream();
    };

    rec.start();
    recorderRef.current = rec;
    setState("recording");

    // Tick-based timer for display.
    timerRef.current = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);

    // Auto-stop at max duration.
    autoStopRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    }, maxDurationSec * 1000);
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  async function reRecord() {
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl);
      setReviewUrl(null);
    }
    setRecordedBlob(null);
    setElapsed(0);
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
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    stopStream();
    onCancel?.();
  }

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
            <Button size="sm" onClick={initCamera}>
              Erneut versuchen
            </Button>
            {onCancel && (
              <Button
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

            {state === "recording" && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span className="inline-block size-2 animate-pulse rounded-full bg-danger" />
                REC
                <span className="font-mono tabular-nums">
                  {formatTime(elapsed)}
                </span>
                <span className="text-white/60">
                  / {formatTime(maxDurationSec)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {state === "preview" && (
              <>
                <Button
                  onClick={startRecording}
                  iconLeft={<Circle className="size-4 fill-current" />}
                  disabled={!hasStream}
                >
                  Aufnahme starten
                </Button>
                {onCancel && (
                  <Button variant="ghost" onClick={handleCancel}>
                    Abbrechen
                  </Button>
                )}
              </>
            )}

            {state === "recording" && (
              <Button
                variant="danger"
                onClick={stopRecording}
                iconLeft={<Square className="size-4 fill-current" />}
              >
                Stopp
              </Button>
            )}

            {state === "review" && (
              <>
                <Button
                  onClick={handleConfirm}
                  loading={confirming}
                  iconLeft={<Check className="size-4" />}
                >
                  Verwenden
                </Button>
                <Button
                  variant="ghost"
                  onClick={reRecord}
                  disabled={confirming}
                  iconLeft={<RotateCcw className="size-4" />}
                >
                  Neu aufnehmen
                </Button>
                {onCancel && (
                  <Button
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

          {state === "preview" && !hasStream && (
            <p className="text-center text-xs text-ink-muted">
              Initialisiere Kamera ...
            </p>
          )}
        </>
      )}
    </div>
  );
}
