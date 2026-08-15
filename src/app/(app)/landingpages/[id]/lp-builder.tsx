"use client";

/**
 * Canvas-Builder (Konzept Abschnitt 6): Die Seite IST der Editor.
 *
 * Vollbild-Overlay (fixed inset-0, wie der Studio-Modus) mit schlanker
 * Topbar. Darunter der BuilderCanvas (Live-Seite mit Hover-Leisten,
 * "+"-Linien und Inline-Editing), rechts das Kontext-Panel des aktiven
 * Blocks, dazu die Sektions-Galerie und das Styleguide-Panel.
 *
 * State kommt unveraendert aus `useLpEditorState` (Auto-Save, Undo,
 * Migration) — der Builder ist eine reine UI-Schicht darueber.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Monitor,
  Palette,
  Smartphone,
  Tablet,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { BlockType } from "@/lib/landing-blocks/types";
import { BuilderCanvas, type BuilderDevice } from "./_builder/canvas";
import { AddGallery } from "./_builder/add-gallery";
import { ContextPanel, type SectionBackground } from "./_builder/context-panel";
import {
  useLpEditorState,
  type LpEditorInitialTemplate,
} from "./_editor/state";
import { StyleguidePanel } from "./_editor/styleguide-panel";

export interface LpBuilderTemplate extends LpEditorInitialTemplate {}

const BG_SOFT = "var(--lp-color-surface)";
const BG_TINTED = "var(--lp-color-primary-soft)";

function backgroundOf(bgColor: string | undefined): SectionBackground {
  if (bgColor === BG_SOFT) return "soft";
  if (bgColor === BG_TINTED) return "tinted";
  return "plain";
}

function bgColorOf(bg: SectionBackground): string | undefined {
  if (bg === "soft") return BG_SOFT;
  if (bg === "tinted") return BG_TINTED;
  return undefined;
}

export function LpBuilder({ template }: { template: LpBuilderTemplate }) {
  const s = useLpEditorState(template);
  const [device, setDevice] = React.useState<BuilderDevice>("desktop");
  const [sampleMode, setSampleMode] = React.useState(false);
  const [galleryAt, setGalleryAt] = React.useState<number | null>(null);
  const [styleguideOpen, setStyleguideOpen] = React.useState(false);

  const activeBlock = s.blocks.find((b) => b.id === s.activeBlockId) ?? null;

  return (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-hidden bg-canvas">
      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-surface border-b border-line shrink-0">
        <Link
          href="/landingpages"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-deep shrink-0"
        >
          <ArrowLeft className="size-3.5" />
          Zurück
        </Link>
        <input
          value={s.name}
          onChange={(e) => s.setName(e.target.value)}
          onBlur={() => void s.saveName()}
          aria-label="Name der Landingpage"
          className="bg-transparent border-0 outline-none text-sm font-bold text-ink min-w-0 flex-1 max-w-xs focus:bg-line-soft rounded-md px-1.5 py-0.5"
        />

        <div className="flex-1" />

        <DeviceSwitcher device={device} onChange={setDevice} />

        <button
          type="button"
          onClick={() => setSampleMode((v) => !v)}
          aria-pressed={sampleMode}
          title="Platzhalter mit Beispieldaten ansehen"
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors shrink-0",
            sampleMode
              ? "bg-brand-soft text-brand-deep"
              : "bg-surface-soft text-ink-muted hover:text-ink",
          )}
        >
          <UserRound className="size-3.5" />
          Beispiel-Lead
        </button>

        <button
          type="button"
          onClick={() => setStyleguideOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-surface-soft text-ink-muted hover:text-ink transition-colors shrink-0"
        >
          <Palette className="size-3.5" />
          Styleguide
        </button>

        <button
          type="button"
          onClick={s.undo}
          disabled={!s.canUndo}
          title="Rückgängig"
          className={cn(
            "inline-flex items-center justify-center size-7 rounded-full text-ink-muted transition-colors shrink-0",
            s.canUndo ? "hover:text-ink hover:bg-surface-soft" : "opacity-30",
          )}
        >
          <Undo2 className="size-3.5" />
        </button>

        <SaveIndicator state={s.saveState} />
      </header>

      {s.showMigrationBanner && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warn-soft/60 text-xs text-ink shrink-0">
          <span className="font-semibold">
            Diese Vorlage wurde in das neue Format überführt.
          </span>
          <span className="text-ink-muted">
            Deine alte Konfiguration bleibt in der Datenbank erhalten.
          </span>
          <button
            type="button"
            onClick={s.dismissMigrationBanner}
            className="ml-auto text-ink-muted hover:text-ink"
            aria-label="Hinweis schließen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <BuilderCanvas
          blocks={s.blocks}
          theme={s.theme}
          brand={s.brand}
          activeBlockId={s.activeBlockId}
          device={device}
          sampleMode={sampleMode}
          onSelectBlock={s.setActiveBlockId}
          onUpdateBlockData={(id, data) => s.updateBlock(id, { data })}
          onMoveBlock={s.moveBlock}
          onRemoveBlock={s.removeBlock}
          onDuplicateBlock={s.duplicateBlock}
          onReorderBlocks={s.reorderBlocks}
          onOpenGallery={setGalleryAt}
          onOpenVariant={s.setActiveBlockId}
        />

        <ContextPanel
          block={activeBlock}
          onClose={() => s.setActiveBlockId(null)}
          onChangeData={(patch) => {
            if (activeBlock) s.updateBlockData(activeBlock.id, patch);
          }}
          onChangeVariant={(variant) => {
            if (activeBlock) s.updateBlock(activeBlock.id, { variant });
          }}
          background={backgroundOf(activeBlock?.style?.bgColor)}
          onChangeBackground={(bg) => {
            if (activeBlock)
              s.updateBlockStyle(activeBlock.id, { bgColor: bgColorOf(bg) });
          }}
          onRemove={() => {
            if (activeBlock) s.removeBlock(activeBlock.id);
          }}
          onDuplicate={() => {
            if (activeBlock) s.duplicateBlock(activeBlock.id);
          }}
        />
      </div>

      <AddGallery
        open={galleryAt !== null}
        onClose={() => setGalleryAt(null)}
        onAdd={(type: BlockType) => {
          s.addBlock(type, galleryAt ?? undefined);
          setGalleryAt(null);
        }}
        theme={s.theme}
        brand={s.brand}
      />

      <StyleguidePanel
        open={styleguideOpen}
        onClose={() => setStyleguideOpen(false)}
        theme={s.theme}
        brand={s.brand}
        setTheme={s.setTheme}
        setBrand={s.setBrand}
      />
    </div>
  );
}

// ── Geräte-Umschalter ──────────────────────────────────────────────────────

const DEVICES: Array<{
  id: BuilderDevice;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "desktop", label: "Desktop", icon: <Monitor className="size-3.5" /> },
  { id: "tablet", label: "Tablet", icon: <Tablet className="size-3.5" /> },
  {
    id: "phone",
    label: "Smartphone",
    icon: <Smartphone className="size-3.5" />,
  },
  {
    id: "phone-landscape",
    label: "Smartphone quer",
    icon: <Smartphone className="size-3.5 rotate-90" />,
  },
];

function DeviceSwitcher({
  device,
  onChange,
}: {
  device: BuilderDevice;
  onChange: (d: BuilderDevice) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ansicht wählen"
      className="flex items-center gap-0.5 rounded-full bg-surface-soft p-0.5 shrink-0"
    >
      {DEVICES.map((d) => (
        <button
          key={d.id}
          type="button"
          title={d.label}
          aria-pressed={device === d.id}
          onClick={() => onChange(d.id)}
          className={cn(
            "inline-flex items-center justify-center size-7 rounded-full transition-colors",
            device === d.id
              ? "bg-surface text-brand-deep shadow-card"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {d.icon}
        </button>
      ))}
    </div>
  );
}

// ── Save-Indicator ─────────────────────────────────────────────────────────

function SaveIndicator({
  state,
}: {
  state: "idle" | "saving" | "saved" | "error";
}) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted shrink-0 w-24">
        <Loader2 className="size-3 animate-spin" />
        Speichert…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        className="text-xs font-semibold text-danger shrink-0 w-24"
        title="Speichern fehlgeschlagen. Prüfe deine Verbindung."
      >
        Nicht gespeichert
      </span>
    );
  }
  return (
    <span className="text-xs text-ink-muted shrink-0 w-24">
      {state === "saved" ? "Gespeichert" : "Automatisches Speichern"}
    </span>
  );
}
