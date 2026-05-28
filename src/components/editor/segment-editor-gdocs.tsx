"use client";

import * as React from "react";
import { Info, Image as ImageIcon, MoveVertical, Pause, FastForward } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GDocsSegment, WebCaptureMode } from "@/lib/segments/types";

interface SegmentEditorGDocsProps {
  segment: GDocsSegment;
  onChange: (segment: GDocsSegment) => void;
}

interface CaptureModeOption {
  value: WebCaptureMode;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/** Vier Aufnahme-Modi (identisch zur Website-Editor-Variante). */
const CAPTURE_MODES: CaptureModeOption[] = [
  {
    value: "static-hero",
    title: "Statisches Bild (Hero)",
    description: "Zeigt nur den oberen Bereich des Dokuments, ohne Scrollen.",
    Icon: ImageIcon,
  },
  {
    value: "smooth-scroll",
    title: "Sanftes Scrollen",
    description: "Scrollt gleichmäßig von oben nach unten über die ganze Segment-Dauer.",
    Icon: MoveVertical,
  },
  {
    value: "slow-scroll-pauses",
    title: "Langsam mit Pausen",
    description: "Scrollt langsam mit kurzen Pausen, gut für Lese-Pausen.",
    Icon: Pause,
  },
  {
    value: "quick-scroll",
    title: "Schnelles Scrollen",
    description: "Schnell oben nach unten, danach Standbild.",
    Icon: FastForward,
  },
];

function isValidDocsUrl(url: string): boolean {
  if (!url) return true; // empty allowed (no error yet)
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("docs.google.com");
  } catch {
    return false;
  }
}

export function SegmentEditorGDocs({
  segment,
  onChange,
}: SegmentEditorGDocsProps) {
  const urlValid = isValidDocsUrl(segment.docsUrl);

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`docs-url-${segment.id}`}>Google-Docs-URL</Label>
        <Input
          id={`docs-url-${segment.id}`}
          value={segment.docsUrl}
          onChange={(e) =>
            onChange({ ...segment, docsUrl: e.target.value })
          }
          placeholder="https://docs.google.com/document/d/..."
          error={!urlValid}
        />
        {!urlValid && (
          <p className="mt-1 text-xs text-danger">
            Bitte eine gültige docs.google.com URL angeben.
          </p>
        )}
      </div>

      <div>
        <Label>Aufnahme-Modus</Label>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CAPTURE_MODES.map((opt) => (
            <CaptureModeCard
              key={opt.value}
              option={opt}
              selected={segment.captureMode === opt.value}
              onSelect={() =>
                onChange({ ...segment, captureMode: opt.value })
              }
            />
          ))}
        </div>
      </div>

      <div className="flex gap-3 rounded-squircle-sm border border-brand-200 bg-brand-soft p-4 text-sm text-brand-deep">
        <Info className="size-4 shrink-0 mt-0.5" />
        <p>
          Das Dokument muss öffentlich (mit Link freigegeben) sein, damit es während
          des Renderns geladen werden kann. Die Vorschau hier ist nur ein Platzhalter —
          beim Generieren öffnet der Worker das Doc, schließt Cookie-Banner und nimmt den
          gewählten Scroll-Modus auf.
        </p>
      </div>
    </div>
  );
}

/**
 * Apple/AirBNB-style Auswahl-Karte für einen Capture-Modus.
 * Click setzt onSelect; selected zeigt einen ring-2 ring-brand Marker.
 */
function CaptureModeCard({
  option,
  selected,
  onSelect,
}: {
  option: CaptureModeOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon, title, description } = option;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-start gap-3 rounded-squircle-md border bg-surface p-4 text-left transition",
        "hover:border-brand-200 hover:bg-brand-soft/40",
        selected
          ? "border-brand-200 bg-brand-soft/60 ring-2 ring-brand"
          : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-squircle-sm",
          selected ? "bg-brand text-white" : "bg-surface-soft text-ink",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold leading-tight text-ink">
          {title}
        </span>
        <span className="text-xs leading-snug text-ink-muted">
          {description}
        </span>
      </span>
    </button>
  );
}
