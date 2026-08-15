"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { InspectorFormProps } from "./index";
import { asObject, asString, MediaUrlField } from "./shared";

/**
 * Inspector-Formular für den Content-Block (Grafik + Text).
 * data: { headline, body, image: { url, alt } } — das Layout (Grafik
 * links/rechts, nur Text) steuert der zentrale Varianten-Umschalter.
 */
export function BlockContentForm({ block, onChange }: InspectorFormProps) {
  const data = block.data;
  const image = asObject(data.image);
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
      <MediaUrlField
        label="Bild"
        value={asString(image.url)}
        onChange={(url) => onChange({ image: { ...image, url } })}
        type="image"
      />
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
