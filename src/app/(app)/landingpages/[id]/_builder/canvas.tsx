"use client";

/**
 * BuilderCanvas — "Die Seite IST der Editor" (Konzept 6.1).
 *
 * Rendert die Landingpage bildschirmfüllend im gewählten Geräterahmen.
 * Pro Sektion: Hover-Outline + schwebende Mini-Leiste (SectionToolbar),
 * "+"-Linien zwischen den Sektionen als Einfüge- und Drop-Zonen sowie
 * Drag-Reorder über den Griff in der Leiste.
 *
 * Bewusst zustandsarm: sämtliche Mutationen laufen über die Callbacks aus
 * den Props (Verdrahtung mit useLpEditorState macht der Builder-Shell).
 */

import * as React from "react";
import { Plus } from "lucide-react";

import { BLOCK_REGISTRY } from "@/components/landing-blocks";
import {
  EditableBlockProvider,
  deepSet,
  type PlaceholderOption,
} from "@/components/landing-blocks/editable-text";
import { LandingThemeProvider } from "@/components/landing-blocks/theme-provider";
import type { Block } from "@/lib/landing-blocks/types";
import type { BrandConfig, ThemeConfig } from "@/lib/landing-theme/types";
import { cn } from "@/lib/utils";

import { hasVariants } from "../_editor/inspector-fields/variant-picker";
import { DeviceFrame } from "./device-frame";
import { SectionToolbar } from "./section-toolbar";

/**
 * Desktop rendert direkt (voller Viewport = Breakpoints stimmen ohnehin),
 * Geraete-Modi im iframe. `key` erzwingt einen frischen iframe pro Breite,
 * damit Stylesheet-Kopie und Hoehenmessung sauber neu starten.
 */
