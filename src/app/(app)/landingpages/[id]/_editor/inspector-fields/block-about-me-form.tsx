"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";

import { asString, MediaUrlField } from "./shared";

export function BlockAboutMeForm({
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
        label="Portraitfoto"
        value={asString(data.portraitUrl)}
        onChange={(url) => onChange({ portraitUrl: url })}
        type="image"
      />
      <div>
        <Label htmlFor="about-name">Name</Label>
        <Input
          id="about-name"
          value={asString(data.name)}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Max Mustermann"
        />
      </div>
      <div>
        <Label htmlFor="about-role">Rolle / Funktion</Label>
        <Input
          id="about-role"
          value={asString(data.role)}
          onChange={(e) => onChange({ role: e.target.value })}
          placeholder="Geschäftsführer · Mustermann GmbH"
        />
      </div>
      <div>
        <Label htmlFor="about-bio">Kurzbio</Label>
        <Textarea
          id="about-bio"
          value={asString(data.bio)}
          onChange={(e) => onChange({ bio: e.target.value })}
          rows={4}
          placeholder="Erzählen Sie in 2–3 Sätzen, wer Sie sind."
        />
      </div>
    </div>
  );
}
