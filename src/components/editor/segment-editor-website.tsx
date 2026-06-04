"use client";

import * as React from "react";
import {
  Info,
  Image as ImageIcon,
  MoveVertical,
  Camera,
  CheckCircle2,
  AlertTriangle,
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
    description: "Du scrollst selbst durch das Dokument, der Worker spielt es 1:1 nach.",
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
        <Label htmlFor={`url-col-${segment.id}`}>CSV-Spalte mit Lead-URL</Label>
        <Input
          id={`url-col-${segment.id}`}
          value={segment.urlColumn}
          onChange={(e) =>
            onChange({ ...segment, urlColumn: e.target.value })
          }
          placeholder="website"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Name der Spalte mit der Website des jeweiligen Leads.
          Jedes Lead-Video zeigt seine eigene Website, dein Scroll-Verhalten
          wird 1:1 darauf abgespielt.
        </p>
      </div>

      <div>
        <Label htmlFor={`fallback-${segment.id}`}>Vorschau-URL (Fallback)</Label>
        <Input
          id={`fallback-${segment.id}`}
          value={segment.fallbackUrl}
          onChange={(e) =>
            onChange({ ...segment, fallbackUrl: e.target.value })
          }
          placeholder="https://www.beispiel.de"
        />
        <p className="mt-1 text-xs text-ink-muted">
          Über diese URL nimmst du deine Scroll-Bewegung auf. Wird auch als
          Fallback verwendet, wenn ein Lead in der CSV-Spalte keinen Wert hat.
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

      {segment.captureMode === "scroll-recorded" && (
        <div className="rounded-squircle-md border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-squircle-sm",
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
              <div>
                <p className="text-sm font-semibold text-ink">
                  Scroll-Aufnahme
                </p>
                <p className="text-xs text-ink-muted">
                  {hasFrames
                    ? `${frames.length} Frames, ${formatMs(lastT)} aufgezeichnet.`
                    : "Noch keine Aufnahme."}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant={hasFrames ? "subtle" : "brand"}
              size="sm"
              onClick={() => setRecorderOpen(true)}
              disabled={!previewUrlValid}
              iconLeft={<Camera className="size-3.5" />}
            >
              {hasFrames ? "Erneut aufzeichnen" : "Aufnahme aufzeichnen"}
            </Button>
          </div>
          {!previewUrlValid && (
            <div className="mt-3 flex gap-2 rounded-squircle-sm bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span>
                Bitte zuerst eine gültige Fallback-URL eintragen, damit eine
                Vorschau geladen werden kann.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 rounded-squircle-sm border border-brand-200 bg-brand-soft p-4 text-sm text-brand-deep">
        <Info className="size-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Personalisierte Aufnahme pro Lead</p>
          <p>
            Die Vorschau-URL nutzt du nur zum Aufzeichnen deiner Scroll-
            Bewegung. Beim Generieren öffnet der Worker die jeweilige
            Website jedes Leads (aus der CSV-Spalte) und spielt deine
            Bewegung exakt darüber ab — so bekommt Max sein max.de, Anna
            ihr anna.de mit identischem Scroll-Pattern.
          </p>
        </div>
      </div>

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