function MaybeDeviceFrame({
  width,
  children,
}: {
  width: number | null;
  children: React.ReactNode;
}) {
  if (width === null) return <>{children}</>;
  return (
    <DeviceFrame key={width} width={width}>
      {children}
    </DeviceFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Konstanten                                                          */
/* ------------------------------------------------------------------ */

export type BuilderDevice = "desktop" | "tablet" | "phone" | "phone-landscape";

/** Rahmenbreite pro Gerät. `null` = volle Breite (Desktop). */
const DEVICE_WIDTHS: Record<BuilderDevice, number | null> = {
  desktop: null,
  tablet: 834,
  phone: 390,
  "phone-landscape": 844,
};

/**
 * Beispieldaten für die Vorschau. Deutsche Synonym-Keys sind nötig, weil
 * bestehende Vorlagen Platzhalter wie {{vorname}} oder {{firma}} nutzen
 * (CSV-Spaltennamen) — ohne sie zeigt der Beispiel-Lead nur Fallbacks.
 */
const SAMPLE_LEAD: Record<string, string> = {
  firstName: "Max",
  lastName: "Mustermann",
  company: "Mustermann GmbH",
  email: "max@mustermann.de",
  jobTitle: "Geschäftsführer",
  vorname: "Max",
  nachname: "Mustermann",
  firma: "Mustermann GmbH",
  unternehmen: "Mustermann GmbH",
  position: "Geschäftsführer",
};

/**
 * Standard-Platzhalter für das {{-Menü der Inline-Textbearbeitung.
 * Es gibt (Stand heute) keine kanonische Liste unter src/lib/placeholders
 * (dort lebt nur die Kampagnen-Scan-Infrastruktur), daher hier definiert.
 */
const PLACEHOLDER_OPTIONS: PlaceholderOption[] = [
  { key: "firstName", label: "Vorname des Leads" },
  { key: "lastName", label: "Nachname" },
  { key: "company", label: "Firma" },
  { key: "jobTitle", label: "Position" },
  { key: "email", label: "E-Mail-Adresse" },
];

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface BuilderCanvasProps {
  blocks: Block[];
  theme: ThemeConfig;
  brand: BrandConfig;
  activeBlockId: string | null;
  device: BuilderDevice;
  sampleMode: boolean;
  onSelectBlock: (id: string | null) => void;
  /** Erhält das KOMPLETTE neue data-Objekt (deepSet-Ergebnis). */
  onUpdateBlockData: (id: string, data: Record<string, unknown>) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onReorderBlocks: (from: number, to: number) => void;
  onOpenGallery: (atIndex: number) => void;
  /** Öffnet das Kontext-Panel mit Fokus auf die Layout-Varianten. */
  onOpenVariant: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export function BuilderCanvas({
  blocks,
  theme,
  brand,
  activeBlockId,
  device,
  sampleMode,
  onSelectBlock,
  onUpdateBlockData,
  onMoveBlock,
  onRemoveBlock,
  onDuplicateBlock,
  onReorderBlocks,
  onOpenGallery,
  onOpenVariant,
}: BuilderCanvasProps) {
  /** Index des Blocks, der gerade am Griff gezogen wird. */
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  /** Einfüge-Index der aktuell gehighlighteten Drop-Zone. */
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);

  const dragging = dragIndex !== null;
  const width = DEVICE_WIDTHS[device];
  const framed = width !== null;

  const showFooter = brand.showFooter === true;

  const endDrag = React.useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent, insertIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      let from = dragIndex;
      if (from === null) {
        const raw = e.dataTransfer.getData("text/plain");
        const parsed = Number.parseInt(raw, 10);
        from = Number.isFinite(parsed) ? parsed : null;
      }
      endDrag();
      if (from === null || from < 0 || from >= blocks.length) return;
      // Einfüge-Index → Ziel-Index in der Liste ohne den gezogenen Block.
      const to = insertIndex > from ? insertIndex - 1 : insertIndex;
      if (to === from) return;
      onReorderBlocks(from, to);
    },
    [dragIndex, blocks.length, endDrag, onReorderBlocks],
  );

  return (
    <div
      className="h-full overflow-y-auto bg-surface-soft"
      onClick={() => onSelectBlock(null)}
    >
      <div className="min-h-full px-4 py-8 sm:px-8">
        {/* Geräterahmen: im Frame-Modus ein echter iframe, damit die
            Tailwind-Breakpoints auf die Rahmenbreite reagieren. */}
        <div
          className={cn(
            "mx-auto transition-[width] duration-300 ease-out",
            framed
              ? "rounded-3xl ring-1 ring-line shadow-card bg-surface overflow-hidden"
              : "w-full max-w-none",
          )}
          style={framed ? { width } : undefined}
        >
          <MaybeDeviceFrame width={width}>
          <LandingThemeProvider
            theme={theme}
            brand={brand}
            showFooter={showFooter}
          >
            {blocks.length === 0 ? (
              <EmptyState
                onAdd={(e) => {
                  e.stopPropagation();
                  onOpenGallery(0);
                }}
              />
            ) : (
              <div className="relative">
                {blocks.map((block, index) => (
                  <React.Fragment key={block.id}>
                    <InsertLine
                      index={index}
                      dragging={dragging}
                      highlighted={dropIndex === index}
                      onOpenGallery={onOpenGallery}
                      onDragEnter={() => setDropIndex(index)}
                      onDragLeaveZone={() =>
                        setDropIndex((cur) => (cur === index ? null : cur))
                      }
                      onDrop={(e) => handleDrop(e, index)}
                    />
                    <CanvasBlock
                      block={block}
                      index={index}
                      isFirst={index === 0}
                      isLast={index === blocks.length - 1}
                      active={block.id === activeBlockId}
                      lifted={dragIndex === index}
                      theme={theme}
                      sampleMode={sampleMode}
                      onSelect={() => onSelectBlock(block.id)}
                      onUpdateBlockData={onUpdateBlockData}
                      onMoveBlock={onMoveBlock}
                      onRemoveBlock={onRemoveBlock}
                      onDuplicateBlock={onDuplicateBlock}
                      onOpenVariant={onOpenVariant}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(index));
                        e.dataTransfer.effectAllowed = "move";
                        setDragIndex(index);
                      }}
                      onDragEnd={endDrag}
                    />
                  </React.Fragment>
                ))}
                <InsertLine
                  index={blocks.length}
                  dragging={dragging}
                  highlighted={dropIndex === blocks.length}
                  onOpenGallery={onOpenGallery}
                  onDragEnter={() => setDropIndex(blocks.length)}
                  onDragLeaveZone={() =>
                    setDropIndex((cur) =>
                      cur === blocks.length ? null : cur,
                    )
                  }
                  onDrop={(e) => handleDrop(e, blocks.length)}
                />
              </div>
            )}
          </LandingThemeProvider>
          </MaybeDeviceFrame>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Einzelner Block                                                     */
/* ------------------------------------------------------------------ */

