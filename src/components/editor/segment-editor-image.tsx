"use client";

import * as React from "react";
import { ImageIcon, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { ImageSegment } from "@/lib/segments/types";

interface MediaItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

interface SegmentEditorImageProps {
  segment: ImageSegment;
  onChange: (segment: ImageSegment) => void;
  mediaItems: MediaItem[];
}

export function SegmentEditorImage({
  segment,
  onChange,
  mediaItems,
}: SegmentEditorImageProps) {
  const imageItems = React.useMemo(
    () => mediaItems.filter((m) => m.type === "image"),
    [mediaItems],
  );

  const selectMedia = (item: MediaItem) => {
    onChange({
      ...segment,
      mediaId: item.id,
      publicUrl: item.publicUrl,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <Label>Bild aus der Mediathek</Label>
        {imageItems.length === 0 ? (
          <div className="rounded-squircle-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            <ImageIcon className="mx-auto mb-2 size-6 opacity-50" />
            Noch keine Bilder hochgeladen. Bilder können in der Mediathek hinzugefügt werden.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {imageItems.map((item) => {
              const selected = segment.mediaId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMedia(item)}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-squircle-sm border-2 transition-all",
                    selected
                      ? "border-brand shadow-brand"
                      : "border-line hover:border-brand-300",
                  )}
                  aria-pressed={selected}
                  aria-label={`Bild ${item.name} auswählen`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.publicUrl}
                    alt={item.name}
                    className="size-full object-cover"
                  />
                  {selected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-brand/20">
                      <span className="rounded-full bg-brand p-1.5 text-white shadow-brand">
                        <Check className="size-3.5" />
                      </span>
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
          <div className="overflow-hidden rounded-squircle-sm border border-line bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={segment.publicUrl}
              alt="Auswahl"
              className="mx-auto max-h-48 object-contain"
            />
          </div>
        </div>
      )}

      <div>
        <Label>Anzeige-Modus</Label>
        <div className="inline-flex rounded-full border border-line bg-surface p-1">
          {(
            [
              { value: "fullscreen" as const, label: "Vollbild" },
              { value: "slide" as const, label: "Slide" },
            ]
          ).map(({ value, label }) => {
            const active = segment.displayMode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...segment, displayMode: value })}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                  active ? "bg-brand text-white" : "text-ink-muted hover:bg-surface-muted",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {segment.displayMode === "slide" && (
        <div className="space-y-4 rounded-squircle-sm border border-line bg-surface-soft p-4">
          <div className="grid grid-cols-2 gap-4">
            <SliderField
              label="Position X"
              value={segment.posXPct}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onChange({ ...segment, posXPct: v })}
            />
            <SliderField
              label="Position Y"
              value={segment.posYPct}
              min={0}
              max={100}
              unit="%"
              onChange={(v) => onChange({ ...segment, posYPct: v })}
            />
            <SliderField
              label="Breite"
              value={segment.widthPct}
              min={5}
              max={100}
              unit="%"
              onChange={(v) => onChange({ ...segment, widthPct: v })}
            />
            <SliderField
              label="Hoehe"
              value={segment.heightPct}
              min={5}
              max={100}
              unit="%"
              onChange={(v) => onChange({ ...segment, heightPct: v })}
            />
          </div>
          <div>
            <Label>Slide-Hintergrund</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={segment.bgColor}
                onChange={(e) =>
                  onChange({ ...segment, bgColor: e.target.value })
                }
                className="h-10 w-12 cursor-pointer rounded-squircle-sm border border-line bg-surface"
                aria-label="Slide-Hintergrundfarbe"
              />
              <span className="font-mono text-sm text-ink-soft">{segment.bgColor}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label>
        {label}: <span className="text-ink font-mono normal-case">{value}{unit}</span>
      </Label>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-brand"
      />
    </div>
  );
}
