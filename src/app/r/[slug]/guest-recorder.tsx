"use client";

/**
 * GuestRecorder — Webcam-Aufnahme + Upload an /api/r/<slug>/submit.
 *
 * Eigenes Component (kein Reuse von WebcamRecorder), weil:
 *  - Gast hat keinen Login, Endpoint ist anders
 *  - Owner sieht beim Empfang den Gast-Namen NICHT — wir geben dem Gast
 *    aber kein Eingabefeld; alles läuft anonym
 *  - Upload-Limit ist 100 MB (Mediathek erlaubt 500 MB)
 *  - max-duration-sec Timer ist hier nicht optional, sondern Pflicht
 *
 * Architektur-Entscheidungen (gleich wie components/ui/webcam-recorder.tsx,
 * weil die dortige Version battle-tested ist):
 *  - Das <video ref={liveVideoRef}> ist IMMER im DOM gemountet, nicht
 *    bedingt versteckt. Sonst ist liveVideoRef.current beim ersten
 *    initCamera() null → srcObject-Assignment scheitert still → schwarzer
 *    Player. Sichtbarkeit wird per CSS umgeschaltet.
 *  - Der Stream wird per useEffect [hasStream] ans Video angehängt, nicht
 *    synchron im initCamera-Body. So ist garantiert, dass das Element
 *    nach dem Re-Render schon existiert.
 *  - Review-Phase: explizit video.load() + Loading-Overlay bis canplay/
 *    loadeddata, plus Error-Fallback. Chrome+Firefox brauchen load() bei
 *    blob:-URLs damit der erste Frame erscheint.
 *
 * iOS-Safari-Hinweise:
 *  - <video playsInline muted> + autoplay erforderlich, sonst kein Preview
 *  - getUserMedia braucht User-Geste (Klick auf "Kamera aktivieren")
 */

