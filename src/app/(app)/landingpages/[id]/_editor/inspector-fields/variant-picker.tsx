"use client";

/**
 * Zentraler Layout-Umschalter für Blöcke mit Eintrag in BLOCK_VARIANTS
 * (Konzept 5: „Variante wechseln = 1 Klick, Inhalte bleiben erhalten").
 *
 * Wird im Inspector GANZ OBEN über dem typ-spezifischen Formular
 * gerendert (siehe lp-editor.tsx). Ein Klick patcht nur `block.variant`
 * — `data` bleibt unangetastet, Undo/Auto-Save laufen über den
 * bestehenden State-Mechanismus (updateBlock).
 */

import * as React from "react";

import { Label } from "@/components/ui/label";
import {
  BLOCK_VARIANTS,
  resolveVariant,
  type Block,
} from "@/lib/landing-blocks/types";
import { cn } from "@/lib/utils";

type VariantBlockType = keyof typeof BLOCK_VARIANTS;

/** Deutsche Labels pro Blocktyp + Variante (Reihenfolge wie im Katalog). */
const VARIANT_LABELS: Record<VariantBlockType, Record<string, string>> = {
  hero: {
    centered: "Zentriert",
    split: "Geteilt",
    "split-reverse": "Geteilt (gespiegelt)",
  },
  testimonials: {
    grid: "Karten-Raster",
    spotlight: "Einzeln groß",
    list: "Kompakte Liste",
  },
  faq: {
    accordion: "Akkordeon",
    "two-column": "Zweispaltig",
    "open-list": "Offene Liste",
  },
  content: {
    "media-left": "Grafik links",
    "media-right": "Grafik rechts",
    "text-only": "Nur Text",
  },
  "cta-banner": {
    button: "Button",
    "calendar-inline": "Kalender inline",
    "calendar-popup": "Kalender-Popup",
    form: "Formular",
  },
  "case-study": {
    "media-left": "Medium links",
    "media-right": "Medium rechts",
    "media-top": "Medium oben",
  },
};

export function hasVariants(type: Block["type"]): type is VariantBlockType {
  return type in BLOCK_VARIANTS;
}

/**
 * Segment-Auswahl „Layout". Rendert nichts, wenn der Blocktyp keine
 * Varianten kennt.
 */
export function VariantPicker({
  block,
  onSelect,
}: {
  block: Block;
  onSelect: (variant: string) => void;
}) {
  if (!hasVariants(block.type)) return null;
  const type = block.type;
  const variants = BLOCK_VARIANTS[type] as readonly string[];
  const active = resolveVariant(type, block.variant);
  const labels = VARIANT_LABELS[type];
  return (
    <div className="mb-4">
      <Label>Layout</Label>
      <div className="flex flex-wrap gap-1.5 mt-1.5" role="group" aria-label="Layout wählen">
        {variants.map((v) => {
          const isActive = v === active;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                if (!isActive) onSelect(v);
              }}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-squircle-sm border transition-colors",
                isActive
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {labels[v] ?? v}
            </button>
          );
        })}
      </div>
    </div>
  );
}
