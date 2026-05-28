"use client";

import * as React from "react";
import {
  Globe,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Type,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type Segment,
  type SegmentKind,
  isImageSegment,
  isVideoSegment,
} from "@/lib/segments/types";
import { createSegment, SEGMENT_KIND_LABELS } from "@/lib/segments/defaults";
import {
  totalDurationMs,
  formatDuration,
  adjustToFit,
} from "@/lib/segments/duration";
import { PreviewPlayer } from "@/components/editor/preview-player";
import { Timeline } from "@/components/editor/timeline";
import { SegmentEditor } from "@/components/editor/segment-editor";

export interface WizardStep3Props {
  segments: Segment[];
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  webcamUrl: string | null;
  /** Loaded from the media item. */
  webcamDurationSec: number | null;
  /** All media items the user can pick from inside the segment editor. */
  mediaItems: Array<{
    id: string;
    name: string;
    publicUrl: string;
    type: string;
  }>;
  onSegmentsChange: (segments: Segment[]) => void;
  onPipPositionChange: (pos: "bottom-left" | "bottom-right") => void;
  onPipShapeChange: (shape: "square" | "rounded" | "circle") => void;
}

const ADD_BUTTONS: { kind: SegmentKind; icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "website", icon: Globe },
  { kind: "image", icon: ImageIcon },
  { kind: "video", icon: VideoIcon },
  { kind: "gdocs", icon: FileText },
  { kind: "text", icon: Type },
];