import * as React from "react";
import {
  Circle,
  Square,
  RotateCcw,
  Check,
  AlertCircle,
  CheckCircle2,
  Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "open" | "used" | "expired" | "revoked";

type RecorderState =
  | "ready"
  | "permission_error"
  | "recording"
  | "review"
  | "sending"
  | "done"
  | "send_error";

export interface GuestRecorderProps {
  slug: string;
  ownerName: string;
  title: string | null;
  maxDurationSec: number;
  initialStatus: Status;
}

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

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60).toString().padStart(2, "0");
  const ss = (safe % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function statusToHumanError(status: Status): string {
  switch (status) {
    case "used":
      return "Dieser Link wurde bereits verwendet.";
    case "expired":
      return "Dieser Link ist abgelaufen.";
    case "revoked":
      return "Dieser Link wurde gesperrt.";
    default:
      return "Dieser Link ist nicht mehr aktiv.";
  }
}

export function GuestRecorder({
  slug,
  ownerName,
  maxDurationSec,
  initialStatus,
}: GuestRecorderProps) {
  // Wenn der Link nicht mehr offen ist → freundlicher Hinweis, kein Recorder.
  if (initialStatus !== "open") {
    return (
      <div className="rounded-squircle-xl border border-line bg-surface p-8 text-center space-y-3">
        <AlertCircle className="size-10 text-ink-muted mx-auto" />
        <p className="text-base font-semibold text-ink">
          {statusToHumanError(initialStatus)}
        </p>
        <p className="text-sm text-ink-muted">
          Bitte frage {ownerName} nach einem neuen Link.
        </p>
      </div>
    );
  }

  const liveVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const reviewVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const mimeRef = React.useRef<string>("video/webm");
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioLevelRef = React.useRef<number>(0);
  const audioRafRef = React.useRef<number | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);

  const [state, setState] = React.useState<RecorderState>("ready");
  const [permError, setPermError] = React.useState<string | null>(null);
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoadState, setPreviewLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [previewReloadKey, setPreviewReloadKey] = React.useState(0);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [hasStream, setHasStream] = React.useState(false);
  const [initializing, setInitializing] = React.useState(false);

  const remaining = Math.max(0, maxDurationSec - elapsed);
  const overTime = elapsed >= maxDurationSec;

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasStream(false);
  }, []);

  const stopAudioMeter = React.useCallback(() => {
    if (audioRafRef.current !== null) {
      cancelAnimationFrame(audioRafRef.current);
      audioRafRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    setAudioLevel(0);
    audioLevelRef.current = 0;
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

  /** Mikro-Pegel als 0–1 für VU-Meter. */
  const startAudioMeter = React.useCallback((stream: MediaStream) => {
    try {
      // Some browsers gate AudioContext behind webkit prefix.
      const Ctx =
        (window.AudioContext as typeof AudioContext | undefined) ??
        ((window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS-Annäherung
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const next = Math.min(1, rms * 2.5);
        audioLevelRef.current = next;
        setAudioLevel(next);
        audioRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.warn("[guest-recorder] audio meter init failed:", err);
    }
  }, []);

  const initCamera = React.useCallback(async () => {
    setPermError(null);
    setRecordError(null);
    setInitializing(true);
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
      // setHasStream triggert ein Re-Render — der useEffect unten hängt
      // dann den Stream ans (jetzt sicher gemountete) <video> an.
      // Wir versuchen es zusätzlich SYNCHRON: wenn das Element bereits im
      // DOM ist (was bei unserem "immer-mounten"-Setup der Fall ist), ist
      // das die schnellere Variante und der Preview erscheint sofort.
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        const s = vt.getSettings();
        console.log(
          `[guest-recorder] video track: ${s.width}x${s.height} @${s.frameRate}fps`,
        );
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play().catch(() => {});
      }
      setHasStream(true);
      startAudioMeter(stream);
    } catch (err) {
      console.error("[guest-recorder] getUserMedia failed:", err);
      const name =
        err instanceof Error && "name" in err ? (err as Error).name : "Error";
      let msg = "Kamera-/Mikrofon-Zugriff erforderlich.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg =
          "Zugriff auf Kamera und Mikrofon wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen und versuche es erneut.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "Keine Kamera oder kein Mikrofon gefunden.";
      } else if (name === "NotReadableError") {
        msg = "Kamera/Mikrofon wird gerade von einer anderen App benutzt.";
      }
      setPermError(msg);
      setState("permission_error");
    } finally {
      setInitializing(false);
    }
  }, [startAudioMeter]);

  // Stream-Anhängen als Belt-and-Suspenders: falls der synchrone Versuch
  // in initCamera scheitert (z.B. weil das Element gerade erst gemountet
  // wird), greift dieser Effekt nach dem Re-Render und setzt srcObject.
  React.useEffect(() => {
    if (!hasStream) return;
    const el = liveVideoRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    // iOS Safari verlangt explizit play() nach srcObject-Wechsel.
    el.play().catch(() => {});
  }, [hasStream, state]);

  React.useEffect(() => {
    return () => {
      clearTimers();
      stopAudioMeter();
      stopStream();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      recorderRef.current = null;
      if (previewUrl) {
        try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartFlow() {
    // User-Gesture: jetzt Kamera anfragen. Auf iOS muss play() innerhalb
    // einer User-Gesture passieren — daher hier (Button-Klick).
    if (!streamRef.current) {
      await initCamera();
      // Initial-State bleibt "ready", User klickt dann erneut für REC.
      return;
    }
    startRecording();
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
      console.error("[guest-recorder] MediaRecorder init failed:", err);
      setRecordError(
        "Aufnahme nicht möglich. Bitte aktualisiere den Browser.",
      );
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = (e) => {
      console.error("[guest-recorder] recorder error:", e);
      setRecordError("Aufnahmefehler. Bitte erneut versuchen.");
    };
    rec.onstop = () => {
      clearTimers();
      // Vorschau lokal als blob: URL — wir laden vor dem Senden hoch.
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      if (blob.size === 0) {
        setRecordError("Aufnahme war leer. Bitte erneut versuchen.");
        setState("ready");
        return;
      }
      // Letzten previewUrl freigeben damit kein Leak entsteht.
      if (previewUrl) {
        try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
      }
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewLoadState("loading");
      setState("review");
      // Live-Stream abschalten — Privacy + Kamera-LED aus.
      stopStream();
      stopAudioMeter();
    };

    try {
      rec.start(1000);
    } catch (err) {
      console.error("[guest-recorder] start failed:", err);
      setRecordError("Aufnahme konnte nicht gestartet werden.");
      return;
    }
    recorderRef.current = rec;
    setState("recording");

    timerRef.current = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);

    // Auto-Stop bei max-duration
    autoStopRef.current = setTimeout(() => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try { r.requestData(); } catch { /* ignore */ }
        try { r.stop(); } catch { /* ignore */ }
      }
    }, maxDurationSec * 1000);
  }

  function stopRecording() {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try { r.requestData(); } catch { /* ignore */ }
    try { r.stop(); } catch (err) {
      console.error("[guest-recorder] stop failed:", err);
      setRecordError("Beenden fehlgeschlagen.");
    }
  }

  async function reRecord() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
      setPreviewUrl(null);
    }
    setPreviewLoadState("loading");
    setElapsed(0);
    setRecordError(null);
    setState("ready");
    if (!streamRef.current) {
      await initCamera();
    }
  }

  // Sobald previewUrl gesetzt UND das Review-<video> gemountet ist, explizit
  // load() rufen. Chrome+Firefox brauchen das bei blob:-URLs damit der erste
  // Frame zuverlässig erscheint (poster/preload="auto" greifen nicht).
  React.useEffect(() => {
    if (state !== "review" || !previewUrl) return;
    const el = reviewVideoRef.current;
    if (!el) return;
    setPreviewLoadState("loading");
    try { el.load(); } catch { /* ignore */ }
  }, [previewUrl, state, previewReloadKey]);

  async function submit() {
    if (!previewUrl || chunksRef.current.length === 0) return;
    setState("sending");
    setUploadProgress(0);

    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const filename = `guest-${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: blob.type });

    const form = new FormData();
    form.append("video", file);

    try {
      const result = await new Promise<{ ok: boolean; status: number; body: { error?: string } | null }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/r/${encodeURIComponent(slug)}/submit`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploadProgress(Math.min(99, pct));
          }
        };
        xhr.onerror = () => reject(new Error("Netzwerk-Fehler"));
        xhr.onabort = () => reject(new Error("Upload abgebrochen"));
        xhr.onload = () => {
          let body: { error?: string } | null = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            body,
          });
        };
        xhr.send(form);
      });

      if (!result.ok) {
        const msg = result.body?.error ?? `HTTP ${result.status}`;
        setRecordError(msg);
        setState("send_error");
        return;
      }

      setUploadProgress(100);
      // Stream + Audio-Meter freigeben (Privacy)
      stopStream();
      stopAudioMeter();
      setState("done");
    } catch (err) {
      console.error("[guest-recorder] submit failed:", err);
      setRecordError(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
      setState("send_error");
    }
  }

  // ── UI-Render ────────────────────────────────────────────────────────────

  if (state === "done") {
    return (
      <div className="rounded-squircle-xl border border-ok/30 bg-ok/5 p-8 text-center space-y-3">
        <CheckCircle2 className="size-12 text-ok mx-auto" />
        <p className="text-lg font-semibold text-ink">
          Vielen Dank! Deine Aufnahme ist unterwegs zu {ownerName}.
        </p>
        <p className="text-sm text-ink-muted">
          Du kannst dieses Fenster jetzt schließen.
        </p>
      </div>
    );
  }

  if (state === "permission_error") {
    return (
      <div className="rounded-squircle-xl border border-danger/30 bg-danger/5 p-8 text-center space-y-3">
        <AlertCircle className="size-10 text-danger mx-auto" />
        <p className="text-base font-semibold text-ink">
          Mikrofon-/Kamera-Zugriff erforderlich
        </p>
        <p className="text-sm text-ink-muted max-w-md mx-auto">
          {permError}
        </p>
        <Button
          type="button"
          onClick={() => {
            setPermError(null);
            setState("ready");
            void initCamera();
          }}
        >
          Erneut versuchen
        </Button>
      </div>
    );
  }

  // ── Render-Helper ────────────────────────────────────────────────────────
  // Sichtbarkeits-Logik: das Live-<video> ist IMMER gemountet (siehe oben:
  // ref-null-Bug). Wir steuern Sichtbarkeit per CSS-Klassen.
  const showLiveStage =
    state === "ready" || state === "recording";
  const showReviewStage =
    state === "review" || state === "sending" || state === "send_error";

  return (
    <div className="space-y-5">
      {/* Video-Bühne: gleichzeitiges Mounting von Live + Review.
          Sichtbarkeit per CSS, damit refs nie null sind, wenn wir sie
          synchron in initCamera()/load() ansprechen. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-xl bg-ink shadow-lift">
        {/* Live-Video: immer im DOM, per Klasse sichtbar/unsichtbar */}
        <video
          ref={liveVideoRef}
          className={cn(
            "h-full w-full object-cover",
            showLiveStage ? "block" : "hidden",
          )}
          autoPlay
          muted
          playsInline
        />

        {/* Review-Video: wird gemountet sobald previewUrl da ist; bleibt
            danach gemountet (auch im send_error-State), damit der User
            das Video nochmal abspielen kann. */}
        {previewUrl && (
          <video
            key={`${previewUrl}-${previewReloadKey}`}
            ref={reviewVideoRef}
            src={previewUrl}
            controls
            controlsList="nodownload"
            preload="auto"
            playsInline
            muted
            onLoadedData={() => setPreviewLoadState("ready")}
            onCanPlay={() => setPreviewLoadState("ready")}
            onError={() => setPreviewLoadState("error")}
            className={cn(
              "absolute inset-0 h-full w-full object-contain bg-ink",
              showReviewStage ? "block" : "hidden",
            )}
          />
        )}

        {/* Placeholder vor Kamera-Aktivierung */}
        {state === "ready" && !hasStream && !initializing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 text-white text-center px-6">
            <Mic className="size-10 text-white/70" />
            <span className="text-sm font-medium">
              Klicke unten auf <span className="font-semibold">„Kamera + Mikrofon aktivieren"</span>,
              um zu starten.
            </span>
            <span className="text-xs text-white/60 max-w-xs">
              Dein Browser fragt nach Erlaubnis — das ist normal.
            </span>
          </div>
        )}

        {state === "ready" && !hasStream && initializing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 text-white">
            <span className="inline-block size-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span className="text-sm font-medium">Kamera wird initialisiert …</span>
          </div>
        )}

        {/* REC-Badge */}
        {state === "recording" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
            <span className="inline-block size-2 animate-pulse rounded-full bg-danger" />
            REC
            <span className="font-mono tabular-nums">{formatTime(elapsed)}</span>
            <span className="text-white/60">/ {formatTime(maxDurationSec)}</span>
          </div>
        )}

        {/* Composition-Kreis (dezent) — nur im Live-Modus, nicht im Review */}
        {showLiveStage && hasStream && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 aspect-square h-full rounded-full border border-white/35"
            style={{
              boxShadow:
                "0 0 0 1px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.06)",
            }}
          />
        )}

        {/* Review-Loading-Overlay */}
        {showReviewStage && state === "review" && previewLoadState === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/85 text-white pointer-events-none">
            <span className="inline-block size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span className="text-xs font-medium">Vorschau wird vorbereitet …</span>
          </div>
        )}

        {/* Review-Error-Fallback */}
        {showReviewStage && state === "review" && previewLoadState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 p-4 text-center text-white">
            <AlertCircle className="size-7 text-danger" />
            <span className="text-sm font-semibold">
              Vorschau konnte nicht geladen werden
            </span>
            <span className="text-xs text-white/70 max-w-xs">
              Du kannst trotzdem absenden — oder eine neue Aufnahme machen.
            </span>
            <Button
              type="button"
              size="sm"
              variant="subtle"
              onClick={() => {
                setPreviewLoadState("loading");
                setPreviewReloadKey((k) => k + 1);
              }}
              iconLeft={<RotateCcw className="size-3.5" />}
            >
              Erneut laden
            </Button>
          </div>
        )}

        {/* Sending-Overlay */}
        {state === "sending" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/85 text-white">
            <span className="inline-block size-10 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <span className="text-sm font-semibold">
              Wird gesendet … {uploadProgress}%
            </span>
            <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Aufnahme-Status-Leiste (nur live) */}
      {state === "recording" && (
        <div className="space-y-3">
          <div
            className="h-1.5 w-full rounded-full bg-line overflow-hidden"
            aria-label="Mikrofon-Pegel"
          >
            <div
              className={cn(
                "h-full transition-all duration-100",
                audioLevel > 0.6 ? "bg-ok" : audioLevel > 0.15 ? "bg-brand" : "bg-line-soft",
              )}
              style={{ width: `${Math.round(audioLevel * 100)}%` }}
            />
          </div>

          <div className="flex items-baseline justify-center gap-3 font-mono tabular-nums">
            <span className="text-2xl font-bold text-ink">{formatTime(elapsed)}</span>
            <span className="text-sm text-ink-muted">/ {formatTime(maxDurationSec)}</span>
            <span className={cn(
              "text-xs font-semibold",
              remaining <= 10 ? "text-danger" : "text-ink-muted",
            )}>
              {overTime ? "Maximum erreicht" : `noch ${formatTime(remaining)}`}
            </span>
          </div>
        </div>
      )}

      {recordError && (
        <div className="rounded-squircle-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger text-center">
          {recordError}
        </div>
      )}

      {/* Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {state === "ready" && !hasStream && (
          <Button
            type="button"
            size="lg"
            onClick={handleStartFlow}
            loading={initializing}
            iconLeft={<Mic className="size-4" />}
          >
            Kamera + Mikrofon aktivieren
          </Button>
        )}

        {state === "ready" && hasStream && (
          <Button
            type="button"
            size="lg"
            onClick={startRecording}
            iconLeft={<Circle className="size-4 fill-current" />}
          >
            Aufnahme starten
          </Button>
        )}

        {state === "recording" && (
          <Button
            type="button"
            variant="danger"
            size="lg"
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
              size="lg"
              onClick={submit}
              iconLeft={<Check className="size-4" />}
            >
              Absenden
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={reRecord}
              iconLeft={<RotateCcw className="size-4" />}
            >
              Erneut aufnehmen
            </Button>
          </>
        )}

        {state === "send_error" && (
          <>
            <Button
              type="button"
              size="lg"
              onClick={submit}
              iconLeft={<Check className="size-4" />}
            >
              Erneut absenden
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={reRecord}
              iconLeft={<RotateCcw className="size-4" />}
            >
              Neu aufnehmen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
