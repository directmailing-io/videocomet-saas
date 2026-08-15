"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { cn } from "@/lib/utils";

import type { InspectorFormProps } from "./index";
import { asObject, asString, MediaUrlField, VideoUrlField } from "./shared";

/**
 * Inspector-Formular für den Content-Block (Grafik + Text).
 * data: { headline, body, image: { url, alt }, videoUrl? } — das Layout
 * (Grafik links/rechts) steuert der zentrale Varianten-Umschalter. Ein
 * gültiger videoUrl gewinnt beim Rendern gegen das Bild.
 */
export function BlockContentForm({ block, onChange }: InspectorFormProps) {
  const data = block.data;
  const image = asObject(data.image);
  const [mode, setMode] = React.useState<"image" | "video">(
    asString(data.videoUrl).trim() ? "video" : "image",
  );
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="content-headline">Headline</Label>
        <Input
          id="content-headline"
          value={asString(data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Worum geht es hier?"
        />
      </div>
      <div>
        <Label htmlFor="content-body">Text</Label>
        <Textarea
          id="content-body"
          value={asString(data.body)}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={5}
          placeholder={"Dein Text.\n- Erster Vorteil\n- Zweiter Vorteil"}
        />
        <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
          Aufzählungen mit - bekommen Häkchen.
        </p>
      </div>
      <div>
        <Label>Medium</Label>
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
          value={asString(image.url)}
          onChange={(url) => onChange({ image: { ...image, url } })}
          type="image"
        />
      )}
      <div>
        <Label htmlFor="content-alt">Alt-Text</Label>
        <Input
          id="content-alt"
          value={asString(image.alt)}
          onChange={(e) => onChange({ image: { ...image, alt: e.target.value } })}
          placeholder="Bildbeschreibung für Screenreader"
        />
      </div>
    </div>
  );
}
