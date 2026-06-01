"use client";

import * as React from "react";
import { BLOCK_REGISTRY } from "@/components/landing-blocks";
import { LandingThemeProvider } from "@/components/landing-blocks/theme-provider";
import type { Block } from "@/lib/landing-blocks/types";
import type { BrandConfig, ThemeConfig } from "@/lib/landing-theme/types";
import { cn } from "@/lib/utils";

/**
 * Live-Preview für den Block-Editor.
 *
 * Rendert die aktuelle Block-Liste innerhalb des `<LandingThemeProvider>`
 * mit Sample-Lead-Daten. Klick auf einen Block macht ihn im Editor aktiv —
 * wir blenden dafür einen 1px-Outline um den aktiven Block ein.
 *
 * Hinweis: das Hero-Block-Video-Slot bleibt hier leer — eine echte
 * Video-Wiedergabe würde Tracking/Lead-Lookup brauchen, was im Editor
 * irrelevant ist. Stattdessen rendert die Hero-Komponente nur Headline +
 * Subheadline.
 */

const SAMPLE_LEAD: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  company: "Mustermann GmbH",
  email: "max@mustermann.de",
  jobTitle: "Geschäftsführer",
};

export interface LpPreviewProps {
  blocks: Block[];
  theme: ThemeConfig;
  brand: BrandConfig;
  activeBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
}

export function LpPreview({
  blocks,
  theme,
  brand,
  activeBlockId,
  onSelectBlock,
}: LpPreviewProps) {
  // Footer-Sichtbarkeit im Editor: standardmäßig zeigen wenn brand.
  // showFooter explizit true ist — die Domain-Logik der Public-Page
  // brauchen wir hier nicht.
  const showFooter = brand.showFooter === true;
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 bg-surface-soft text-[11px] text-ink-muted">
        <span className="font-semibold">Live-Vorschau</span>
        <span>
          Beispieldaten: <code className="text-ink">Max Mustermann</code>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <LandingThemeProvider
          theme={theme}
          brand={brand}
          showFooter={showFooter}
        >
          <div className="px-3">
            {blocks.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-12">
                Noch keine Blöcke. Fügen Sie links den ersten hinzu.
              </p>
            ) : (
              blocks.map((b) => (
                <PreviewBlock
                  key={b.id}
                  block={b}
                  active={b.id === activeBlockId}
                  onSelect={() => onSelectBlock(b.id)}
                  theme={theme}
                />
              ))
            )}
          </div>
        </LandingThemeProvider>
      </div>
    </div>
  );
}

function PreviewBlock({
  block,
  active,
  onSelect,
  theme,
}: {
  block: Block;
  active: boolean;
  onSelect: () => void;
  theme: ThemeConfig;
}) {
  const Component = BLOCK_REGISTRY[block.type];
  if (!Component) {
    return (
      <div className="my-2 p-3 text-xs text-ink-muted rounded-squircle-sm border border-dashed border-line">
        Unbekannter Block-Typ: <code>{block.type}</code>
      </div>
    );
  }
  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative cursor-pointer rounded-squircle-sm transition-all my-1",
        active && "ring-2 ring-brand ring-offset-2 ring-offset-surface",
      )}
      data-block-id={block.id}
    >
      {/* The hero block expects a videoSlot — pass a stub so the renderer
          doesn't break. */}
      <Component
        data={block.data}
        style={block.style}
        theme={theme as unknown as Record<string, unknown>}
        leadData={SAMPLE_LEAD}
        leadId="preview"
        slot={block.type === "hero" ? <HeroVideoStub /> : undefined}
      />
    </div>
  );
}

function HeroVideoStub() {
  return (
    <div className="aspect-video w-full max-w-2xl mx-auto bg-line-soft border border-line rounded-2xl flex items-center justify-center text-xs text-ink-muted">
      Video-Vorschau (nur live für Empfänger)
    </div>
  );
}
