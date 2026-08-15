"use client";

/**
 * Schwebende Mini-Leiste pro Sektion im Canvas-Builder (Konzept 6.1).
 *
 * Wird von canvas.tsx oben rechts über dem Block gerendert — sichtbar bei
 * Hover oder wenn der Block aktiv ist. Alle Klicks stoppen die Propagation,
 * damit sie nicht als "Block auswählen" interpretiert werden.
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  GripVertical,
  LayoutTemplate,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface SectionToolbarProps {
  /** Nur zeigen, wenn der Blocktyp Layout-Varianten kennt. */
  showVariantButton: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpenVariant: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** Drag-Reorder: der Griff ist das draggable Element. */
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: (e: React.DragEvent<HTMLButtonElement>) => void;
  className?: string;
}

const BTN_BASE =
  "inline-flex items-center justify-center size-7 rounded-full text-ink-muted transition-colors " +
  "hover:bg-line-soft hover:text-ink disabled:opacity-35 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

export function SectionToolbar({
  showVariantButton,
  canMoveUp,
  canMoveDown,
  onOpenVariant,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
  onDragStart,
  onDragEnd,
  className,
}: SectionToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-surface shadow-card ring-1 ring-line px-1 py-0.5",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="Sektion bearbeiten"
    >
      {showVariantButton && (
        <>
          <button
            type="button"
            title="Layout wählen"
            onClick={onOpenVariant}
            className={cn(
              BTN_BASE,
              "w-auto gap-1 px-2 text-[11px] font-semibold",
            )}
          >
            <LayoutTemplate className="size-3.5" />
            Layout
            <ChevronDown className="size-3" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        title="Nach oben verschieben"
        disabled={!canMoveUp}
        onClick={onMoveUp}
        className={BTN_BASE}
      >
        <ArrowUp className="size-3.5" />
      </button>
      <button
        type="button"
        title="Nach unten verschieben"
        disabled={!canMoveDown}
        onClick={onMoveDown}
        className={BTN_BASE}
      >
        <ArrowDown className="size-3.5" />
      </button>
      <button
        type="button"
        title="Sektion duplizieren"
        onClick={onDuplicate}
        className={BTN_BASE}
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        title="Sektion löschen"
        onClick={onRemove}
        className={cn(BTN_BASE, "hover:bg-danger-soft hover:text-danger")}
      >
        <Trash2 className="size-3.5" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />
      <button
        type="button"
        title="Ziehen zum Verschieben"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(BTN_BASE, "cursor-grab active:cursor-grabbing")}
      >
        <GripVertical className="size-3.5" />
      </button>
    </div>
  );
}
