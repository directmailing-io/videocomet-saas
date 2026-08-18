"use client";

import * as React from "react";
import { ImageOff, Loader2, RotateCw, Film } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PreviewPlayer } from "./preview-player";
import type { Segment } from "@/lib/segments/types";

export interface ThumbnailFramePickerProps {
  /** Webcam media item the frame is extracted from. */
  webcamMediaId: string | null;
  /** Duration of the webcam recording in seconds. Used for slider max + presets. */
  webcamDurationSec: number | null;
  /** Current frame time in milliseconds. Null = empty input. */
  value: number | null;
  /** Called when the user edits the frame time. */
  onChange: (ms: number | null) => void;
  /** Optional id for the number input (label association). */
  inputId?: string;
  /**
   * Kampagnen-Modus. Bei "with-presentation" zeigen wir den PreviewPlayer
   * (Webcam + Präsentation), damit die Vorschau exakt dem entspricht, was
   * der Worker aus dem finalen Composite-Video extrahiert.
   */
  mode?: "webcam-only" | "with-presentation";
  segments?: Segment[];
  pipPosition?: "bottom-left" | "bottom-right";
  pipShape?: "square" | "rounded" | "circle";
  /** Direkte MP4/HLS-URL der Webcam-Spur (für den PreviewPlayer). */
  webcamUrl?: string | null;
}

