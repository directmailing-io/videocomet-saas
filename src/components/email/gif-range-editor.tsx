"use client";

/**
 * GIF-Ausschnitt-Editor für den Blast-Wizard (Step 3 bindet ihn ein).
 *
 * Props-gesteuert: Video-URL rein, `{startSec, durationSec}` raus.
 * Die Vorschau loopt den gewählten Bereich im HTML5-Video (stumm),
 * damit der User sieht, was später als GIF in der Mail landet.
 */

import * as React from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GifRangeValue {
  startSec: number;
  /** 2–4 Sekunden. */
  durationSec: number;
}

export interface GifRangeEditorProps {
  /** MP4-/Video-URL des Lead- bzw. Kampagnen-Videos. */
  videoUrl: string;
  value: GifRangeValue | null;
  onChange: (value: GifRangeValue) => void;
  className?: string;
}

const DURATION_OPTIONS = [2, 3, 4] as const;

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GifRangeEditor({
  videoUrl,
  value,
  onChange,
  className,
}: GifRangeEditorProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [videoDuration, setVideoDuration] = React.useState<number | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const startSec = value?.startSec ?? 0;
  const durationSec = value?.durationSec ?? 3;

  // Loop-Fenster: Video springt auf startSec zurueck, sobald es den
  // Bereich verlaesst (auch bei manuellem Scrubbing durch den User).
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      if (
        video.currentTime > startSec + durationSec ||
        video.currentTime < Math.max(0, startSec - 0.25)
      ) {
        video.currentTime = startSec;
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [startSec, durationSec]);

  const maxStart = Math.max(0, (videoDuration ?? 0) - durationSec);

  function commit(next: Partial<GifRangeValue>) {
    const merged: GifRangeValue = {
      startSec: Math.round((next.startSec ?? startSec) * 10) / 10,
      durationSec: next.durationSec ?? durationSec,
    };
    // Start clampen, wenn die Dauer wächst und das Fenster hinten überläuft.
    if (videoDuration != null) {
      merged.startSec = Math.max(
        0,
        Math.min(merged.startSec, Math.max(0, videoDuration - merged.durationSec)),
      );
    }
    onChange(merged);
    const video = videoRef.current;
    if (video) video.currentTime = merged.startSec;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.currentTime = startSec;
      void video.play();
    } else {
      video.pause();
    }
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className="w-full max-h-72 object-contain"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setVideoDuration(d);
            e.currentTarget.currentTime = startSec;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Vorschau pausieren" : "Vorschau abspielen"}
          className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/75"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "Pause" : "Bereich abspielen"}
        </button>
        <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          {fmt(startSec)} – {fmt(startSec + durationSec)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Startzeitpunkt</span>
          <span className="font-medium text-ink">{fmt(startSec)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, maxStart)}
          step={0.1}
          value={Math.min(startSec, maxStart)}
          disabled={videoDuration == null}
          onChange={(e) => commit({ startSec: Number(e.target.value) })}
          className="w-full accent-[#7C5CE8]"
          aria-label="Startzeitpunkt des GIF-Ausschnitts"
        />
        {videoDuration != null && (
          <div className="flex justify-between text-[11px] text-ink-muted">
            <span>0:00</span>
            <span>{fmt(videoDuration)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Dauer</span>
        {DURATION_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => commit({ durationSec: d })}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              durationSec === d
                ? "bg-[#1f1d2b] text-white"
                : "bg-surface-soft text-ink hover:bg-[#ece7f8]",
            )}
          >
            {d}s
          </button>
        ))}
      </div>
    </div>
  );
}
