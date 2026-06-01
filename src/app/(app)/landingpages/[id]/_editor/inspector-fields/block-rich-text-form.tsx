"use client";

import * as React from "react";
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
  return (
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
  );
}