const DEFAULT_FALLBACK_DURATION_MS = 10_000;

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ThumbnailFramePicker({
  webcamMediaId,
  webcamDurationSec,
  value,
  onChange,
  inputId = "thumbnail-frame-ms",
  mode,
  segments,
  pipPosition,
  pipShape,
  webcamUrl,
}: ThumbnailFramePickerProps) {
  // Composite-Modus: wenn Präsentation UND Segmente vorhanden, zeigen wir
  // den PreviewPlayer statt eines ffmpeg-Bilds. Der Worker extrahiert das
  // finale PDF-Thumbnail ebenfalls aus dem Composite-Video → beide zeigen
  // bei gleichem `ms` dasselbe Layout. Personalisierbare Platzhalter (z.B.
  // {{firstName}}) sind pro Lead unterschiedlich, das ist so gewollt.
  const useComposite =
    mode === "with-presentation" && !!segments && segments.length > 0;

  const durationMs = React.useMemo(() => {
    if (useComposite && segments && segments.length > 0) {
      let total = 0;
      for (const s of segments) {
        const ms =
          typeof (s as { durationMs?: number }).durationMs === "number"
            ? (s as { durationMs?: number }).durationMs!
            : 0;
        total += ms;
      }
      return total || DEFAULT_FALLBACK_DURATION_MS;
    }
    return webcamDurationSec && webcamDurationSec > 0
      ? Math.round(webcamDurationSec * 1000)
      : DEFAULT_FALLBACK_DURATION_MS;
  }, [useComposite, segments, webcamDurationSec]);

  const effectiveMs = React.useMemo(() => {
    if (value === null || !Number.isFinite(value) || value < 0) return 0;
    return Math.min(Math.round(value), durationMs);
  }, [value, durationMs]);

  // 300ms debounce for the live preview so dragging the slider doesn't
  // hammer ffmpeg on every pixel of movement.
  const [debouncedMs, setDebouncedMs] = React.useState(effectiveMs);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedMs(effectiveMs), 300);
    return () => clearTimeout(t);
  }, [effectiveMs]);

  // Composite-Mode: Seek + Pause an den PreviewPlayer schicken.
  const [seekRequest, setSeekRequest] = React.useState<{ ms: number; nonce: number } | null>(null);
  const [pauseRequest, setPauseRequest] = React.useState<{ nonce: number } | null>(null);
  const nonceRef = React.useRef(0);
  React.useEffect(() => {
    if (!useComposite) return;
    nonceRef.current += 1;
    setSeekRequest({ ms: debouncedMs, nonce: nonceRef.current });
    setPauseRequest({ nonce: nonceRef.current });
  }, [debouncedMs, useComposite]);

  const [reloadKey, setReloadKey] = React.useState(0);
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

  const src =
    !useComposite && webcamMediaId
      ? `/api/media/${webcamMediaId}/frame?ms=${debouncedMs}&_=${reloadKey}`
      : null;

  React.useEffect(() => {
    if (src) setStatus("loading");
  }, [src]);

  const progressPct = Math.min(
    100,
    Math.max(0, (effectiveMs / Math.max(1, durationMs)) * 100),
  );

  const presets = React.useMemo(() => {
    const list = [
      { label: "Anfang", ms: 0 },
      { label: "1s", ms: 1000 },
      { label: "3s", ms: 3000 },
    ];
    if (durationMs >= 4000) {
      list.push({ label: "Mitte", ms: Math.round(durationMs / 2) });
    }
    if (durationMs >= 2000) {
      list.push({ label: "Ende", ms: Math.max(0, durationMs - 250) });
    }
    return list.filter((p) => p.ms <= durationMs);
  }, [durationMs]);

  const handleInput = (raw: string) => {
    if (!raw.trim()) {
      onChange(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    onChange(Math.min(Math.round(n), durationMs));
  };

  const handleSlider = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(Math.max(0, Math.round(n)), durationMs));
  };

  return (
    <div className="grid gap-5 md:grid-cols-[1fr,minmax(0,22rem)] md:items-start">
      {/* ── Controls (left) ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <Label htmlFor={inputId}>Frame-Zeitpunkt</Label>

          {/* Slider + numeric input row */}
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={durationMs}
              step={50}
              value={effectiveMs}
              onChange={(e) => handleSlider(e.target.value)}
              disabled={!webcamMediaId}
              aria-label="Frame-Zeit"
              className={cn(
                "h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-line",
                "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
                "[&::-webkit-slider-thumb]:appearance-none",
                "[&::-webkit-slider-thumb]:rounded-full",
                "[&::-webkit-slider-thumb]:bg-[#AA8CF5]",
                "[&::-webkit-slider-thumb]:shadow-brand",
                "[&::-webkit-slider-thumb]:transition-transform",
                "[&::-webkit-slider-thumb]:hover:scale-110",
                "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4",
                "[&::-moz-range-thumb]:rounded-full",
                "[&::-moz-range-thumb]:border-0",
                "[&::-moz-range-thumb]:bg-[#AA8CF5]",
                !webcamMediaId && "cursor-not-allowed opacity-50",
              )}
              style={{
                background: webcamMediaId
                  ? `linear-gradient(to right, #AA8CF5 0%, #AA8CF5 ${progressPct}%, #ebebeb ${progressPct}%, #ebebeb 100%)`
                  : undefined,
              }}
            />

            <div className="relative w-28 shrink-0">
              <Input
                id={inputId}
                type="number"
                min={0}
                max={durationMs}
                step={100}
                placeholder="3000"
                value={value ?? ""}
                onChange={(e) => handleInput(e.target.value)}
                disabled={!webcamMediaId}
                className="pr-9 tabular-nums text-right"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">
                ms
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
            <span className="tabular-nums">{formatTime(effectiveMs)}</span>
            <span className="tabular-nums">
              {webcamDurationSec ? `Dauer ${formatTime(durationMs)}` : "—"}
            </span>
          </div>
        </div>

        {/* Quick presets */}
        {webcamMediaId && presets.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">
              Schnellauswahl
            </p>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const isActive = Math.abs(p.ms - effectiveMs) < 50;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => onChange(p.ms)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      isActive
                        ? "border-brand-deep bg-brand-soft text-brand-deep"
                        : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-ink-muted leading-relaxed">
          Wähle den exakten Zeitpunkt im Video, der als Standbild im PDF
          eingebettet wird. Bewege den Regler oder gib einen Wert in
          Millisekunden ein.
        </p>
      </div>

      {/* ── Preview (right) ───────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-ink">Vorschau</p>
          {(webcamMediaId || useComposite) && (
            <span className="rounded-full bg-ink/90 px-2 py-0.5 text-[10px] font-medium text-white tabular-nums">
              {formatTime(effectiveMs)}
            </span>
          )}
        </div>

        {useComposite ? (
          // Composite: PreviewPlayer springt auf debouncedMs und pausiert
          // → identisches Layout wie der Worker-Extract aus dem finalen
          // Composite-Video (Webcam + Präsentation + Cursor-Overlay).
          <div className="rounded-squircle-sm overflow-hidden">
            <PreviewPlayer
              segments={segments ?? []}
              webcamUrl={webcamUrl ?? null}
              webcamDurationSec={webcamDurationSec ?? null}
              pipPosition={pipPosition ?? "bottom-left"}
              pipShape={pipShape ?? "rounded"}
              seekRequest={seekRequest}
              pauseRequest={pauseRequest}
              stageBgClassName="bg-canvas-deep"
              maxStageWidthClassName="max-w-none"
            />
            <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
              Der Worker extrahiert im PDF genau diesen Zeitpunkt aus dem
              finalen Composite-Video — Layout ist identisch. Platzhalter wie
              &#123;&#123;firstName&#125;&#125; werden pro Empfänger ersetzt.
            </p>
          </div>
        ) : (
          <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm border border-line bg-gradient-to-br from-surface-muted to-line">
            {!webcamMediaId ? (
              <EmptyState />
            ) : (
              <>
                {/* Image — only visible once loaded. Stays hidden during
                    loading + error so the broken-image glyph never appears. */}
                {src && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={src}
                    src={src}
                    alt=""
                    className={cn(
                      "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
                      status === "loaded" ? "opacity-100" : "opacity-0",
                    )}
                    onLoad={() => setStatus("loaded")}
                    onError={() => setStatus("error")}
                  />
                )}

                {status === "loading" && <LoadingState />}
                {status === "error" && (
                  <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── States ──────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-ink-muted">
      <Film className="size-6 opacity-60" />
      <span className="text-[11px] leading-tight max-w-[14rem]">
        Wähle in Schritt 1 eine Webcam-Aufnahme, um den Frame zu sehen.
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-muted/70 backdrop-blur-sm">
      <Loader2 className="size-5 animate-spin text-ink-muted" />
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-muted/95 p-4 text-center">
      <ImageOff className="size-5 text-ink-muted" />
      <span className="text-[11px] leading-tight text-ink-muted">
        Frame konnte nicht geladen werden.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:border-ink-muted hover:text-ink transition-colors"
      >
        <RotateCw className="size-3" />
        Erneut versuchen
      </button>
    </div>
  );
}
