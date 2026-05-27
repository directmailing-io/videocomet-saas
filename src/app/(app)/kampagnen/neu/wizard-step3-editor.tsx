"use client";

import * as React from "react";
import {
  Globe,
  Image as ImageIcon,
  Video,
  FileText,
  Type,
  Trash2,
  GripVertical,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WizardSegment } from "./wizard-container";

export interface WizardStep3Props {
  segments: WizardSegment[];
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  onSegmentsChange: (segments: WizardSegment[]) => void;
  onPipPositionChange: (pos: "bottom-left" | "bottom-right") => void;
  onPipShapeChange: (shape: "square" | "rounded" | "circle") => void;
}

const SEGMENT_TYPES: {
  type: WizardSegment["type"];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: "website", label: "Website", icon: Globe },
  { type: "image", label: "Bild", icon: ImageIcon },
  { type: "video", label: "Video", icon: Video },
  { type: "googledocs", label: "Google Docs", icon: FileText },
  { type: "textslide", label: "Textfolie", icon: Type },
];

function makeId(): string {
  return `seg-${Math.random().toString(36).slice(2, 10)}`;
}

export function WizardStep3Editor({
  segments,
  pipPosition,
  pipShape,
  onSegmentsChange,
  onPipPositionChange,
  onPipShapeChange,
}: WizardStep3Props) {
  function addSegment(type: WizardSegment["type"]) {
    const label =
      SEGMENT_TYPES.find((s) => s.type === type)?.label ?? "Segment";
    onSegmentsChange([
      ...segments,
      { id: makeId(), type, label: `${label} ${segments.length + 1}` },
    ]);
  }

  function removeSegment(id: string) {
    onSegmentsChange(segments.filter((s) => s.id !== id));
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink mb-1">Editor</h2>
        <p className="text-sm text-ink-muted mb-4">
          Baue deine Videopraesentation aus Segmenten auf. Reihenfolge,
          PiP-Position und PiP-Form lassen sich anpassen.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {SEGMENT_TYPES.map((s) => {
            const Icon = s.icon;
            return (
              <Button
                key={s.type}
                variant="ghost"
                size="sm"
                onClick={() => addSegment(s.type)}
                iconLeft={<Icon className="size-4" />}
              >
                {s.label}
              </Button>
            );
          })}
        </div>

        {segments.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-ink-muted">
              Noch keine Segmente. Fuege oben dein erstes Segment hinzu.
            </CardContent>
          </Card>
        ) : (
          <ol className="space-y-2">
            {segments.map((seg, idx) => {
              const meta = SEGMENT_TYPES.find((s) => s.type === seg.type);
              const Icon = meta?.icon ?? Globe;
              return (
                <li
                  key={seg.id}
                  className="flex items-center gap-3 bg-surface border border-line rounded-squircle-md p-3"
                >
                  <span className="text-ink-muted">
                    <GripVertical className="size-4" />
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 text-sm font-medium text-ink truncate">
                    {idx + 1}. {seg.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSegment(seg.id)}
                    className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger transition-colors"
                    aria-label="Segment entfernen"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-3">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => addSegment("textslide")}
            iconLeft={<Plus className="size-4" />}
          >
            Segment hinzufuegen
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-line">
        <div>
          <Label>PiP-Position</Label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {(["bottom-left", "bottom-right"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => onPipPositionChange(pos)}
                className={cn(
                  "rounded-squircle-md border p-4 text-sm font-medium transition-all",
                  pipPosition === pos
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-line text-ink hover:border-brand/50",
                )}
              >
                <div className="aspect-video bg-ink/5 rounded-squircle-sm mb-2 relative">
                  <span
                    className={cn(
                      "absolute size-6 rounded-sm bg-brand",
                      pos === "bottom-left" ? "bottom-1 left-1" : "bottom-1 right-1",
                    )}
                  />
                </div>
                {pos === "bottom-left" ? "Links unten" : "Rechts unten"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>PiP-Form</Label>
          <div className="grid grid-cols-3 gap-3 mt-2">
            {(
              [
                { v: "square", label: "Eckig", radius: "rounded-none" },
                { v: "rounded", label: "Abgerundet", radius: "rounded-md" },
                { v: "circle", label: "Rund", radius: "rounded-full" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => onPipShapeChange(opt.v)}
                className={cn(
                  "rounded-squircle-md border p-4 text-xs font-medium transition-all flex flex-col items-center gap-2",
                  pipShape === opt.v
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-line text-ink hover:border-brand/50",
                )}
              >
                <span className={cn("size-10 bg-brand", opt.radius)} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
