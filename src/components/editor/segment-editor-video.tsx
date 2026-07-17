"use client";

import * as React from "react";
import { Check, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CropRatio, VideoSegment } from "@/lib/segments/types";
import { AdvancedSettings } from "./advanced-settings";

interface MediaItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

interface SegmentEditorVideoProps {
  segment: VideoSegment;
  onChange: (segment: VideoSegment) => void;
  mediaItems: MediaItem[];
}

const CROP_RATIOS: CropRatio[] = ["16:9", "4:3", "1:1", "9:16"];

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0,000";
  return seconds.toFixed(3).replace(".", ",");
}

function parseSeconds(input: string): number | null {
  const normalized = input.replace(",", ".").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function SegmentEditorVideo({
  segment,
  onChange,
  mediaItems,
}: SegmentEditorVideoProps) {
  const videoItems = React.useMemo(
    () => mediaItems.filter((m) => m.type === "video"),
    [mediaItems],
  );

  const selectMedia = (item: MediaItem) => {
    onChange({
      ...segment,
      mediaId: item.id,
      publicUrl: item.publicUrl,
    });
  };

  const onLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      const dur = v.duration;
      if (segment.originalDurationSec !== dur) {
        onChange({ ...segment, originalDurationSec: dur });
      }
    }
  };

  const trimStartSec = segment.trimStartMs / 1000;
  const trimEndSec = segment.trimEndMs === null ? null : segment.trimEndMs / 1000;

  const [trimStartDraft, setTrimStartDraft] = React.useState(
    formatSeconds(trimStartSec),
  );
  const [trimEndDraft, setTrimEndDraft] = React.useState(
    trimEndSec === null ? "" : formatSeconds(trimEndSec),
  );

  React.useEffect(() => {
    setTrimStartDraft(formatSeconds(segment.trimStartMs / 1000));
  }, [segment.trimStartMs]);

  React.useEffect(() => {
    setTrimEndDraft(
      segment.trimEndMs === null ? "" : formatSeconds(segment.trimEndMs / 1000),
    );
  }, [segment.trimEndMs]);

  const commitTrimStart = () => {
    const parsed = parseSeconds(trimStartDraft);
    if (parsed === null) {
      setTrimStartDraft(formatSeconds(segment.trimStartMs / 1000));
      return;
    }
    onChange({ ...segment, trimStartMs: Math.round(parsed * 1000) });
  };

  const commitTrimEnd = () => {
    if (trimEndDraft.trim() === "") {
      onChange({ ...segment, trimEndMs: null });
      return;
    }
    const parsed = parseSeconds(trimEndDraft);
    if (parsed === null) {
      setTrimEndDraft(
        segment.trimEndMs === null ? "" : formatSeconds(segment.trimEndMs / 1000),
      );
      return;
    }
    onChange({ ...segment, trimEndMs: Math.round(parsed * 1000) });
  };

  return (
    <div className="space-y-5">
      <div>
        <Label>Video aus der Mediathek</Label>
        {videoItems.length === 0 ? (
          <div className="rounded-squircle-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            <VideoIcon className="mx-auto mb-2 size-6 opacity-50" />
            Noch keine Videos hochgeladen.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {videoItems.map((item) => {
              const selected = segment.mediaId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMedia(item)}
                  className={cn(
                    "group relative aspect-video overflow-hidden rounded-squircle-sm border-2 bg-surface-muted transition-all",
                    selected
                      ? "border-brand shadow-brand"
                      : "border-line hover:border-brand-300",
                  )}
                  aria-pressed={selected}
                  aria-label={`Video ${item.name} auswählen`}
                >
                  <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
                    <VideoIcon className="size-6 text-ink-muted" />
                    <span className="line-clamp-2 text-xs text-ink-soft">{item.name}</span>
                  </div>
                  {selected && (
                    <div className="absolute right-2 top-2 rounded-full bg-brand p-1 text-white shadow-brand">
                      <Check className="size-3" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {segment.publicUrl && (
        <div>
          <Label>Vorschau</Label>
          <video
            key={segment.publicUrl}
            src={segment.publicUrl}
            controls
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            className="w-full max-h-72 rounded-squircle-sm border border-line bg-black"
          />
          {segment.originalDurationSec !== null && (
            <p className="mt-2 text-xs text-ink-muted">
              Original-Dauer: <span className="font-mono">{formatSeconds(segment.originalDurationSec)}s</span>
            </p>
          )}
        </div>
      )}

      <AdvancedSettings hint="Zuschneiden, Seitenverhältnis, Browser-Rahmen">
        <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`trim-start-${segment.id}`}>Video-Start (Sek.)</Label>
          <Input
            id={`trim-start-${segment.id}`}
            inputMode="decimal"
            value={trimStartDraft}
            onChange={(e) => setTrimStartDraft(e.target.value)}
            onBlur={commitTrimStart}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="0,000"
          />
        </div>
        <div>
          <Label htmlFor={`trim-end-${segment.id}`}>Video-Ende (Sek.)</Label>
          <Input
            id={`trim-end-${segment.id}`}
            inputMode="decimal"
            value={trimEndDraft}
            onChange={(e) => setTrimEndDraft(e.target.value)}
            onBlur={commitTrimEnd}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="bis Ende"
          />
        </div>
      </div>

      <div>
        <Label>Seitenverhältnis</Label>
        <Select
          value={segment.cropRatio}
          onValueChange={(v) =>
            onChange({ ...segment, cropRatio: v as CropRatio })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CROP_RATIOS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-squircle-sm border border-line bg-surface-soft p-4">
        <div className="flex items-center justify-between">
          <Label className="mb-0">Browser-Tab-Rahmen anzeigen</Label>
          <Switch
            checked={segment.showAsBrowserFrame}
            onCheckedChange={(checked) =>
              onChange({ ...segment, showAsBrowserFrame: checked })
            }
            aria-label="Browser-Rahmen umschalten"
          />
        </div>
        {segment.showAsBrowserFrame && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`tab-name-${segment.id}`}>Tab-Name</Label>
              <Input
                id={`tab-name-${segment.id}`}
                value={segment.browserTabName}
                onChange={(e) =>
                  onChange({ ...segment, browserTabName: e.target.value })
                }
                placeholder="Mein Tab"
              />
            </div>
            <div>
              <Label htmlFor={`tab-url-${segment.id}`}>Tab-URL</Label>
              <Input
                id={`tab-url-${segment.id}`}
                value={segment.browserTabUrl}
                onChange={(e) =>
                  onChange({ ...segment, browserTabUrl: e.target.value })
                }
                placeholder="https://beispiel.de"
              />
            </div>
          </div>
        )}
      </div>
        </div>
      </AdvancedSettings>
    </div>
  );
}
