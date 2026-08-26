"use client";

import * as React from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  VOICE_TOTAL_PERFECT_SECONDS,
  VOICE_TOTAL_TARGET_SECONDS,
} from "@/lib/intro";
import { cn } from "@/lib/utils";

/** Freie Sprech-Impulse — kein Vorlese-Skript, nur Anstupser. */
const PROMPTS = [
  {
    title: "Stell dich vor",
    text: "Wer bist du, was machst du? Erzähl es so, wie du es einem neuen Kunden am Telefon sagen würdest.",
  },
  {
    title: "Pitch dein Angebot",
    text: "Was bietest du an und warum lohnt sich das? Sprich frei, ganze Sätze, dein normales Tempo.",
  },
  {
    title: "Begrüße ein paar Kunden",
    text: "„Hi Thomas, schön, dass du reinschaust …“ — sprich 2-3 Begrüßungen, als wärst du mitten im Gespräch.",
  },
  {
    title: "Erzähl eine Mini-Story",
    text: "Ein Projekt, das richtig gut gelaufen ist? Erzähl kurz davon — Begeisterung klingt am besten.",
  },
];

/** Aufnahme-Obergrenze — mehr Material bringt nichts mehr. */
const MAX_RECORD_SECONDS = 240;

type Phase = "idle" | "recording" | "review" | "uploading" | "done";

