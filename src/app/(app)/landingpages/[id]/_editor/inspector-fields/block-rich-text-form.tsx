"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Block } from "@/lib/landing-blocks/types";
import { asString } from "./shared";

/**
 * Lightweight markdown editor — full Tiptap kommt in einer spaeteren
 * Iteration. Aktuell: Textarea + Hinweise auf die unterstützte Syntax.
 */
export function BlockRichTextForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const alignment = block.data.alignment === "center" ? "center" : "left";
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="rich-headline">Überschrift (optional)</Label>
        <Input
          id="rich-headline"
          value={asString(block.data.headline)}
          onChange={(e) => onChange({ headline: e.target.value })}
          placeholder="z. B. Darum lohnt sich das für dich"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rich-md">Text</Label>
        <Textarea
          id="rich-md"
          value={asString(block.data.markdown)}
          onChange={(e) => onChange({ markdown: e.target.value })}
          rows={8}
          placeholder="Erzählen Sie hier, was wichtig ist…"
          className="font-mono text-sm"
        />
        <p className="text-[11px] text-ink-muted leading-relaxed">
          Unterstützt: <code>**fett**</code>, <code>*kursiv*</code>,{" "}
          <code>[Link](https://…)</code>,{" "}
          <code>[color=red]Farbe[/color]</code>. Platzhalter wie{" "}
          <code>{"{{firstName}}"}</code> werden pro Empfänger ersetzt.
        </p>
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
                (alignment === a
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink")
              }
            >
              {a === "left" ? "Links" : "Mitte"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
