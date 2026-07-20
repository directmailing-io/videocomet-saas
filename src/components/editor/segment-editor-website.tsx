"use client";

import * as React from "react";
import {
  Info,
  Image as ImageIcon,
  MoveVertical,
  Camera,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  WebCaptureMode,
  WebsiteSegment,
  ScrollFrame,
  Segment,
} from "@/lib/segments/types";
import { ScrollRecorderModal } from "./scroll-recorder-modal";

interface SegmentEditorWebsiteProps {
  segment: WebsiteSegment;
  onChange: (segment: WebsiteSegment) => void;
  /** Bunny-CDN-URL des Webcam-Videos (für PiP-Sync im Scroll-Recorder). */
  webcamUrl?: string | null;
  /** Alle Segmente — für Index-Berechnung im Webcam-Monitor. */
  allSegments?: Segment[];
  /** Index dieses Segments innerhalb von `allSegments`. */
  currentSegmentIndex?: number | null;
}

interface CaptureModeOption {
  value: WebCaptureMode;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const CAPTURE_MODES: CaptureModeOption[] = [
  {
    value: "static-hero",
    title: "Statisches Bild",
    description: "Zeigt nur den oberen Bereich der Webseite, ohne Scrollen.",
    Icon: ImageIcon,
  },
  {
    value: "scroll-recorded",
    title: "Scroll-Aufnahme",
    description: "Du scrollst einmal selbst, das Video spielt es 1:1 nach.",
    Icon: MoveVertical,
  },
];

function isValidUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 100) / 10);
  return `${s.toFixed(1)}s`;
}

export function SegmentEditorWebsite({
  segment,
  onChange,
  webcamUrl,
  allSegments,
  currentSegmentIndex,
}: SegmentEditorWebsiteProps) {
  const [recorderOpen, setRecorderOpen] = React.useState(false);
  const previewUrl = segment.fallbackUrl.trim();
  const previewUrlValid = isValidUrl(previewUrl);
  const frames = segment.scrollFrames ?? [];
  const hasFrames = frames.length > 0;
  const lastT = hasFrames ? frames[frames.length - 1].t : 0;

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`fallback-${segment.id}`}>Vorschau-URL</Label>
        <Input
          id={`fallback-${segment.id}`}
          value={segment.fallbackUrl}
          onChange={(e) =>
            onChange({ ...segment, fallbackUrl: e.target.value })
          }
          placeholder="https://www.beispiel.de"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Mit dieser Seite nimmst du auf und testest die Vorschau.
        </p>
      </div>

      <div>
        <Label>Aufnahme-Modus</Label>
        <div className="mt-2 grid grid-cols-1 gap-2">
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

      {segment.captureMode === "scroll-recorded" && (
        <div className="rounded-squircle-md border border-line bg-surface p-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-squircle-sm",
                hasFrames
                  ? "bg-brand-soft text-brand-deep"
                  : "bg-surface-soft text-ink-muted",
              )}
            >
              {hasFrames ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Camera className="size-4" />
              )}
            </span>
            <p className="min-w-0 flex-1 text-xs text-ink-muted">
              {hasFrames
                ? `${frames.length} Frames, ${formatMs(lastT)} aufgezeichnet.`
                : "Noch keine Aufnahme."}
            </p>
          </div>
          <Button
            type="button"
            variant={hasFrames ? "subtle" : "brand"}
            size="sm"
            onClick={() => setRecorderOpen(true)}
            disabled={!previewUrlValid}
            iconLeft={<Camera className="size-3.5" />}
            className="mt-2.5 w-full"
          >
            {hasFrames ? "Erneut aufzeichnen" : "Aufnahme aufzeichnen"}
          </Button>
          {!previewUrlValid && (
            <div className="mt-2.5 flex gap-2 rounded-squircle-sm bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span>
                Bitte zuerst eine gültige URL eintragen, damit die Vorschau
                geladen werden kann.
              </span>
            </div>
          )}
        </div>
      )}

      <PersonalizationHint />

      {recorderOpen && (
        <ScrollRecorderModal
          open={recorderOpen}
          onClose={() => setRecorderOpen(false)}
          targetUrl={previewUrl}
          segmentDurationMs={segment.durationMs}
          initialFrames={segment.scrollFrames}
          onSave={(scrollFrames: ScrollFrame[]) =>
            onChange({ ...segment, scrollFrames })
          }
          webcamUrl={webcamUrl ?? null}
          allSegments={allSegments ?? null}
          currentSegmentIndex={currentSegmentIndex ?? null}
        />
      )}
    </div>
  );
}

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
        "group flex w-full items-center gap-3 rounded-squircle-md border bg-surface p-3 text-left transition",
        "hover:border-brand-200 hover:bg-brand-soft/40",
        selected
          ? "border-brand-200 bg-brand-soft/60 ring-2 ring-brand"
          : "border-line",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-squircle-sm",
          selected ? "bg-brand text-white" : "bg-surface-soft text-ink",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
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

/**
 * Aufklappbarer Hinweis zur Personalisierung — standardmäßig zu, damit das
 * schmale Panel nicht von Erklärtext dominiert wird.
 */
function PersonalizationHint() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="overflow-hidden rounded-squircle-sm border border-brand-200 bg-brand-soft/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-brand-deep transition-colors hover:bg-brand-soft"
      >
        <Info className="size-3.5 shrink-0" />
        <span className="flex-1">Jeder Lead sieht seine eigene Website</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <p className="border-t border-brand-200/60 px-3 py-2.5 text-xs leading-relaxed text-brand-deep">
          Beim Generieren öffnen wir automatisch die Website jedes einzelnen
          Leads und spielen deine Aufnahme exakt darüber ab — Max sieht
          max.de, Anna sieht anna.de. Welche Spalte deiner Leadliste die
          Website enthält, legst du später im Mapping-Schritt fest.
        </p>
      )}
    </div>
  );
}
