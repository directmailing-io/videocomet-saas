"use client";

/**
 * WebcamRecorder — getUserMedia + MediaRecorder + immediate server upload.
 *
 * Why we upload to the server right after stop, instead of showing a blob: URL
 * preview in the browser:
 *   MediaRecorder produces WebM containers without a Duration tag in the EBML
 *   header. Chrome/Firefox then play these blob: URLs with `videoWidth=2` and
 *   `duration=Infinity`, which makes the preview black and unscrubbable. Every
 *   "fix-webm-duration" workaround we tried failed at chunk/codec edge cases.
 *
 *   Bunny Edge Storage, on the other hand, serves the same bytes back over
 *   HTTPS with Range support, and every browser plays the file correctly.
 *   So: record → upload → preview from CDN URL. Robust by construction.
 *
 * Flow:
 *   preview   → user clicks "Aufnahme starten"
 *   recording → user clicks "Aufnahme beenden"
 *   uploading → blob is POSTed to /api/media (kind=webcam)
 *   review    → <video src={mediaItem.publicUrl}> plays the file
 *               "Verwenden" → onConfirm(media)
 *               "Neu aufnehmen" → DELETE media + back to preview
 *   error     → permission denied / network error etc.
 */

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

export interface RecordedMedia {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

type RecorderState =
  | "preview"
  | "recording"
  | "uploading"
  | "verifying"
  | "review";

export interface WebcamRecorderProps {
  /** Called when the user clicks "Verwenden" — receives the already-uploaded media. */
  onConfirm: (media: RecordedMedia) => void | Promise<void>;
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

/**
 * vp8+opus has the most robust intrinsic-dimensions handling across browsers.
 * vp9 produces webm blobs that some Chrome builds decode with width=2 height=2.
 */
function pickMimeType(): string {
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

/**
 * Bunny Edge Storage kann unmittelbar nach dem PUT ein paar hundert
 * Millisekunden brauchen, bis das File via CDN ausgeliefert wird. Wir pingen
 * die URL mit HEAD, retrying bis maxAttempts. Gibt true zurück, sobald ein
 * Status 200 kommt. Fehlschläge sind nicht hart — der <video>-Tag versucht
 * es eh nochmal.
 */
async function verifyAvailability(
  url: string,
  maxAttempts = 6,
  delayMs = 500,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (r.ok) return true;
    } catch {
      /* network hiccup → retry */
    }
    if (i < maxAttempts - 1) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  return false;
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
  const mimeRef = React.useRef<string>("video/webm");
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = React.useState<RecorderState>("preview");
  const [elapsed, setElapsed] = React.useState(0);
  const [permError, setPermError] = React.useState<string | null>(null);
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [reviewMedia, setReviewMedia] = React.useState<RecordedMedia | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [hasStream, setHasStream] = React.useState(false);
  // Status der Wiedergabe in der Review-Phase, damit wir dem Nutzer klar zeigen
  // können, ob das Video schon laden konnte (sonst denkt er, „der Player ist
  // kaputt"). Ein silent retry über reviewReloadKey hilft gegen Bunny-Edge-
  // Cache-Misses unmittelbar nach dem Upload.
  const [reviewLoadState, setReviewLoadState] =
    React.useState<"loading" | "ready" | "error">("loading");
  const [reviewReloadKey, setReviewReloadKey] = React.useState(0);

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
        msg = "Keine Kamera oder kein Mikrofon gefunden. Bitte schließe ein Gerät an und versuche es erneut.";
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

  /** Upload the blob to /api/media (kind=webcam) with XHR for progress. */
  function uploadBlob(blob: Blob, recordedSeconds: number): Promise<RecordedMedia> {
    return new Promise((resolve, reject) => {
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const filename = `videocomet-webcam-${Date.now()}.${ext}`;
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
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(pct);
        }
      };
      xhr.onerror = () => reject(new Error("Netzwerkfehler beim Upload."));
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          let msg = `HTTP ${xhr.status}`;
          try {
            const j = JSON.parse(xhr.responseText) as { error?: string };
            if (j.error) msg = j.error;
          } catch { /* ignore */ }
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
          reject(e instanceof Error ? e : new Error("Antwort konnte nicht gelesen werden."));
        }
      };
      xhr.send(form);
    });
  }

  async function handleStopComplete() {
    const totalBytes = chunksRef.current.reduce((s, c) => s + c.size, 0);
    console.log(
      `[webcam-recorder] onstop: chunks=${chunksRef.current.length} totalBytes=${totalBytes} mime=${mimeRef.current}`,
    );
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) {
      setRecordError(
        "Aufnahme war leer. Bitte erneut versuchen (mindestens 1 Sekunde aufnehmen).",
      );
      setState("preview");
      return;
    }

    setState("uploading");
    setUploadProgress(0);
    stopStream();

    try {
      const media = await uploadBlob(blob, elapsed);
      console.log(`[webcam-recorder] uploaded media id=${media.id} url=${media.publicUrl} duration=${media.durationSec ?? "n/a"}`);
      // Kurze Verifikations-Phase: prüfen, dass Bunny Edge das frische File
      // auch wirklich ausliefert (HEAD). Damit verschwindet das „der Player
      // ist schwarz und ruckelt"-Erlebnis direkt nach dem Upload.
      setReviewMedia(media);
      setState("verifying");
      setReviewLoadState("loading");
      void verifyAvailability(media.publicUrl).then((ok) => {
        if (!ok) {
          console.warn("[webcam-recorder] HEAD verify failed, switching to review anyway");
        }
        setState("review");
      });
    } catch (e) {
      console.error("[webcam-recorder] upload failed:", e);
      setRecordError(
        e instanceof Error ? `Upload fehlgeschlagen: ${e.message}` : "Upload fehlgeschlagen.",
      );
      setState("preview");
      await initCamera();
    }
  }

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
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = (e) => {
      console.error("[webcam-recorder] recorder error:", e);
      setRecordError("Aufnahmefehler. Bitte erneut versuchen.");
    };
    rec.onstop = () => {
      clearTimers();
      // Defer the async upload work to a separate function to keep onstop sync.
      void handleStopComplete();
    };

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
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try { r.requestData(); } catch { /* ignore */ }
    try { r.stop(); } catch (err) {
      console.error("[webcam-recorder] stop failed:", err);
      setRecordError("Beenden fehlgeschlagen.");
    }
  }

  async function deleteReviewMedia() {
    const m = reviewMedia;
    if (!m) return;
    try {
      await fetch(`/api/media/${m.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch (e) {
      console.warn("[webcam-recorder] could not delete review media:", e);
    }
  }

  async function reRecord() {
    // Drop the uploaded preview media; the user is starting over.
    await deleteReviewMedia();
    setReviewMedia(null);
    setElapsed(0);
    setRecordError(null);
    setState("preview");
    await initCamera();
  }

  async function handleConfirm() {
    if (!reviewMedia) return;
    setConfirming(true);
    try {
      await onConfirm(reviewMedia);
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    stopStream();
    // If user cancels after an upload happened but before confirming, clean up.
    if (state === "review") await deleteReviewMedia();
    onCancel?.();
  }

  const remaining = hasLimit
    ? Math.max(0, (maxDurationSec as number) - elapsed)
    : 0;
  const overTime = hasLimit && elapsed >= (maxDurationSec as number);

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
            {state === "review" && reviewMedia ? (
              <>
                <video
                  key={`${reviewMedia.id}-${reviewReloadKey}`}
                  ref={reviewVideoRef}
                  src={reviewMedia.publicUrl}
                  controls
                  controlsList="nodownload"
                  preload="auto"
                  playsInline
                  muted
                  className="h-full w-full object-contain bg-ink"
                  onLoadedData={() => setReviewLoadState("ready")}
                  onCanPlay={() => setReviewLoadState("ready")}
                  onError={() => setReviewLoadState("error")}
                />
                {reviewLoadState === "loading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/70 text-white pointer-events-none">
                    <span className="inline-block size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span className="text-xs font-medium">
                      Vorschau wird geladen …
                    </span>
                  </div>
                )}
                {reviewLoadState === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/85 p-4 text-center text-white">
                    <AlertCircle className="size-7" />
                    <span className="text-sm font-semibold">
                      Vorschau konnte nicht geladen werden
                    </span>
                    <span className="text-xs text-white/70 max-w-xs">
                      Das Video ist gespeichert — manchmal braucht das CDN ein
                      paar Sekunden, bis es ausgeliefert wird.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="subtle"
                      onClick={() => {
                        setReviewLoadState("loading");
                        setReviewReloadKey((k) => k + 1);
                      }}
                      iconLeft={<RotateCcw className="size-3.5" />}
                    >
                      Erneut versuchen
                    </Button>
                  </div>
                )}
              </>
            ) : state === "uploading" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <span className="inline-block size-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span className="text-sm font-semibold">
                  Aufnahme wird hochgeladen … {uploadProgress}%
                </span>
                <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-[11px] text-white/70 max-w-xs text-center leading-relaxed">
                  Wir speichern dein Video auf unseren Servern, damit es in
                  den nächsten Schritten zuverlässig abspielbar ist.
                </span>
              </div>
            ) : state === "verifying" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <span className="inline-block size-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span className="text-sm font-semibold">
                  Vorschau wird vorbereitet …
                </span>
                <span className="text-[11px] text-white/70 max-w-xs text-center leading-relaxed">
                  Wir prüfen, dass das Video auf dem CDN angekommen ist.
                </span>
              </div>
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
                <span className="font-mono tabular-nums">{formatTime(elapsed)}</span>
              </div>
            )}

            {/* Composition guide: dezenter Kreis als Rahmen-Hilfe */}
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

            {state === "uploading" && (
              <Button type="button" variant="ghost" disabled>
                Aufnahme wird hochgeladen …
              </Button>
            )}

            {state === "verifying" && (
              <Button type="button" variant="ghost" disabled>
                Vorschau wird vorbereitet …
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
              Initialisiere Kamera …
            </p>
          )}
        </>
      )}
    </div>
  );
}
