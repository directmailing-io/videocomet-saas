"use client";

/**
 * phase-check — Phase 2 des Studio-Flows: Kamera/Mikro-Check + PiP-Wahl.
 *
 * Der MediaStream lebt auf Flow-Ebene (use-studio-media) und überlebt den
 * Wechsel in die Live-Phase. Hier: großes Kamerabild, Mikro-Pegel
 * (AnalyserNode), Geräte-Auswahl, PiP-Position/-Form auf einer
 * 16:9-Miniatur. Countdown + Aufnahme starten erst in Phase 3.
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Circle,
  Dumbbell,
  Loader2,
  Mic,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type {
  StudioPipPosition,
  StudioPipShape,
} from "./studio-flow";
import type { UseStudioMediaResult } from "./use-studio-media";

export interface PhaseCheckProps {
  media: UseStudioMediaResult;
  pipPosition: StudioPipPosition;
  pipShape: StudioPipShape;
  onPipPositionChange: (pos: StudioPipPosition) => void;
  onPipShapeChange: (shape: StudioPipShape) => void;
  /** true, sobald alle Szenen-Bilder vor-decodiert sind. */
  preloadReady: boolean;
  onStartRecording: () => void;
  onStartPractice: () => void;
  onBack: () => void;
  onCancel: () => void;
}

/** Mikro-Pegel 0..1 via AnalyserNode (rAF-Loop, Cleanup schließt Context). */
function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = React.useState(0);

  React.useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(1, sum / data.length / 140));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      setLevel(0);
    }
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
    };
  }, [stream]);

  return level;
}

const SHAPE_OPTIONS: { value: StudioPipShape; label: string }[] = [
  { value: "square", label: "Eckig" },
  { value: "rounded", label: "Abgerundet" },
  { value: "circle", label: "Kreis" },
];

