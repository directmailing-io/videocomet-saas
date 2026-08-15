"use client";

/**
 * Zentraler Layout-Umschalter für Blöcke mit Eintrag in BLOCK_VARIANTS
 * (Konzept 5: „Variante wechseln = 1 Klick, Inhalte bleiben erhalten").
 *
 * v3 (Konzept 6.1): Varianten sind visuelle Miniaturen statt Text-Pills.
 * Jede Variante wird als kleine Karte mit einer schematischen Skizze
 * (reine CSS-Divs, neutrale Grautöne + Brand-Akzent) dargestellt.
 * Ein Klick patcht nur `block.variant` — `data` bleibt unangetastet,
 * Undo/Auto-Save laufen über den bestehenden State-Mechanismus.
 */

import * as React from "react";

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

/* ------------------------------------------------------------------ */
/* Skizzen-Bausteine (neutrale Grautöne + Brand-Akzent)                */
/* ------------------------------------------------------------------ */

/** Textzeile in der Skizze. */
function SkBar({
  w = "w-full",
  strong = false,
  accent = false,
}: {
  w?: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-full",
        strong ? "h-1.5" : "h-1",
        accent ? "bg-brand" : strong ? "bg-ink/30" : "bg-ink/15",
        w,
      )}
    />
  );
}

/** Medien-/Video-Rechteck. */
function SkRect({ className }: { className?: string }) {
  return <div className={cn("rounded-[3px] bg-ink/20", className)} />;
}

/** CTA-Pill im Akzentton. */
function SkPill({ className }: { className?: string }) {
  return <div className={cn("h-2 w-7 rounded-full bg-brand", className)} />;
}

/** Kleine weiße Karte (Testimonial etc.). */
function SkCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[4px] bg-white border border-ink/10 p-1 flex flex-col gap-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Zeile mit optionalem „+" (FAQ-Akkordeon). */
function SkRow({ plus = false }: { plus?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-1 rounded-[3px] bg-white border border-ink/10 px-1 py-0.5">
      <div className="h-1 flex-1 rounded-full bg-ink/20" />
      {plus && (
        <span className="text-[7px] leading-none font-bold text-ink/40">+</span>
      )}
    </div>
  );
}

/** Mini-Kalendergitter. */
function SkCalendarGrid({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[3px] bg-white border border-ink/10 p-1",
        className,
      )}
    >
      <div className="grid grid-cols-4 gap-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 rounded-[1px]",
              i === 5 ? "bg-brand" : "bg-ink/15",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Text-Spalte (Balken untereinander) für Split-Layouts. */
function SkTextCol({ withPill = false }: { withPill?: boolean }) {
  return (
    <div className="flex-1 flex flex-col gap-1 min-w-0">
      <SkBar strong w="w-full" />
      <SkBar w="w-3/4" />
      {withPill && <SkPill className="mt-0.5" />}
    </div>
  );
}

/**
 * Schematische Skizze pro Blocktyp + Variante. Bewusst grob: Es geht um
 * Wiedererkennbarkeit des Layouts, nicht um Pixel-Treue.
 */