export function WizardStep3Editor({
  segments,
  pipPosition,
  pipShape,
  webcamUrl,
  webcamDurationSec,
  mediaItems,
  onSegmentsChange,
  onPipPositionChange,
  onPipShapeChange,
}: WizardStep3Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = React.useState(0);

  // We may not get webcamDurationSec from initial props (e.g. for older media
  // items where durationSec wasn't probed at upload). In that case we sniff
  // it client-side from a hidden <video> tag.
  const [probedDurationSec, setProbedDurationSec] = React.useState<number | null>(null);
  const effectiveWebcamSec = webcamDurationSec ?? probedDurationSec;
  const webcamDurationMs = effectiveWebcamSec ? Math.round(effectiveWebcamSec * 1000) : null;

  React.useEffect(() => {
    if (!webcamUrl || webcamDurationSec) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.crossOrigin = "anonymous";
    v.src = webcamUrl;
    const handler = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setProbedDurationSec(v.duration);
      }
    };
    v.addEventListener("loadedmetadata", handler);
    return () => {
      v.removeEventListener("loadedmetadata", handler);
      v.src = "";
    };
  }, [webcamUrl, webcamDurationSec]);

  const total = totalDurationMs(segments);
  const diff = webcamDurationMs ? total - webcamDurationMs : 0;

  function addSegment(kind: SegmentKind) {
    const seg = createSegment(kind);
    onSegmentsChange([...segments, seg]);
    setSelectedId(seg.id);
  }

  function updateSegment(updated: Segment) {
    onSegmentsChange(segments.map((s) => (s.id === updated.id ? updated : s)));
  }

  function deleteSegment(id: string) {
    onSegmentsChange(segments.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function autoFit() {
    if (!webcamDurationMs) return;
    const next = adjustToFit(segments, webcamDurationMs, "scale");
    onSegmentsChange(next);
  }

  const selectedSegment = segments.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink mb-1">Editor</h2>
        <p className="text-sm text-ink-muted">
          Baue deine Videopräsentation auf. Reihenfolge, Dauer (ms-präzise),
          PiP-Position und Form lassen sich anpassen.
        </p>
      </div>

      {/* Add-segment buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {ADD_BUTTONS.map(({ kind, icon: Icon }) => (
          <Button
            key={kind}
            variant="ghost"
            size="sm"
            onClick={() => addSegment(kind)}
            iconLeft={<Icon className="size-4" />}
          >
            + {SEGMENT_KIND_LABELS[kind]}
          </Button>
        ))}
      </div>

      {/* Duration banner */}
      {webcamDurationMs && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-squircle-md px-4 py-3 border",
            Math.abs(diff) < 100
              ? "border-ok/30 bg-ok/5"
              : diff > 0
              ? "border-warn/30 bg-warn/5"
              : "border-brand/30 bg-brand-soft",
          )}
        >
          <div className="flex flex-wrap items-baseline gap-4 text-sm">
            <span className="text-ink-muted">Segmente gesamt:</span>
            <span className="font-mono font-bold text-ink tabular-nums">
              {formatDuration(total)}
            </span>
            <span className="text-ink-muted">Webcam-Dauer:</span>
            <span className="font-mono font-bold text-ink tabular-nums">
              {formatDuration(webcamDurationMs)}
            </span>
            {Math.abs(diff) >= 100 && (
              <span
                className={cn(
                  "font-semibold",
                  diff > 0 ? "text-warn" : "text-brand-deep",
                )}
              >
                {diff > 0
                  ? `${formatDuration(diff)} zu viel`
                  : `${formatDuration(-diff)} zu wenig`}
              </span>
            )}
          </div>
          {Math.abs(diff) >= 100 && segments.length > 0 && (
            <Button size="sm" variant="subtle" onClick={autoFit}>
              Auto-Anpassen
            </Button>
          )}
        </div>
      )}

      {/* Preview + side controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preview takes 2/3 on desktop */}
        <div className="lg:col-span-2">
          <PreviewPlayer
            segments={segments}
            webcamUrl={webcamUrl}
            webcamDurationSec={effectiveWebcamSec}
            pipPosition={pipPosition}
            pipShape={pipShape}
            sampleData={{
              firstName: "Max",
              lastName: "Mustermann",
              company: "Acme GmbH",
            }}
          />
        </div>

        {/* PiP-Settings 1/3 */}
        <div className="space-y-5">
          <div>
            <Label>PiP-Position</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["bottom-left", "bottom-right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onPipPositionChange(pos)}
                  className={cn(
                    "rounded-squircle-md border p-3 text-xs font-medium transition-all",
                    pipPosition === pos
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line text-ink hover:border-brand/50",
                  )}
                >
                  <div className="aspect-video bg-ink/5 rounded-squircle-sm mb-1 relative">
                    <span
                      className={cn(
                        "absolute size-4 rounded-sm bg-brand",
                        pos === "bottom-left"
                          ? "bottom-1 left-1"
                          : "bottom-1 right-1",
                      )}
                    />
                  </div>
                  {pos === "bottom-left" ? "Links" : "Rechts"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>PiP-Form</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(
                [
                  { v: "square", label: "Eckig", radius: "rounded-none" },
                  { v: "rounded", label: "Rund.", radius: "rounded-md" },
                  { v: "circle", label: "Rund", radius: "rounded-full" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onPipShapeChange(opt.v)}
                  className={cn(
                    "rounded-squircle-md border p-2 text-[11px] font-medium transition-all flex flex-col items-center gap-1.5",
                    pipShape === opt.v
                      ? "border-brand bg-brand-soft text-brand-deep"
                      : "border-line text-ink hover:border-brand/50",
                  )}
                >
                  <span className={cn("size-6 bg-brand", opt.radius)} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <Timeline
        segments={segments}
        currentTimeMs={currentTimeMs}
        totalDurationMs={Math.max(total, webcamDurationMs ?? 0)}
        selectedSegmentId={selectedId}
        onSelectSegment={setSelectedId}
        onSegmentsChange={onSegmentsChange}
        onSeek={setCurrentTimeMs}
      />

      {/* Active segment editor */}
      {selectedSegment ? (
        <SegmentEditor
          segment={selectedSegment}
          onChange={updateSegment}
          onDelete={() => deleteSegment(selectedSegment.id)}
          mediaItems={mediaItems}
          webcamDurationMs={webcamDurationMs}
        />
      ) : segments.length > 0 ? (
        <Card className="p-6 text-center text-sm text-ink-muted">
          Wähle ein Segment in der Timeline aus, um es zu bearbeiten.
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <Plus className="size-6 text-ink-muted mx-auto mb-2" />
          <p className="text-sm text-ink-muted">
            Füge oben ein erstes Segment hinzu, um zu starten.
          </p>
        </Card>
      )}
    </div>
  );
}
