"use client";

/**
 * Kontext-Panel des Canvas-Builders (Konzept 6.1): Klick auf eine Sektion
 * lässt rechts EIN schmales Panel einschweben, nur mit dem, was diese
 * Sektion braucht:
 *
 *   1. Layout-Varianten als visuelle Miniaturen (VariantPicker)
 *   2. das typ-spezifische Inhalts-Formular (FORM_REGISTRY,
 *      Fallback: JSON-Notnagel wie im alten 3-Panel-Editor)
 *   3. Hintergrund der Sektion: Hell / Soft / Farbig (Konzept 6.3:
 *      keine freien Farb-Overrides, nur diese drei Stufen)
 *
 * Das Panel hält KEINEN eigenen State: alle Änderungen fließen als
 * Callbacks nach oben. Die Verdrahtung mit useLpEditorState
 * (updateBlockData / updateBlock / updateBlockStyle inkl. bgColor-Mapping
 * plain → undefined, soft → "var(--lp-color-surface)",
 * tinted → "var(--lp-color-primary-soft)") passiert im Builder-Shell.
 */

import * as React from "react";

import { Label } from "@/components/ui/label";
import type { Block } from "@/lib/landing-blocks/types";
import { cn } from "@/lib/utils";

import { BLOCK_LABELS, FORM_REGISTRY } from "../_editor/inspector-fields";
import {
  VariantPicker,
  hasVariants,
} from "../_editor/inspector-fields/variant-picker";

/** Erlaubte Hintergrund-Stufen pro Sektion (Konzept 6.3). */
export type SectionBackground = "plain" | "soft" | "tinted";

export interface ContextPanelProps {
  /** Aktive Sektion; `null` = Panel geschlossen (herausgeschoben). */
  block: Block | null;
  onClose: () => void;
  /** Flacher data-Patch, identisch zur onChange-Signatur der FORM_REGISTRY. */
  onChangeData: (patch: Record<string, unknown>) => void;
  onChangeVariant: (variant: string) => void;
  onChangeBackground: (bg: SectionBackground) => void;
  background: SectionBackground;
  onRemove: () => void;
  onDuplicate: () => void;
}

const BACKGROUND_OPTIONS: {
  value: SectionBackground;
  label: string;
  swatchClass: string;
}[] = [
  { value: "plain", label: "Hell", swatchClass: "bg-white" },
  { value: "soft", label: "Soft", swatchClass: "bg-surface-muted" },
  { value: "tinted", label: "Farbig", swatchClass: "bg-brand-soft" },
];

export function ContextPanel({
  block,
  onClose,
  onChangeData,
  onChangeVariant,
  onChangeBackground,
  background,
  onRemove,
  onDuplicate,
}: ContextPanelProps) {
  const open = block !== null;

  return (
    <aside
      aria-hidden={!open}
      aria-label="Sektion bearbeiten"
      className={cn(
        "fixed inset-y-0 right-0 z-[130] flex w-[380px] max-w-[92vw] flex-col",
        "bg-surface border-l border-line shadow-lift",
        "transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      {block && (
        <>
          {/* Kopf: Blocktyp + Schließen */}
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 shrink-0">
            <h2 className="text-sm font-bold text-ink truncate">
              {BLOCK_LABELS[block.type] ?? block.type}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Panel schließen"
              className="flex size-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors shrink-0"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M3 3l8 8M11 3l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Inhalt (scrollbar) — drei klare Gruppen: Layout / Inhalt /
              Design. key={block.id} setzt die Auf/Zu-Zustände beim
              Sektionswechsel auf die Defaults zurück. */}
          <div key={block.id} className="flex-1 overflow-y-auto">
            {hasVariants(block.type) && (
              <PanelSection title="Layout" defaultOpen>
                <VariantPicker block={block} onSelect={onChangeVariant} />
              </PanelSection>
            )}
            <PanelSection title="Inhalt" defaultOpen>
              <BlockForm block={block} onChange={onChangeData} />
            </PanelSection>
            <PanelSection title="Design" defaultOpen={false}>
              <Label>Hintergrund</Label>
              <div
                className="mt-1.5 grid grid-cols-3 gap-1.5"
                role="group"
                aria-label="Hintergrund wählen"
              >
                {BACKGROUND_OPTIONS.map((opt) => {
                  const isActive = background === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        if (!isActive) onChangeBackground(opt.value);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-squircle-sm border p-2 transition-all",
                        isActive
                          ? "border-brand ring-1 ring-brand bg-brand-50"
                          : "border-line bg-surface hover:border-ink/25",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "block size-8 rounded-[8px] border border-ink/10",
                          opt.swatchClass,
                        )}
                      />
                      <span
                        className={cn(
                          "text-[11px] font-semibold",
                          isActive ? "text-brand-deep" : "text-ink-muted",
                        )}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </PanelSection>
          </div>

          {/* Fuß: dezente Sektions-Aktionen */}
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 shrink-0">
            <button
              type="button"
              onClick={onDuplicate}
              className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
            >
              Duplizieren
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="text-xs font-semibold text-danger hover:opacity-80 transition-opacity"
            >
              Sektion entfernen
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Aufklappbare Panel-Gruppe (Layout / Inhalt / Design). Reduziert die
 * UI-Dichte: Nutzer sehen erst die drei Überschriften und öffnen nur,
 * was sie gerade brauchen.
 */
function PanelSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-ink">
          {title}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          className={cn(
            "text-ink-muted transition-transform",
            open && "rotate-180",
          )}
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

/**
 * Typ-spezifisches Formular; Blöcke ohne Registry-Eintrag fallen auf den
 * JSON-Notnagel zurück (identisch zum alten Editor-Inspector).
 */
function BlockForm({
  block,
  onChange,
}: {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const Form = FORM_REGISTRY[block.type];
  if (Form) return <Form block={block} onChange={onChange} />;
  return (
    <div>
      <Label>JSON</Label>
      <textarea
        value={JSON.stringify(block.data, null, 2)}
        onChange={(e) => {
          try {
            const next = JSON.parse(e.target.value);
            if (next && typeof next === "object") {
              onChange(next as Record<string, unknown>);
            }
          } catch {
            /* ungültiges JSON: warten bis es valide ist */
          }
        }}
        rows={12}
        className="w-full font-mono text-xs border border-line rounded-squircle-sm p-2 mt-1.5"
      />
    </div>
  );
}
