"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";
import { asArray, asString, Repeater } from "./shared";

interface FaqItem {
  q?: string;
  a?: string;
}

export function BlockFaqForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const items = asArray<FaqItem>(block.data.items);
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="faq-headline">Headline (optional)</Label>
        <Input
          id="faq-headline"
          value={asString(block.data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="Häufige Fragen"
        />
      </div>
      <div>
        <Label htmlFor="faq-intro">Intro (optional)</Label>
        <Textarea
          id="faq-intro"
          value={asString(block.data.intro)}
          onChange={(e) => onChange({ intro: e.target.value })}
          rows={2}
          placeholder="Kurzer Einstieg über den Fragen."
        />
        <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
          In der zweispaltigen Variante stehen Headline und Intro links
          neben den Fragen.
        </p>
      </div>
      <Repeater<FaqItem>
      label="Fragen & Antworten"
      items={items}
      onChange={(next) => onChange({ items: next })}
      makeEmpty={() => ({ q: "", a: "" })}
      renderItem={(item, update) => (
        <div className="space-y-2">
          <div>
            <Label>Frage</Label>
            <Input
              value={asString(item.q)}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Wie schnell bekomme ich Antwort?"
            />
          </div>
          <div>
            <Label>Antwort</Label>
            <Textarea
              value={asString(item.a)}
              onChange={(e) => update({ a: e.target.value })}
              rows={3}
              placeholder="Innerhalb von 24 Stunden."
            />
          </div>
        </div>
      )}
      />
    </div>
  );
}
