"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Block } from "@/lib/landing-blocks/types";
import { cn } from "@/lib/utils";
import { asBool, asString, MediaUrlField, VideoUrlField } from "./shared";

export function BlockImageForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  const [mode, setMode] = React.useState<"image" | "video">(
    asString(data.videoUrl).trim() ? "video" : "image",
  );
  return (
    <div className="space-y-4">
      <div>
        <Label>Art</Label>
        <div className="flex gap-2 mt-1.5">
          {(
            [
              { id: "image", label: "Bild" },
              { id: "video", label: "Video" },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                setMode(k.id);
                // Zurück zu "Bild" leert die Video-URL, sonst gewinnt das
                // Video weiter gegen das Bild.
                if (k.id === "image") onChange({ videoUrl: "" });
              }}
              className={cn(
                "flex-1 px-3 py-1.5 text-xs font-semibold rounded-squircle-sm border transition-colors",
                mode === k.id
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {mode === "video" ? (
        <VideoUrlField
          label="Video-Link"
          value={asString(data.videoUrl)}
          onChange={(videoUrl) => onChange({ videoUrl })}
        />
      ) : (
        <MediaUrlField
          label="Bild"
          value={asString(data.url)}
          onChange={(url) => onChange({ url })}
          type="image"
        />
      )}
      <div>
        <Label htmlFor="img-alt">Alt-Text</Label>
        <Input
          id="img-alt"
          value={asString(data.alt)}
          onChange={(e) => onChange({ alt: e.target.value })}
          placeholder="Bildbeschreibung für Screenreader"
        />
      </div>
      <div>
        <Label htmlFor="img-caption">Bildunterschrift (optional)</Label>
        <Input
          id="img-caption"
          value={asString(data.caption)}
          onChange={(e) => onChange({ caption: e.target.value })}
          placeholder="z.B. Screenshot aus der App"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="img-full" className="mb-0">
          Vollbreite (ohne Rand)
        </Label>
        <Switch
          id="img-full"
          checked={asBool(data.fullWidth, false)}
          onCheckedChange={(c) => onChange({ fullWidth: c })}
        />
      </div>
    </div>
  );
}
