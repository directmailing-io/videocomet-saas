"use client";

/**
 * GuestRecorder — Webcam-Aufnahme + Upload an /api/r/<slug>/submit.
 *
 * Eigenes Component (kein Reuse von WebcamRecorder), weil:
 *  - Gast hat keinen Login, Endpoint ist anders
 *  - Owner sieht beim Empfang den Gast-Namen NICHT; wir geben dem Gast
 *    aber kein Eingabefeld, alles läuft anonym
 *  - Upload-Limit ist 100 MB (Mediathek erlaubt 500 MB)
 *  - max-duration-sec Timer ist hier nicht optional, sondern Pflicht
 *
 * Format (seit 2026-09-03):
 *  - Der Gast wählt Querformat oder Hochformat, oder der Link gibt das
 *    Format vor (`orientation`-Preset des Share-Links). Auf dem Handy ist
 *    Hochformat der Standard, am Rechner Querformat.
 *  - HANDY: Die Frame-Orientierung bestimmt das Gerät selbst (iOS rotiert
 *    die Frames passend zur Haltung; vertauschte width/height-Constraints
 *    kehren das Ergebnis auf iOS sogar um). Deshalb fordern wir auf Touch-
 *    Geräten KEINE gedrehten Constraints an. Die Format-Wahl ist dort eine
 *    Anleitung ("Handy senkrecht halten") plus Live-Abgleich mit dem Bild.
 *  - DESKTOP: gedrehte Constraints (720x1280) für Webcams, die Hochformat
 *    können; die meisten bleiben quer, das zeigen wir als Hinweis.
 *  - Die Video-Bühne folgt IMMER den echten Pixelmaßen des Kamerabilds bzw.
 *    der fertigen Aufnahme. Größe wird per JS in Pixeln gesetzt (Breite,
 *    Höhe), nicht per CSS aspect-ratio: WebKit löst Prozent-Höhen von
 *    Kindern gegen aspect-ratio-Höhen nicht zuverlässig auf, die Bühne
 *    "zerfiel" auf dem iPhone (Balken links/rechts).
 *  - Der KI-Hinweis ist zuklappbar und klappt automatisch zu, sobald die
 *    Kamera läuft (Kurzform bleibt als eine Zeile sichtbar).
 *
 * KI-Begrüßung: Vor der Aufnahme gibt es einen 3-Sekunden-Countdown, in den
 * ersten Sekunden der Aufnahme eine Einblendung „Hi!“, „kurz Pause“, „weiter“.
 * Der ausführliche Hinweis steht auf der Seite über dem Recorder.
 *
 * Architektur-Entscheidungen (gleich wie components/ui/webcam-recorder.tsx,
 * weil die dortige Version battle-tested ist):
 *  - Das <video ref={liveVideoRef}> ist IMMER im DOM gemountet, nicht
 *    bedingt versteckt. Sonst ist liveVideoRef.current beim ersten
 *    initCamera() null → srcObject-Assignment scheitert still → schwarzer
 *    Player. Sichtbarkeit wird per CSS umgeschaltet.
 *  - Der Stream wird per useEffect [hasStream] ans Video angehängt.
 *  - Review-Phase: explizit video.load() + Loading-Overlay bis canplay/
 *    loadeddata, plus Error-Fallback.
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
  Monitor,
  Smartphone,
  ChevronDown,
  ChevronUp,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordingHint } from "@/components/intro/recording-hint";
import { cn } from "@/lib/utils";

type Status = "open" | "used" | "expired" | "revoked";
export type GuestOrientation = "landscape" | "portrait";

type RecorderState =
  | "ready"
  | "permission_error"
  | "countdown"
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
  /** Vom Link vorgegebenes Format. null = Gast darf wählen. */
  orientation: GuestOrientation | null;
}

interface Dims {
  width: number;
  height: number;
}

const COUNTDOWN_SECONDS = 3;
const CUE_SECONDS = 5;
/** Bühne darf höchstens diesen Anteil der Fensterhöhe belegen. */
const STAGE_MAX_VIEWPORT_SHARE = 0.68;
/** Hochkant-Bühne am Desktop nicht breiter als das (sonst riesig). */
const STAGE_PORTRAIT_MAX_WIDTH = 360;

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