export function PhaseCheck({
  media,
  pipPosition,
  pipShape,
  onPipPositionChange,
  onPipShapeChange,
  preloadReady,
  onStartRecording,
  onStartPractice,
  onBack,
  onCancel,
}: PhaseCheckProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const micLevel = useMicLevel(media.stream);

  // Kamera einmalig initialisieren (Stream kann vom Flow schon leben).
  const initRef = React.useRef(false);
  React.useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (!media.stream && !media.initializing) void media.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = media.stream;
    if (media.stream) void v.play().catch(() => undefined);
  }, [media.stream]);

  const ready = !!media.stream && preloadReady;
  const readyTitle = media.stream
    ? preloadReady
      ? undefined
      : "Szenen-Bilder werden noch geladen…"
    : "Kamera ist noch nicht bereit.";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div>
          <h1 className="text-sm font-bold text-white">
            Studio-Aufnahme · Bereit-Check
          </h1>
          <p className="text-xs text-white/50">
            Prüfe Kamera und Mikrofon und wähle, wo dein Kamerabild im Video
            erscheint.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
          Abbrechen
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-4 p-4">
        {/* Kamera-Vorschau */}
        <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-3">
          <div className="relative w-full overflow-hidden rounded-squircle-lg bg-black shadow-card">
            <div className="relative aspect-video w-full">
              {media.error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <AlertCircle className="size-8 text-danger" />
                  <p className="max-w-md text-sm leading-relaxed text-white/80">
                    {media.error}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void media.init()}
                  >
                    Erneut versuchen
                  </Button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    autoPlay
                    className="absolute inset-0 size-full -scale-x-100 object-cover"
                  />
                  {(media.initializing || !media.stream) && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-white/70">
                      <Loader2 className="size-4 animate-spin" />
                      Kamera wird gestartet…
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Mikro-Pegel */}
          <div className="flex items-center gap-3 rounded-squircle-lg bg-surface px-4 py-3 shadow-card">
            <Mic className="size-4 shrink-0 text-brand-deep" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-75"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
            <span className="w-32 shrink-0 text-right text-[10px] text-ink-muted">
              {micLevel > 0.02
                ? "Mikrofon empfängt dich"
                : "Sag kurz etwas zum Test"}
            </span>
          </div>

          {/* Geräte-Auswahl */}
          {(media.cameras.length > 1 || media.microphones.length > 1) && (
            <div className="flex gap-3">
              {media.cameras.length > 1 && (
                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-squircle-lg bg-surface px-3 py-2 shadow-card">
                  <Video className="size-4 shrink-0 text-ink-muted" />
                  <select
                    value={media.cameraId ?? ""}
                    onChange={(e) =>
                      void media.init({ cameraId: e.target.value })
                    }
                    className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none"
                  >
                    {media.cameras.map((c) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {media.microphones.length > 1 && (
                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-squircle-lg bg-surface px-3 py-2 shadow-card">
                  <Mic className="size-4 shrink-0 text-ink-muted" />
                  <select
                    value={media.microphoneId ?? ""}
                    onChange={(e) =>
                      void media.init({ microphoneId: e.target.value })
                    }
                    className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none"
                  >
                    {media.microphones.map((m) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {/* PiP-Wahl */}
        <div className="flex w-[280px] shrink-0 flex-col gap-3">
          <section className="rounded-squircle-lg bg-surface p-3 shadow-card">
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Dein Kamerabild im Video
            </h2>
            {/* 16:9-Miniatur mit klickbaren Positionen */}
            <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink/90">
              <div className="absolute inset-2 rounded border border-dashed border-white/20" />
              {(["bottom-left", "bottom-right"] as const).map((pos) => {
                const active = pipPosition === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    aria-label={
                      pos === "bottom-left" ? "Unten links" : "Unten rechts"
                    }
                    onClick={() => onPipPositionChange(pos)}
                    className={cn(
                      "absolute bottom-2 h-[28%] w-[25%] border-2 transition-all",
                      pos === "bottom-left" ? "left-2" : "right-2",
                      pipShape === "circle"
                        ? "aspect-square h-auto rounded-full"
                        : pipShape === "rounded"
                          ? "rounded-lg"
                          : "rounded-none",
                      active
                        ? "border-brand bg-brand/60 shadow-lift"
                        : "border-white/30 bg-white/10 hover:bg-white/20",
                    )}
                  />
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[10px] leading-snug text-ink-muted">
              Klicke auf eine Ecke, um die Position zu wählen.
            </p>

            <div className="mt-3 flex gap-1.5">
              {SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onPipShapeChange(opt.value)}
                  className={cn(
                    "flex-1 rounded-full px-2 py-1.5 text-[11px] font-semibold transition-colors",
                    pipShape === opt.value
                      ? "bg-ink text-white"
                      : "bg-surface-soft text-ink-muted hover:bg-surface-muted",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-squircle-lg bg-surface p-3 shadow-card">
            <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">
              So läuft die Aufnahme
            </h2>
            <ul className="flex flex-col gap-1.5 px-1 text-[11px] leading-snug text-ink-muted">
              <li>· Unten wechselst du live zwischen deinen Szenen.</li>
              <li>· Auf der Bühne kannst du scrollen — genau das sieht dein Empfänger.</li>
              <li>· Zum Beenden hältst du den Beenden-Knopf kurz gedrückt.</li>
            </ul>
          </section>

          {!preloadReady && (
            <p className="flex items-center gap-2 rounded-squircle-lg bg-surface px-3 py-2 text-[11px] text-ink-muted shadow-card">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              Szenen-Bilder werden vorgeladen…
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-white/10 px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          iconLeft={<ArrowLeft className="size-3.5" />}
          className="border-transparent bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
        >
          Zurück zur Regie
        </Button>
        <div className="flex items-center gap-2">
          <span title={readyTitle}>
            <Button
              variant="ghost"
              onClick={onStartPractice}
              disabled={!ready}
              iconLeft={<Dumbbell className="size-4" />}
            >
              Erst mal üben
            </Button>
          </span>
          <span title={readyTitle}>
            <Button
              onClick={onStartRecording}
              disabled={!ready}
              iconLeft={<Circle className="size-3 fill-danger text-danger" />}
            >
              Aufnahme starten
            </Button>
          </span>
        </div>
      </footer>
    </div>
  );
}