function VariantSketch({
  type,
  variant,
}: {
  type: VariantBlockType;
  variant: string;
}) {
  if (type === "hero") {
    if (variant === "centered") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2">
          <SkBar strong w="w-10" />
          <SkBar w="w-7" />
          <SkRect className="mt-0.5 h-5 w-12" />
        </div>
      );
    }
    return (
      <div
        className={cn(
          "flex h-full items-center gap-1.5 px-2",
          variant === "split-reverse" && "flex-row-reverse",
        )}
      >
        <SkTextCol withPill />
        <SkRect className="h-8 flex-1" />
      </div>
    );
  }

  if (type === "testimonials") {
    if (variant === "grid") {
      return (
        <div className="flex h-full items-center gap-1 px-1.5">
          {[0, 1, 2].map((i) => (
            <SkCard key={i} className="flex-1 h-9">
              <SkBar w="w-full" />
              <SkBar w="w-2/3" />
              <SkBar w="w-1/2" accent />
            </SkCard>
          ))}
        </div>
      );
    }
    if (variant === "spotlight") {
      return (
        <div className="flex h-full items-center justify-center px-3">
          <SkCard className="w-full h-10 justify-center">
            <SkBar strong w="w-full" />
            <SkBar w="w-3/4" />
            <SkBar w="w-1/3" accent />
          </SkCard>
        </div>
      );
    }
    // list
    return (
      <div className="flex h-full flex-col justify-center gap-1 px-2.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-1 rounded-[3px] bg-white border border-ink/10 px-1 py-0.5"
          >
            <div className="size-1.5 rounded-full bg-ink/25 shrink-0" />
            <div className="h-1 flex-1 rounded-full bg-ink/20" />
          </div>
        ))}
      </div>
    );
  }

  if (type === "faq") {
    if (variant === "two-column") {
      return (
        <div className="flex h-full items-center gap-1.5 px-2">
          {[0, 1].map((col) => (
            <div key={col} className="flex-1 flex flex-col gap-1">
              <SkBar strong w="w-full" />
              <SkBar w="w-3/4" />
              <SkBar strong w="w-full" />
              <SkBar w="w-2/3" />
            </div>
          ))}
        </div>
      );
    }
    // accordion (mit +) / open-list (ohne +)
    const plus = variant === "accordion";
    return (
      <div className="flex h-full flex-col justify-center gap-1 px-2.5">
        <SkRow plus={plus} />
        <SkRow plus={plus} />
        <SkRow plus={plus} />
      </div>
    );
  }

  if (type === "content" || type === "case-study") {
    const quote = type === "case-study" && (
      <span
        className="text-[9px] leading-none font-serif font-bold text-brand"
        aria-hidden
      >
        {"„“"}
      </span>
    );
    if (variant === "text-only") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
          <SkBar strong w="w-3/4" />
          <SkBar w="w-full" />
          <SkBar w="w-5/6" />
        </div>
      );
    }
    if (variant === "media-top") {
      return (
        <div className="flex h-full flex-col justify-center gap-1 px-3">
          <SkRect className="h-5 w-full" />
          <div className="flex items-center gap-1">
            {quote}
            <SkBar strong w="w-2/3" />
          </div>
          <SkBar w="w-full" />
        </div>
      );
    }
    return (
      <div
        className={cn(
          "flex h-full items-center gap-1.5 px-2",
          variant === "media-right" && "flex-row-reverse",
        )}
      >
        <SkRect className="h-8 flex-1" />
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1">
            {quote}
            <SkBar strong w="w-full" />
          </div>
          <SkBar w="w-3/4" />
          <SkBar w="w-5/6" />
        </div>
      </div>
    );
  }

  if (type === "cta-banner") {
    if (variant === "calendar-inline") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
          <SkBar strong w="w-2/3" />
          <SkCalendarGrid className="w-full" />
        </div>
      );
    }
    if (variant === "calendar-popup") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
          <SkBar strong w="w-2/3" />
          <div className="flex items-center gap-1 rounded-full bg-brand px-1.5 py-0.5">
            {/* Mini-Kalender-Icon */}
            <div className="w-2 h-2 rounded-[1px] bg-white/90 relative">
              <div className="absolute top-0 inset-x-0 h-0.5 rounded-t-[1px] bg-brand-deep" />
            </div>
            <div className="h-1 w-4 rounded-full bg-white/80" />
          </div>
        </div>
      );
    }
    if (variant === "form") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
          <SkBar strong w="w-2/3" />
          <div className="h-2 w-full rounded-[3px] bg-white border border-ink/15" />
          <div className="h-2 w-full rounded-[3px] bg-white border border-ink/15" />
          <SkPill />
        </div>
      );
    }
    // button
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
        <SkBar strong w="w-2/3" />
        <SkBar w="w-1/2" />
        <SkPill className="mt-0.5" />
      </div>
    );
  }

  // Fallback (sollte nicht vorkommen): neutrale Balken.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3">
      <SkBar strong w="w-2/3" />
      <SkBar w="w-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/**
 * Visuelle Layout-Auswahl. Rendert nichts, wenn der Blocktyp keine
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
    <div>
      <div
        className="grid grid-cols-3 gap-1.5"
        role="group"
        aria-label="Layout wählen"
      >
        {variants.map((v) => {
          const isActive = v === active;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={isActive}
              title={labels[v] ?? v}
              onClick={() => {
                if (!isActive) onSelect(v);
              }}
              className={cn(
                "flex flex-col rounded-squircle-sm border p-1 transition-all text-left",
                isActive
                  ? "border-brand ring-1 ring-brand bg-brand-50"
                  : "border-line bg-surface hover:border-ink/25",
              )}
            >
              <div
                className="h-16 w-full min-w-0 overflow-hidden rounded-[6px] bg-surface-soft"
                aria-hidden
              >
                <VariantSketch type={type} variant={v} />
              </div>
              <span
                className={cn(
                  "mt-1 text-[10px] font-semibold leading-tight text-center",
                  isActive ? "text-brand-deep" : "text-ink-muted",
                )}
              >
                {labels[v] ?? v}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
