"use client";

/**
 * phase-review — Phase 4 des Studio-Flows: Upload, Vorschau, Übernehmen.
 *
 * Beim Mount wird der Aufnahme-Blob zu POST /api/media (kind=webcam)
 * hochgeladen. Die Server-ffprobe-Dauer ist maßgeblich für
 * deriveStudioSegments (Σ Segmentdauern == Webcam-Dauer). Danach: echter
 * PreviewPlayer + Segment-Liste; verdächtig kurze Segmente („Versehen?")
 * können entfernt werden — die Webcam wird dabei nie geschnitten.
 */

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PreviewPlayer } from "@/components/editor/preview-player";
import type { StudioTab } from "@/lib/studio/types";
import {
  deriveStudioSegments,
  removeDerivedSegment,
} from "@/lib/studio/derive-segments";
import type { DerivedStudioSegment } from "@/lib/studio/types";
import type {
  StudioFlowResult,
  StudioPipPosition,
  StudioPipShape,
} from "./studio-flow";
import { SceneKindIcon } from "./scene-icon";
import {
  formatSegmentDuration,
  tabLabel,
  uploadStudioRecording,
  type StudioRecording,
  type StudioSceneKind,
  type StudioUploadedMedia,
} from "./internal";

export interface PhaseReviewProps {
  tabs: StudioTab[];
  recording: StudioRecording;
  pipPosition: StudioPipPosition;
  pipShape: StudioPipShape;
  onComplete: (result: StudioFlowResult) => void;
  /** „Neu aufnehmen" (bestätigt): zurück zum Bereit-Check. */
  onRetake: () => void;
}

type UploadState =
  | { phase: "uploading"; pct: number }
  | { phase: "error"; message: string }
  | { phase: "done"; media: StudioUploadedMedia };