function orientationLabel(o: GuestOrientation): string {
  return o === "portrait" ? "Hochformat" : "Querformat";
}

function dimsToOrientation(d: Dims | null): GuestOrientation | null {
  if (!d || d.width <= 0 || d.height <= 0) return null;
  return d.height > d.width ? "portrait" : "landscape";
}

/** Handy/Tablet? Entscheidet über Standard-Format und Hinweistexte. */
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (navigator.maxTouchPoints ?? 0) > 0 &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * Countdown-Text-Cue in den ersten Sekunden der Aufnahme. Erinnert an
 * „Hi!“ plus kurze Pause, damit die KI später den Namen einsetzen kann.
 */
function recordingCue(elapsed: number): string | null {
  if (elapsed < 1) return "Sag jetzt: „Hi!“ oder „Hallo!“";
  if (elapsed < 2) return "Kurz Luft holen";
  if (elapsed < CUE_SECONDS) return "Und jetzt einfach weitersprechen";
  return null;
}

export function GuestRecorder({
  slug,
  ownerName,
  maxDurationSec,
  initialStatus,
  orientation: presetOrientation,
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
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelRef = React.useRef<number>(0);
  const audioRafRef = React.useRef<number | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);

  const [state, setState] = React.useState<RecorderState>("ready");
  const [permError, setPermError] = React.useState<string | null>(null);
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [countdown, setCountdown] = React.useState(COUNTDOWN_SECONDS);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoadState, setPreviewLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [previewReloadKey, setPreviewReloadKey] = React.useState(0);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [hasStream, setHasStream] = React.useState(false);
  const [initializing, setInitializing] = React.useState(false);

  // ── Format ────────────────────────────────────────────────────────────
  const [touch, setTouch] = React.useState(false);
  const [orientation, setOrientation] = React.useState<GuestOrientation>(
    presetOrientation ?? "landscape",
  );
  const orientationRef = React.useRef<GuestOrientation>(orientation);
  React.useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);
  React.useEffect(() => {
    // Erst im Browser entscheidbar: Handy → Hochformat als Standard,
    // sofern der Link nichts vorgibt.
    const t = isTouchDevice();
    setTouch(t);
    if (!presetOrientation && t) {
      setOrientation("portrait");
      orientationRef.current = "portrait";
    }
  }, [presetOrientation]);

  /** Echte Pixelmaße des Live-Bilds bzw. der fertigen Aufnahme. */
  const [liveDims, setLiveDims] = React.useState<Dims | null>(null);
  const [reviewDims, setReviewDims] = React.useState<Dims | null>(null);

  /** KI-Hinweis: offen bis die Kamera läuft, danach eine Zeile. */
  const [hintOpen, setHintOpen] = React.useState(true);
  const hintTouchedRef = React.useRef(false);

  /** Verfügbare Breite + Fensterhöhe für die Bühne (per JS gemessen). */
  const stageHostRef = React.useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = React.useState<{ width: number; viewportH: number } | null>(null);
  React.useEffect(() => {
    const host = stageHostRef.current;
    if (!host) return;
    const measure = () => {
      const w = host.getBoundingClientRect().width;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      if (w > 0 && vh > 0) setStageBox({ width: w, viewportH: vh });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(host);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  const remaining = Math.max(0, maxDurationSec - elapsed);
  const overTime = elapsed >= maxDurationSec;

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasStream(false);
    setLiveDims(null);
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
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  /** Mikro-Pegel als 0–1 für VU-Meter. */
  const startAudioMeter = React.useCallback((stream: MediaStream) => {
    try {
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

  const readLiveDims = React.useCallback(() => {
    const el = liveVideoRef.current;
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      setLiveDims({ width: el.videoWidth, height: el.videoHeight });
      return;
    }
    if (isTouchDevice()) return; // getSettings = Sensor-Masse, auf dem Handy irrefuehrend
    const vt = streamRef.current?.getVideoTracks()[0];
    const s = vt?.getSettings();
    if (s?.width && s?.height) setLiveDims({ width: s.width, height: s.height });
  }, []);

  const initCamera = React.useCallback(async (mode?: GuestOrientation) => {
    const effective = mode ?? orientationRef.current;
    const portrait = effective === "portrait";
    const mobile = isTouchDevice();
    setPermError(null);
    setRecordError(null);
    setInitializing(true);
    try {
      // HANDY: keine gedrehten Constraints. iOS rotiert die Frames passend
      // zur Haltung des Geräts; width/height beziehen sich dort auf den
      // Sensor und wuerden das Ergebnis umkehren (beobachtet 2026-09-03).
      // DESKTOP: bei Hochformat width/height + aspectRatio drehen, damit
      // Webcams, die es koennen, Hochkant liefern.
      const video: MediaTrackConstraints = mobile
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
            facingMode: { ideal: "user" },
          }
        : {
            width: portrait ? { ideal: 720, max: 1080 } : { ideal: 1280, max: 1920 },
            height: portrait ? { ideal: 1280, max: 1920 } : { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
            aspectRatio: { ideal: portrait ? 9 / 16 : 16 / 9 },
            facingMode: { ideal: "user" },
          };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      streamRef.current = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        const s = vt.getSettings();
        console.log(
          `[guest-recorder] video track: ${s.width}x${s.height} @${s.frameRate}fps (wanted ${effective})`,
        );
        // Nur Startwert. Auf iOS sind das Sensor-Masse (quer), die echten
        // Frame-Masse kommen gleich per loadedmetadata (readLiveDims).
        if (s.width && s.height && !mobile) setLiveDims({ width: s.width, height: s.height });
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        liveVideoRef.current.play().catch(() => {});
      }
      setHasStream(true);
      if (!hintTouchedRef.current) setHintOpen(false);
      startAudioMeter(stream);
    } catch (err) {
      console.error("[guest-recorder] getUserMedia failed:", err);
      const name =
        err instanceof Error && "name" in err ? (err as Error).name : "Error";
      let msg = "Kamera und Mikrofon werden benötigt.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg =
          "Der Zugriff auf Kamera und Mikrofon wurde abgelehnt. Bitte erlaube ihn in den Browser-Einstellungen und versuche es noch einmal.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "Keine Kamera oder kein Mikrofon gefunden.";
      } else if (name === "NotReadableError") {
        msg = "Kamera oder Mikrofon werden gerade von einer anderen App benutzt.";
      }
      setPermError(msg);
      setState("permission_error");
    } finally {
      setInitializing(false);
    }
  }, [startAudioMeter]);

  // Stream-Anhängen als Belt-and-Suspenders (siehe Kopfkommentar).
  React.useEffect(() => {
    if (!hasStream) return;
    const el = liveVideoRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
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
    if (!streamRef.current) {
      await initCamera();
      return;
    }
    beginCountdown();
  }

  /**
   * Format wechseln: nur vor der Aufnahme. Am Desktop Stream mit gedrehten
   * Constraints neu anfordern. Am Handy aendert sich nichts am Stream (die
   * Frames folgen der Haltung), nur Wunsch + Hinweis.
   */
  async function switchOrientation(next: GuestOrientation) {
    if (state !== "ready") return;
    if (next === orientation) return;
    setOrientation(next);
    orientationRef.current = next;
    if (streamRef.current && !isTouchDevice()) {
      stopAudioMeter();
      stopStream();
      await initCamera(next);
    }
  }

  /** 3-2-1, dann Aufnahme. Gibt Zeit, sich zu sammeln, und erinnert an „Hi!“. */
  function beginCountdown() {
    if (!streamRef.current) return;
    setRecordError(null);
    setCountdown(COUNTDOWN_SECONDS);
    setState("countdown");
    let n = COUNTDOWN_SECONDS;
    countdownRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownRef.current !== null) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        startRecording();
        return;
      }
      setCountdown(n);
    }, 1000);
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
      setRecordError("Aufnahme nicht möglich. Bitte aktualisiere deinen Browser.");
      setState("ready");
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = (e) => {
      console.error("[guest-recorder] recorder error:", e);
      setRecordError("Aufnahmefehler. Bitte versuche es noch einmal.");
    };
    rec.onstop = () => {
      clearTimers();
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      if (blob.size === 0) {
        setRecordError("Die Aufnahme war leer. Bitte versuche es noch einmal.");
        setState("ready");
        return;
      }
      if (previewUrl) {
        try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
      }
      const url = URL.createObjectURL(blob);
      // Die Bühne behält bis zur Metadaten-Info die Live-Maße, damit sie
      // nicht springt.
      setReviewDims(liveDims);
      setPreviewUrl(url);
      setPreviewLoadState("loading");
      setState("review");
      stopStream();
      stopAudioMeter();
    };

    try {
      rec.start(1000);
    } catch (err) {
      console.error("[guest-recorder] start failed:", err);
      setRecordError("Die Aufnahme konnte nicht gestartet werden.");
      setState("ready");
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
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try { r.requestData(); } catch { /* ignore */ }
    try { r.stop(); } catch (err) {
      console.error("[guest-recorder] stop failed:", err);
      setRecordError("Beenden fehlgeschlagen.");
    }
  }

  function cancelCountdown() {
    clearTimers();
    setState("ready");
  }

  async function reRecord() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ }
      setPreviewUrl(null);
    }
    setPreviewLoadState("loading");
    setReviewDims(null);
    setElapsed(0);
    setRecordError(null);
    setState("ready");
    if (!streamRef.current) {
      await initCamera();
    }
  }

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
      stopStream();
      stopAudioMeter();
      setState("done");
    } catch (err) {
      console.error("[guest-recorder] submit failed:", err);
      setRecordError(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
      setState("send_error");
    }
  }

  // ── Abgeleitete Werte für die Anzeige ────────────────────────────────────

  const showLiveStage =
    state === "ready" || state === "countdown" || state === "recording";
  const showReviewStage =
    state === "review" || state === "sending" || state === "send_error";

  // Bühne folgt den echten Maßen. Fallback: gewähltes Format.
  const stageDims: Dims | null = showReviewStage ? (reviewDims ?? liveDims) : liveDims;
  const stageAspect =
    stageDims && stageDims.width > 0 && stageDims.height > 0
      ? stageDims.width / stageDims.height
      : orientation === "portrait"
        ? 9 / 16
        : 16 / 9;
  const stageIsPortrait = stageAspect < 1;

  // Explizite Pixelmasse: Breite = min(verfuegbar, Hochkant-Deckel,
  // max. Hoehe * Aspect). Vor der ersten Messung (SSR) faellt die Buehne
  // auf volle Breite mit 16:9 zurueck, damit nichts springt.
  const stageSize = (() => {
    if (!stageBox) return null;
    const maxH = stageBox.viewportH * STAGE_MAX_VIEWPORT_SHARE;
    let width = stageBox.width;
    if (stageIsPortrait) width = Math.min(width, STAGE_PORTRAIT_MAX_WIDTH);
    width = Math.min(width, maxH * stageAspect);
    width = Math.max(120, Math.floor(width));
    return { width, height: Math.round(width / stageAspect) };
  })();

  // Stimmt das Kamerabild mit dem gewünschten Format überein?
  const actualLive = dimsToOrientation(liveDims);
  const wanted: GuestOrientation = presetOrientation ?? orientation;
  const mismatch =
    showLiveStage && hasStream && actualLive !== null && actualLive !== wanted;
  const mismatchText = (() => {
    if (!mismatch) return null;
    if (wanted === "portrait") {
      return touch
        ? "Dein Bild ist gerade im Querformat. Dreh dein Handy senkrecht, dann passt es."
        : "Diese Kamera nimmt nur im Querformat auf. Für Hochformat nimm bitte mit dem Handy auf.";
    }
    return touch
      ? "Dein Bild ist gerade im Hochformat. Dreh dein Handy quer, dann passt es."
      : "Deine Kamera liefert gerade Hochformat.";
  })();

  const resultOrientation = dimsToOrientation(reviewDims);

  // ── Sonderzustände ─────────────────────────────────────────────────────────

  if (state === "done") {
    return (
      <div className="rounded-squircle-xl border border-ok/30 bg-ok/5 p-8 text-center space-y-3">
        <CheckCircle2 className="size-12 text-ok mx-auto" />
        <p className="text-lg font-semibold text-ink">
          Vielen Dank! Deine Aufnahme ist unterwegs zu {ownerName}.
        </p>
        <p className="text-sm text-ink-muted">
          {resultOrientation
            ? `Format: ${orientationLabel(resultOrientation)}. `
            : ""}
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
          Kamera und Mikrofon werden benötigt
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
          Noch einmal versuchen
        </Button>
      </div>
    );
  }

  const cue = state === "recording" ? recordingCue(elapsed) : null;

  return (
    <div className="space-y-5">
      {/* KI-Begrüßungs-Hinweis: zuklappbar. Offen bis die Kamera läuft,
          danach als eine Zeile. Der Gast kann jederzeit auf- und zuklappen. */}
      {hintOpen ? (
        <div className="relative">
          <RecordingHint className="border-brand/30 bg-brand-soft/40 pr-4" />
          <button
            type="button"
            onClick={() => {
              hintTouchedRef.current = true;
              setHintOpen(false);
            }}
            className="mt-2 mx-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink hover:bg-surface-soft transition-colors"
            aria-expanded
          >
            <ChevronUp className="size-3.5" />
            Hinweis zuklappen
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            hintTouchedRef.current = true;
            setHintOpen(true);
          }}
          aria-expanded={false}
          className="flex w-full items-center gap-2.5 rounded-squircle-md border border-brand/30 bg-brand-soft/40 px-4 py-3 text-left text-sm text-ink hover:bg-brand-soft/70 transition-colors"
        >
          <Lightbulb className="size-4 shrink-0 text-brand-deep" />
          <span className="flex-1 leading-snug">
            <span className="font-semibold">Start mit „Hi!“,</span> dann kurz Luft holen, dann weitersprechen.
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" />
        </button>
      )}

      {/* Format-Wahl (nur vor der Aufnahme). Bei Vorgabe durch den Link:
          fester Hinweis statt Umschalter. */}
      {state === "ready" && (
        <div className="flex flex-col items-center gap-2">
          {presetOrientation ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-deep">
              {presetOrientation === "portrait" ? (
                <Smartphone className="size-4" />
              ) : (
                <Monitor className="size-4" />
              )}
              Bitte im {orientationLabel(presetOrientation)} aufnehmen
              {touch ? (
                <span className="font-normal text-brand-deep/80">
                  {presetOrientation === "portrait" ? "(Handy senkrecht halten)" : "(Handy quer halten)"}
                </span>
              ) : null}
            </div>
          ) : (
            <>
              <div
                role="group"
                aria-label="Format der Aufnahme"
                className="inline-flex items-center rounded-full border border-line bg-surface p-1"
              >
                <button
                  type="button"
                  onClick={() => void switchOrientation("landscape")}
                  aria-pressed={orientation === "landscape"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    orientation === "landscape"
                      ? "bg-ink text-white shadow-card"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Monitor className="size-4" />
                  Querformat
                </button>
                <button
                  type="button"
                  onClick={() => void switchOrientation("portrait")}
                  aria-pressed={orientation === "portrait"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                    orientation === "portrait"
                      ? "bg-ink text-white shadow-card"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <Smartphone className="size-4" />
                  Hochformat
                </button>
              </div>
              <p className="text-xs text-ink-muted text-center">
                {touch
                  ? orientation === "portrait"
                    ? "Halte dein Handy senkrecht."
                    : "Halte dein Handy quer."
                  : orientation === "portrait"
                    ? "Hochformat passt für Handy-Videos, Reels und Stories."
                    : "Querformat passt für Videos am Rechner und auf Webseiten."}
              </p>
            </>
          )}
        </div>
      )}

      {/* Video-Bühne: folgt den echten Maßen des Bilds. Größe wird in
          Pixeln gesetzt (WebKit-sicher). Live + Review sind gleichzeitig
          gemountet (refs nie null), Sichtbarkeit per CSS. */}
      <div ref={stageHostRef} className="flex w-full justify-center">
        <div
          className="relative overflow-hidden rounded-squircle-xl bg-ink shadow-lift"
          style={
            stageSize
              ? { width: `${stageSize.width}px`, height: `${stageSize.height}px` }
              : { width: "100%", aspectRatio: "16 / 9" }
          }
        >
          <video
            ref={liveVideoRef}
            className={cn(
              "absolute inset-0 h-full w-full object-contain",
              showLiveStage ? "block" : "hidden",
            )}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={readLiveDims}
            onResize={readLiveDims}
          />

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
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setReviewDims({ width: el.videoWidth, height: el.videoHeight });
                }
              }}
              onLoadedData={() => setPreviewLoadState("ready")}
              onCanPlay={() => setPreviewLoadState("ready")}
              onError={() => setPreviewLoadState("error")}
              className={cn(
                "absolute inset-0 h-full w-full object-contain bg-ink",
                showReviewStage ? "block" : "hidden",
              )}
            />
          )}

          {/* Platzhalter vor Kamera-Start */}
          {state === "ready" && !hasStream && !initializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 text-white text-center px-6">
              <Mic className="size-10 text-white/70" />
              <span className="text-sm font-medium">
                Tippe unten auf <span className="font-semibold">„Kamera und Mikrofon aktivieren“</span>.
              </span>
              <span className="text-xs text-white/60 max-w-xs">
                Dein Browser fragt einmal nach Erlaubnis. Das ist normal.
              </span>
            </div>
          )}

          {state === "ready" && !hasStream && initializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 text-white">
              <span className="inline-block size-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span className="text-sm font-medium">Kamera wird gestartet …</span>
            </div>
          )}

          {/* Countdown */}
          {state === "countdown" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/50 text-white text-center px-6">
              <span className="text-7xl font-bold tabular-nums drop-shadow">{countdown}</span>
              <span className="text-sm font-semibold drop-shadow">
                Gleich geht es los. Starte mit „Hi!“ und mach dann eine kurze Pause.
              </span>
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

          {/* Sprech-Cue in den ersten Sekunden */}
          {cue && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
              <span className="rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink shadow-lift">
                {cue}
              </span>
            </div>
          )}

          {/* Kompositions-Kreis nur im Querformat (im Hochformat stört er) */}
          {showLiveStage && hasStream && !stageIsPortrait && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 aspect-square h-full rounded-full border border-white/35"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.06)",
              }}
            />
          )}

          {showReviewStage && state === "review" && previewLoadState === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/85 text-white pointer-events-none">
              <span className="inline-block size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span className="text-xs font-medium">Vorschau wird vorbereitet …</span>
            </div>
          )}

          {showReviewStage && state === "review" && previewLoadState === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 p-4 text-center text-white">
              <AlertCircle className="size-7 text-danger" />
              <span className="text-sm font-semibold">
                Die Vorschau konnte nicht geladen werden
              </span>
              <span className="text-xs text-white/70 max-w-xs">
                Du kannst trotzdem absenden oder eine neue Aufnahme machen.
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
                Noch einmal laden
              </Button>
            </div>
          )}

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
      </div>

      {/* Format-Hinweis, wenn Kamerabild und Wunsch nicht zusammenpassen */}
      {mismatchText && (
        <div className="mx-auto max-w-md rounded-squircle-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink text-center">
          {mismatchText}
        </div>
      )}

      {/* Status im Review: welches Format ist es geworden */}
      {state === "review" && resultOrientation && (
        <p className="text-center text-xs text-ink-muted">
          Deine Aufnahme ist im {orientationLabel(resultOrientation)}
          {presetOrientation && resultOrientation !== presetOrientation
            ? `. Gewünscht war ${orientationLabel(presetOrientation)}. Du kannst sie trotzdem absenden oder neu aufnehmen.`
            : "."}
        </p>
      )}

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
            Kamera und Mikrofon aktivieren
          </Button>
        )}

        {state === "ready" && hasStream && (
          <Button
            type="button"
            size="lg"
            onClick={beginCountdown}
            iconLeft={<Circle className="size-4 fill-current" />}
          >
            Aufnahme starten
          </Button>
        )}

        {state === "countdown" && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={cancelCountdown}
          >
            Abbrechen
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
              Neu aufnehmen
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
              Noch einmal absenden
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
