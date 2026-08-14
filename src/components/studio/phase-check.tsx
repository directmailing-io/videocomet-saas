"use client";

/**
 * phase-check — Phase 2 des Studio-Flows: reiner Technik-Check
 * (Kamera/Mikro).
 *
 * Der MediaStream lebt auf Flow-Ebene (use-studio-media) und überlebt den
 * Wechsel in die Live-Phase. Hier: großes Kamerabild, Mikro-Pegel
 * (AnalyserNode), Geräte-Auswahl. Die PiP-Wahl (Position/Form des
 * Kamerabilds) sitzt im Standby der Aufnahme-Ansicht — dort sieht man die
 * Wirkung live am echten Bild. „Weiter zur Aufnahme-Ansicht" wechselt nur
 * die Phase — die Aufnahme startet erst im Standby der Live-Phase.
 */

import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mic,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudioWordmark } from "./studio-wordmark";
import type { UseStudioMediaResult } from "./use-studio-media";

export interface PhaseCheckProps {
  media: UseStudioMediaResult;
  /** true, sobald alle Szenen-Bilder vor-decodiert sind. */
  preloadReady: boolean;
  /** Wechselt zur Live-Phase (Standby) — startet noch keine Aufnahme. */
  onContinue: () => void;
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

export function PhaseCheck({
  media,
  preloadReady,
  onContinue,
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
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-3">
          <StudioWordmark />
          <span className="text-sm font-medium text-ink-muted">
            Technik-Check
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink"
        >
          <X className="size-3.5" />
          Abbrechen
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-stretch justify-center gap-4 p-4">
        {/* Kamera-Vorschau */}
        <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-3">
          <div className="relative w-full overflow-hidden rounded-squircle-xl bg-black shadow-lift">
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

          {/* Geräte-Auswahl — immer sichtbar, sobald Geräte gelistet sind */}
          {(media.cameras.length > 0 || media.microphones.length > 0) && (
            <div className="flex gap-3">
              {media.cameras.length > 0 && (
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
              {media.microphones.length > 0 && (
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

          {/* Ablauf-Bullets + KI-Begrüßungs-Tipp leben als wegklickbare
           * Karte im Standby der Aufnahme-Ansicht (phase-live) — dort, wo
           * sie gebraucht werden. */}
          {!preloadReady && (
            <p className="flex items-center gap-2 rounded-squircle-lg bg-surface px-3 py-2 text-[11px] text-ink-muted shadow-card">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              Szenen-Bilder werden vorgeladen…
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between border-t border-line-soft bg-surface/60 px-6 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          iconLeft={<ArrowLeft className="size-3.5" />}
          className="border-transparent bg-transparent text-ink-muted hover:bg-canvas-deep hover:text-ink"
        >
          Zurück zur Regie
        </Button>
        <span title={readyTitle}>
          <Button
            onClick={onContinue}
            disabled={!ready}
            iconRight={<ArrowRight className="size-4" />}
          >
            Weiter zur Aufnahme-Ansicht
          </Button>
        </span>
      </footer>
    </div>
  );
}