export function PhaseReview({
  tabs,
  recording,
  pipPosition,
  pipShape,
  onComplete,
  onRetake,
}: PhaseReviewProps) {
  const [upload, setUpload] = React.useState<UploadState>({
    phase: "uploading",
    pct: 0,
  });
  const [derived, setDerived] = React.useState<DerivedStudioSegment[]>([]);
  /** StrictMode-Guard: Upload nur einmal starten. */
  const startedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startUpload = React.useCallback(() => {
    setUpload({ phase: "uploading", pct: 0 });
    uploadStudioRecording(
      recording.blob,
      recording.recordedMs / 1000,
      (pct) => {
        if (mountedRef.current) {
          setUpload((prev) =>
            prev.phase === "uploading" ? { phase: "uploading", pct } : prev,
          );
        }
      },
    )
      .then((media) => {
        if (!mountedRef.current) return;
        // Server-ffprobe-Dauer ist maßgeblich (falls vorhanden).
        const totalMs =
          media.durationSec && media.durationSec > 0
            ? media.durationSec * 1000
            : undefined;
        setDerived(
          deriveStudioSegments(tabs, recording.events, recording.recordedMs, {
            totalMs,
          }),
        );
        setUpload({ phase: "done", media });
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setUpload({
          phase: "error",
          message:
            err instanceof Error
              ? err.message
              : "Upload fehlgeschlagen. Bitte erneut versuchen.",
        });
      });
  }, [recording, tabs]);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startUpload();
  }, [startUpload]);

  const segments = React.useMemo(
    () => derived.map((d) => d.segment),
    [derived],
  );

  const handleRemove = (index: number) => {
    setDerived((prev) => removeDerivedSegment(prev, index));
  };

  const handleRetake = () => {
    if (
      !window.confirm(
        "Aufnahme verwerfen und neu aufnehmen? Deine Szenen und dein Teleprompter-Text bleiben erhalten.",
      )
    ) {
      return;
    }
    // Bereits hochgeladene Datei aufräumen (Fire-and-forget).
    if (upload.phase === "done") {
      void fetch(`/api/media/${upload.media.id}`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => undefined);
    }
    onRetake();
  };

  const handleComplete = () => {
    if (upload.phase !== "done" || derived.length === 0) return;
    onComplete({
      webcamMediaId: upload.media.id,
      segments: derived.map((d) => d.segment),
      pipPosition,
      pipShape,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-white/10 px-6 py-3">
        <h1 className="text-sm font-bold text-white">
          Studio-Aufnahme · Überprüfen
        </h1>
        <p className="text-xs text-white/50">
          Schau dir deine Aufnahme an. Verdächtig kurze Szenen kannst du
          entfernen — dein Video bleibt dabei ungeschnitten.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4">
        {upload.phase === "uploading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader2 className="size-8 animate-spin text-brand" />
            <p className="text-sm font-semibold text-white">
              Aufnahme wird gespeichert…
            </p>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-[width]"
                style={{ width: `${upload.pct}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-white/50">{upload.pct} %</p>
          </div>
        )}

        {upload.phase === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <AlertCircle className="size-8 text-danger" />
            <p className="max-w-md text-center text-sm leading-relaxed text-white/80">
              {upload.message}
            </p>
            <Button variant="ghost" onClick={startUpload}>
              Erneut versuchen
            </Button>
          </div>
        )}

        {upload.phase === "done" && (
          <>
            {/* Vorschau-Player */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="overflow-hidden rounded-squircle-lg shadow-card">
                <PreviewPlayer
                  segments={segments}
                  webcamUrl={upload.media.publicUrl}
                  webcamDurationSec={
                    upload.media.durationSec ?? recording.recordedMs / 1000
                  }
                  pipPosition={pipPosition}
                  pipShape={pipShape}
                />
              </div>
            </div>

            {/* Segment-Liste */}
            <div className="flex w-[340px] shrink-0 flex-col gap-2 overflow-y-auto">
              <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-white/50">
                Szenen in deinem Video ({derived.length})
              </h2>
              {derived.length === 0 && (
                <p className="rounded-squircle-md bg-white/5 px-3 py-3 text-xs leading-relaxed text-white/60">
                  Aus dieser Aufnahme konnten keine Szenen abgeleitet werden —
                  vermutlich war sie zu kurz. Klicke unten links auf „Neu
                  aufnehmen" und versuche es noch einmal.
                </p>
              )}
              {derived.map((d, i) => {
                const kind = d.segment.kind as StudioSceneKind;
                const sourceTab = tabs.find((t) => t.id === d.tabId);
                const label =
                  d.segment.label?.trim() ||
                  (sourceTab ? tabLabel(sourceTab) : "Szene");
                return (
                  <div
                    key={d.segment.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-squircle-md bg-surface px-3 py-2.5 shadow-card",
                      d.flagged && "ring-1 ring-warn/60",
                    )}
                  >
                    <span className="w-4 shrink-0 text-center text-xs font-bold text-ink-muted">
                      {i + 1}
                    </span>
                    <SceneKindIcon
                      kind={kind}
                      className="shrink-0 text-brand-deep"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                      {label}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
                      {formatSegmentDuration(d.segment.durationMs)}
                    </span>
                    {d.flagged && (
                      <>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold text-warn">
                          <AlertTriangle className="size-3" />
                          Versehen?
                        </span>
                        <button
                          type="button"
                          aria-label="Segment entfernen"
                          onClick={() => handleRemove(i)}
                          className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              <p className="px-1 text-[10px] leading-snug text-white/40">
                Entfernst du eine Szene, übernimmt die vorherige Szene deren
                Zeit — Bild und Ton bleiben synchron.
              </p>
            </div>
          </>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-white/10 px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetake}
          iconLeft={<RotateCcw className="size-3.5" />}
          className="border-transparent bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
        >
          Neu aufnehmen
        </Button>
        <Button
          onClick={handleComplete}
          disabled={upload.phase !== "done" || derived.length === 0}
          iconLeft={<Check className="size-4" />}
        >
          Übernehmen
        </Button>
      </footer>
    </div>
  );
}
