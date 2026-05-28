"use client";

import * as React from "react";
import { Info, Image as ImageIcon, MoveVertical, Pause, FastForward } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WebCaptureMode, WebsiteSegment } from "@/lib/segments/types";

interface SegmentEditorWebsiteProps {
  segment: WebsiteSegment;
  onChange: (segment: WebsiteSegment) => void;
}

interface CaptureModeOption {
  value: WebCaptureMode;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/** Vier Aufnahme-Modi mit knapper, deutscher Microcopy. */
const CAPTURE_MODES: CaptureModeOption[] = [
  {
    value: "static-hero",
    title: "Statisches Bild (Hero)",
    description: "Zeigt nur den oberen Bereich der Webseite, ohne Scrollen.",
    Icon: ImageIcon,
  },
  {
    value: "smooth-scroll",
    title: "Sanftes Scrollen",
    description: "Scrollt gleichmaessig von oben nach unten ueber die ganze Segment-Dauer.",
    Icon: MoveVertical,
  },
  {
    value: "slow-scroll-pauses",
    title: "Langsam mit Pausen",
    description: "Scrollt langsam mit kurzen Pausen, gut fuer Lese-Pausen.",
    Icon: Pause,
  },
  {
    value: "quick-scroll",
    title: "Schnelles Scrollen",
    description: "Schnell oben nach unten, danach Standbild.",
    Icon: FastForward,
  },
];

export function SegmentEditorWebsite({
  segment,
  onChange,
}: SegmentEditorWebsiteProps) {
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`url-col-${segment.id}`}>CSV-Spalte mit URL</Label>
        <Input
          id={`url-col-${segment.id}`}
          value={segment.urlColumn}
          onChange={(e) =>
            onChange({ ...segment, urlColumn: e.target.value })
          }
          placeholder="website"
        />
      </div>

      <div>
        <Label htmlFor={`fallback-${segment.id}`}>Fallback-URL</Label>
        <Input
          id={`fallback-${segment.id}`}
          value={segment.fallbackUrl}
          onChange={(e) =>
            onChange({ ...segment, fallbackUrl: e.target.value })
          }
          placeholder="https://www.beispiel.de"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Wird in der Vorschau und fuer Leads ohne Wert verwendet.
        </p>
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
          Beim Generieren wird die echte URL des Leads aufgenommen. Die Fallback-URL
          erscheint nur in der Vorschau bzw. wenn die Spalte leer ist.
        </p>
      </div>
    </div>
  );
}

/**
 * Apple/AirBNB-style Auswahl-Karte fuer einen Capture-Modus.
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