export interface VoiceExtraRecorderProps {
  /** Länge des Kampagnen-Videos in Sekunden (Basis für den Ring). */
  videoDurationSec: number;
  /** Aufnahme-Start erst erlaubt, wenn beide Einwilligungen gesetzt sind. */
  canRecord: boolean;
  /** Upload-Callback — wirft bei Fehler (Message wird angezeigt). */
  onUpload: (blob: Blob) => Promise<void>;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/**
 * Zusatz-Sprachprobe für zu kurze Kampagnen-Videos: großer Mikro-Button,
 * Live-Wellenform, Fortschrittsring (grün, sobald Video + Aufnahme
 * zusammen das Ziel erreichen) und rotierende Sprech-Impulse. Frei
 * sprechen, kein Skript — die Aufnahme wird mit dem Video-Ton zu einem
 * Stimm-Training kombiniert.
 */
export function VoiceExtraRecorder({
  videoDurationSec,
  canRecord,
  onUpload,
}: VoiceExtraRecorderProps) {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const [promptIdx, setPromptIdx] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const rafRef = React.useRef<number>(0);
  const startedAtRef = React.useRef(0);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const discardRef = React.useRef(false);
  const phaseRef = React.useRef<Phase>("idle");
  phaseRef.current = phase;

  // Mindestens so lange aufnehmen, dass das Gesamtziel erreicht wird —
  // aber nie unter 20s, sonst ist der Clip selbst zu dünn.
  const minRecordSec = Math.max(
    20,
    VOICE_TOTAL_TARGET_SECONDS - videoDurationSec,
  );
  const perfectRecordSec = Math.max(
    minRecordSec + 10,
    VOICE_TOTAL_PERFECT_SECONDS - videoDurationSec,
  );

  const reachedTarget = elapsed >= minRecordSec;
  const reachedPerfect = elapsed >= perfectRecordSec;
  // Ring: 0 → Ziel füllt bis 70%, Ziel → Perfekt füllt den Rest.
  const ringProgress = reachedTarget
    ? 0.7 +
      0.3 *
        Math.min(
          1,
          (elapsed - minRecordSec) / Math.max(1, perfectRecordSec - minRecordSec),
        )
    : 0.7 * (elapsed / minRecordSec);

  const cleanupAudio = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  React.useEffect(
    () => () => {
      cleanupAudio();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Impuls-Karten rotieren während der Aufnahme alle 15s weiter.
  React.useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(
      () => setPromptIdx((i) => (i + 1) % PROMPTS.length),
      15000,
    );
    return () => clearInterval(id);
  }, [phase]);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "Wir dürfen dein Mikrofon nicht verwenden. Erlaube den Zugriff in deinem Browser und probiere es nochmal.",
      );
      return;
    }
    streamRef.current = stream;

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: 128_000 } : undefined,
    );
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      cleanupAudio();
      if (discardRef.current) {
        discardRef.current = false;
        setElapsed(0);
        setPhase("idle");
        return;
      }
      const b = new Blob(chunks, { type: mimeType || "audio/webm" });
      setBlob(b);
      setBlobUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
      setPhase("review");
    };
    recorderRef.current = rec;

    // Live-Wellenform über AnalyserNode auf ein Canvas.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const freq = new Uint8Array(analyser.frequencyBinCount);

    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    rec.start(1000);

    const tick = () => {
      if (phaseRef.current !== "recording") return;
      const sec = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(sec);
      if (sec >= MAX_RECORD_SECONDS) {
        stop();
        return;
      }
      const canvas = canvasRef.current;
      const c2d = canvas?.getContext("2d");
      if (canvas && c2d) {
        analyser.getByteFrequencyData(freq);
        const { width, height } = canvas;
        c2d.clearRect(0, 0, width, height);
        const bars = 48;
        const step = Math.floor(freq.length / bars);
        const barW = width / bars;
        for (let i = 0; i < bars; i++) {
          const v = freq[i * step] / 255;
          const h = Math.max(3, v * height);
          c2d.fillStyle = "rgba(124, 108, 255, 0.85)";
          c2d.beginPath();
          c2d.roundRect(
            i * barW + barW * 0.2,
            (height - h) / 2,
            barW * 0.6,
            h,
            3,
          );
          c2d.fill();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stop(discard = false) {
    discardRef.current = discard;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  function reset() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl(null);
    setElapsed(0);
    setPlaying(false);
    setError(null);
    setPhase("idle");
  }

  async function submit() {
    if (!blob) return;
    setPhase("uploading");
    setError(null);
    try {
      await onUpload(blob);
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Upload fehlgeschlagen. Bitte erneut versuchen.",
      );
      setPhase("review");
    }
  }

  if (phase === "done") {
    return (
      <div className="flex items-center gap-3 rounded-squircle-md bg-ok-soft px-4 py-3.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ok text-white">
          <Check className="size-5" />
        </span>
        <p className="text-sm text-ink leading-relaxed">
          <strong>Deine Sprachprobe ist gespeichert.</strong> Wir kombinieren
          sie mit deinem Video zu deiner KI-Stimme — das läuft automatisch im
          Hintergrund.
        </p>
      </div>
    );
  }

  const prompt = PROMPTS[promptIdx];
  const size = 168;
  const strokeW = 7;
  const r = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="rounded-squircle-md bg-surface-soft p-5 space-y-4">
      {/* Ring + Mikro-Button */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={strokeW}
              className="stroke-line"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - Math.min(1, ringProgress))}
              className={cn(
                "transition-all duration-300",
                reachedTarget ? "stroke-ok" : "stroke-brand",
              )}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            {phase === "recording" ? (
              <>
                <span className="font-mono text-2xl font-semibold text-ink tabular-nums">
                  {fmt(elapsed)}
                </span>
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    reachedPerfect
                      ? "text-ok"
                      : reachedTarget
                        ? "text-ok"
                        : "text-ink-soft",
                  )}
                >
                  {reachedPerfect
                    ? "Perfekt!"
                    : reachedTarget
                      ? "Das reicht schon!"
                      : `noch ${fmt(minRecordSec - elapsed)}`}
                </span>
              </>
            ) : (
              <button
                type="button"
                disabled={!canRecord || phase === "review"}
                onClick={() => void start()}
                aria-label="Aufnahme starten"
                className={cn(
                  "inline-flex size-20 items-center justify-center rounded-full bg-ink text-white shadow-card transition-all duration-200 ease-spring",
                  canRecord && phase === "idle"
                    ? "hover:scale-105 hover:shadow-card-hover"
                    : "opacity-40 cursor-not-allowed",
                )}
              >
                <Mic className="size-8" />
              </button>
            )}
          </div>
        </div>

        {phase === "idle" && (
          <p className="text-center text-sm text-ink-muted leading-relaxed max-w-sm">
            Drück auf das Mikrofon und sprich einfach frei drauflos — ganze
            Sätze, dein normales Tempo. Der Ring zeigt dir, wann es reicht
            (ca. {fmt(minRecordSec)} Min.).
          </p>
        )}

        {phase === "recording" && (
          <>
            <canvas
              ref={canvasRef}
              width={280}
              height={44}
              className="h-11 w-[280px]"
            />
            <Button
              variant="subtle"
              size="sm"
              iconLeft={<Square className="size-3.5" />}
              onClick={() => stop(!reachedTarget)}
            >
              {reachedTarget ? "Fertig" : "Abbrechen"}
            </Button>
          </>
        )}
      </div>

      {/* Sprech-Impulse während Idle + Aufnahme */}
      {(phase === "idle" || phase === "recording") && (
        <div className="rounded-squircle-sm bg-surface px-4 py-3.5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              Sprech-Impuls {promptIdx + 1}/{PROMPTS.length}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Vorheriger Impuls"
                onClick={() =>
                  setPromptIdx((i) => (i - 1 + PROMPTS.length) % PROMPTS.length)
                }
                className="inline-flex size-6 items-center justify-center rounded-full text-ink-soft hover:bg-surface-soft hover:text-ink"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Nächster Impuls"
                onClick={() => setPromptIdx((i) => (i + 1) % PROMPTS.length)}
                className="inline-flex size-6 items-center justify-center rounded-full text-ink-soft hover:bg-surface-soft hover:text-ink"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm font-semibold text-ink">{prompt.title}</p>
          <p className="mt-0.5 text-sm text-ink-muted leading-relaxed">
            {prompt.text}
          </p>
        </div>
      )}

      {/* Review: anhören, neu aufnehmen oder verwenden */}
      {(phase === "review" || phase === "uploading") && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-squircle-sm bg-surface px-4 py-3 shadow-card">
            <button
              type="button"
              aria-label={playing ? "Pause" : "Anhören"}
              onClick={() => {
                const el = audioElRef.current;
                if (!el) return;
                if (playing) el.pause();
                else void el.play();
              }}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-white"
            >
              {playing ? (
                <Pause className="size-5" />
              ) : (
                <Play className="size-5 translate-x-px" />
              )}
            </button>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                Deine Aufnahme ({fmt(elapsed)} Min.)
              </p>
              <p className="text-xs text-ink-muted">
                Kurz reinhören — klingt sie nach dir, passt alles.
              </p>
            </div>
            {blobUrl && (
              <audio
                ref={audioElRef}
                src={blobUrl}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={phase === "uploading"}
              iconLeft={<ArrowRight className="size-4" />}
              onClick={() => void submit()}
            >
              Aufnahme verwenden
            </Button>
            <Button
              variant="subtle"
              size="sm"
              disabled={phase === "uploading"}
              iconLeft={<RotateCcw className="size-4" />}
              onClick={reset}
            >
              Neu aufnehmen
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-danger leading-relaxed">{error}</p>
      )}
    </div>
  );
}
