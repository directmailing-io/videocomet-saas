"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Block } from "@/lib/landing-blocks/types";
import { asBool, asString, MediaUrlField } from "./shared";

export function BlockImageForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  return (
    <div className="space-y-4">
      <MediaUrlField
        label="Bild"
        value={asString(data.url)}
        onChange={(url) => onChange({ url })}
        type="image"
      />
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