function CanvasBlock({
  block,
  isFirst,
  isLast,
  active,
  lifted,
  theme,
  sampleMode,
  onSelect,
  onUpdateBlockData,
  onMoveBlock,
  onRemoveBlock,
  onDuplicateBlock,
  onOpenVariant,
  onDragStart,
  onDragEnd,
}: {
  block: Block;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  active: boolean;
  /** Während des Drags: als "angehobene Karte" darstellen. */
  lifted: boolean;
  theme: ThemeConfig;
  sampleMode: boolean;
  onSelect: () => void;
  onUpdateBlockData: (id: string, data: Record<string, unknown>) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onRemoveBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onOpenVariant: (id: string) => void;
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const Component = BLOCK_REGISTRY[block.type];

  const editableCtx = React.useMemo(
    () => ({
      update: (path: string, value: string) =>
        onUpdateBlockData(block.id, deepSet(block.data, path, value)),
      placeholders: PLACEHOLDER_OPTIONS,
      sampleMode,
    }),
    [block.id, block.data, sampleMode, onUpdateBlockData],
  );

  return (
    <div
      data-block-id={block.id}
      onClick={(e) => {
        e.stopPropagation();
        // Klicks in Editierfeldern (contentEditable/Inputs) nicht als
        // Block-Auswahl werten — die Textbearbeitung übernimmt dort.
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.isContentEditable ||
            target.closest("input, textarea, [contenteditable=\"true\"]"))
        ) {
          return;
        }
        onSelect();
      }}
      className={cn(
        "group/section relative transition-all",
        active
          ? "ring-2 ring-brand ring-offset-2 ring-offset-surface z-10"
          : "hover:ring-1 hover:ring-line",
        lifted && "opacity-50 shadow-2xl scale-[0.99] rounded-squircle-sm",
      )}
    >
      {/* Schwebende Mini-Leiste: bei Hover oder wenn aktiv */}
      <div
        className={cn(
          "absolute -top-4 right-4 z-20 transition-opacity",
          active
            ? "opacity-100"
            : "opacity-0 group-hover/section:opacity-100 focus-within:opacity-100",
        )}
      >
        <SectionToolbar
          showVariantButton={hasVariants(block.type)}
          canMoveUp={!isFirst}
          canMoveDown={!isLast}
          onOpenVariant={() => onOpenVariant(block.id)}
          onMoveUp={() => onMoveBlock(block.id, -1)}
          onMoveDown={() => onMoveBlock(block.id, 1)}
          onDuplicate={() => onDuplicateBlock(block.id)}
          onRemove={() => onRemoveBlock(block.id)}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>

      {Component ? (
        <EditableBlockProvider value={editableCtx}>
          <Component
            data={block.data}
            style={block.style}
            variant={block.variant}
            theme={theme as unknown as Record<string, unknown>}
            leadData={SAMPLE_LEAD}
            leadId="preview"
            slot={block.type === "hero" ? <HeroVideoStub /> : undefined}
          />
        </EditableBlockProvider>
      ) : (
        <div className="m-4 p-3 text-xs text-ink-muted rounded-squircle-sm border border-dashed border-line">
          Unbekannter Sektions-Typ: <code>{block.type}</code>
        </div>
      )}
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

/* ------------------------------------------------------------------ */
/* "+"-Linie: Einfüge-Zone + Drop-Ziel                                 */
/* ------------------------------------------------------------------ */

function InsertLine({
  index,
  dragging,
  highlighted,
  onOpenGallery,
  onDragEnter,
  onDragLeaveZone,
  onDrop,
}: {
  index: number;
  dragging: boolean;
  highlighted: boolean;
  onOpenGallery: (atIndex: number) => void;
  onDragEnter: () => void;
  onDragLeaveZone: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={cn(
        "group/insert relative flex items-center justify-center transition-all",
        // Während eines Drags werden die Zonen höher, damit man sie trifft.
        dragging ? "h-10" : "h-6",
      )}
      onClick={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragEnter();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={(e) => {
        // Nur zurücksetzen, wenn der Zeiger die Zone wirklich verlässt.
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        onDragLeaveZone();
      }}
      onDrop={onDrop}
    >
      {/* Linie: dezent, bei Hover deutlich; beim Drag als Drop-Indikator */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-x-6 h-px transition-all pointer-events-none",
          highlighted
            ? "bg-brand h-0.5 opacity-100"
            : dragging
              ? "bg-line opacity-60"
              : "bg-brand opacity-0 group-hover/insert:opacity-60",
        )}
      />
      {/* "+"-Button: dauerhaft schwach sichtbar, bei Hover voll da */}
      {!dragging && (
        <button
          type="button"
          title="Sektion hinzufügen"
          onClick={(e) => {
            e.stopPropagation();
            onOpenGallery(index);
          }}
          className={cn(
            "relative z-10 inline-flex items-center justify-center size-6 rounded-full",
            "bg-surface text-ink-muted ring-1 ring-line shadow-card transition-all",
            "opacity-35 group-hover/insert:opacity-100 focus-visible:opacity-100",
            "group-hover/insert:scale-110 hover:text-brand-deep hover:ring-brand",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          )}
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Leerzustand                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({
  onAdd,
}: {
  onAdd: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-24">
      <div className="size-12 rounded-full bg-brand-soft text-brand-deep flex items-center justify-center mb-4">
        <Plus className="size-5" />
      </div>
      <h2 className="text-lg font-bold text-ink">
        Füge deine erste Sektion hinzu
      </h2>
      <p className="text-sm text-ink-muted mt-1 max-w-sm">
        Wähle aus fertigen Sektionen wie Hero, Kundenstimmen oder FAQ und
        baue deine Seite Stück für Stück auf.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          "mt-5 inline-flex items-center gap-1.5 rounded-full bg-ink text-white",
          "px-5 py-2.5 text-sm font-semibold shadow-card transition-transform",
          "hover:-translate-y-0.5 active:translate-y-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <Plus className="size-4" />
        Sektion auswählen
      </button>
    </div>
  );
}
