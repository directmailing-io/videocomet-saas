"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";
import { asObject, asString } from "./shared";

export function BlockCtaBannerForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  const primary = asObject(data.primaryButton);
  const secondary = asObject(data.secondaryButton);
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cta-head">Headline</Label>
        <Input
          id="cta-head"
          value={asString(data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Bereit für den nächsten Schritt?"
        />
      </div>
      <div>
        <Label htmlFor="cta-sub">Subheadline (optional)</Label>
        <Textarea
          id="cta-sub"
          value={asString(data.subheadline)}
          onChange={(e) => onChange({ subheadline: e.target.value })}
          rows={2}
          placeholder="Eine kurze Einladung in 1 Satz."
        />
      </div>
      <ButtonFieldset
        title="Primärer Button"
        label={asString(primary.label)}
        url={asString(primary.url)}
        onChange={(label, url) =>
          onChange({ primaryButton: { label, url } })
        }
      />
      <ButtonFieldset
        title="Sekundärer Button (optional)"
        label={asString(secondary.label)}
        url={asString(secondary.url)}
        onChange={(label, url) =>
          onChange({ secondaryButton: { label, url } })
        }
      />
    </div>
  );
}

function ButtonFieldset({
  title,
  label,
  url,
  onChange,
}: {
  title: string;
  label: string;
  url: string;
  onChange: (label: string, url: string) => void;
}) {
  return (
    <fieldset className="rounded-squircle-sm border border-line p-3 space-y-2">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </legend>
      <div>
        <Label>Beschriftung</Label>
        <Input
          value={label}
          onChange={(e) => onChange(e.target.value, url)}
          placeholder="Termin buchen"
        />
      </div>
      <div>
        <Label>Link</Label>
        <Input
          value={url}
          onChange={(e) => onChange(label, e.target.value)}
          placeholder="https://calendly.com/…"
        />
      </div>
    </fieldset>
  );
}
