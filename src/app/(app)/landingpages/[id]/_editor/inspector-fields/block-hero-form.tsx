"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";

import {
  asBool,
  asString,
  PlaceholderHint,
} from "./shared";

export function BlockHeroForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const data = block.data;
  const headlineRef = React.useRef<HTMLInputElement | null>(null);

  function insertToken(token: string) {
    const el = headlineRef.current;
    const current = asString(data.headline);
    if (!el) {
      onChange({ headline: current + token });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onChange({ headline: next });
    requestAnimationFrame(() => {
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="hero-badge">Begrüßungs-Badge (optional)</Label>
        <Input
          id="hero-badge"
          value={asString(data.badge)}
          onChange={(e) => onChange({ badge: e.target.value })}
          placeholder="z. B. Persönlich für {{vorname}}"
        />
      </div>
      <div>
        <Label htmlFor="hero-headline">Headline</Label>
        <Input
          id="hero-headline"
          ref={headlineRef}
          value={asString(data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Hallo {{firstName}}, …"
        />
        <PlaceholderHint onPick={insertToken} />
      </div>
      <div>
        <Label htmlFor="hero-sub">Subheadline</Label>
        <Textarea
          id="hero-sub"
          value={asString(data.subheadline)}
          onChange={(e) => onChange({ subheadline: e.target.value })}
          placeholder="Kurze Einleitung in 1–2 Sätzen."
          rows={2}
        />
      </div>
      <div>
        <Label>Ausrichtung</Label>
        <div className="flex gap-2 mt-1.5">
          {(["left", "center"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ alignment: a })}
              className={
                "flex-1 px-3 py-1.5 text-xs font-medium rounded-squircle-sm border transition-colors " +
                (data.alignment === a
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink")
              }
            >
              {a === "left" ? "Links" : "Mitte"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="hero-video" className="mb-0">
          Video anzeigen
        </Label>
        <Switch
          id="hero-video"
          checked={asBool(data.showVideo, true)}
          onCheckedChange={(c) => onChange({ showVideo: c })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="hero-show-cta" className="mb-0">
          CTA anzeigen
        </Label>
        <Switch
          id="hero-show-cta"
          checked={asBool(data.showCta, true)}
          onCheckedChange={(c) => onChange({ showCta: c })}
        />
      </div>
      {asBool(data.showCta, true) && (
        <>
          <div>
            <Label htmlFor="hero-cta-label">CTA-Text</Label>
            <Input
              id="hero-cta-label"
              value={asString(data.ctaLabel)}
              onChange={(e) => onChange({ ctaLabel: e.target.value })}
              placeholder="Termin buchen"
            />
          </div>
          <div>
            <Label htmlFor="hero-cta-url">CTA-Link</Label>
            <Input
              id="hero-cta-url"
              value={asString(data.ctaUrl)}
              onChange={(e) => onChange({ ctaUrl: e.target.value })}
              placeholder="https://calendly.com/dein-name"
            />
          </div>
        </>
      )}
    </div>
  );
}
