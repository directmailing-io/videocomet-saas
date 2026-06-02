"use client";

import * as React from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Floating-Action-Bar am unteren Bildschirmrand.
 *
 * Erscheint nur, wenn mindestens ein Lead selektiert ist. Wir mounten
 * sie immer (für saubere CSS-Animationen) und schalten Sichtbarkeit /
 * Position via `data-state`. Die `slide-up`-Animation kommt aus dem
 * Tailwind-Config (siehe `tailwind.config.ts`).
 */
export interface BulkActionBarProps {
  selectedCount: number;
  loading?: boolean;
  onRemove: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  loading,
  onRemove,
  onClear,
}: BulkActionBarProps) {
  const visible = selectedCount > 0;
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed left-1/2 -translate-x-1/2 bottom-6 z-40 pointer-events-none",
        "transition-all duration-200 ease-spring",
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-4",
      )}
    >
      <div
        role="region"
        aria-label="Massen-Aktionen für ausgewählte Leads"
        className={cn(
          "flex items-center gap-3 pl-5 pr-3 py-2.5",
          "bg-ink text-white rounded-full shadow-lift",
          "min-w-[320px] max-w-[480px]",
        )}
      >
        <span className="text-sm font-semibold whitespace-nowrap">
          {selectedCount} ausgewählt
        </span>
        <span className="h-5 w-px bg-white/15" />
        <Button
          variant="danger"
          size="sm"
          iconLeft={<Trash2 className="size-4" />}
          loading={loading}
          onClick={onRemove}
          className="rounded-full"
        >
          Entfernen
        </Button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Auswahl aufheben"
          className="inline-flex items-center justify-center size-8 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
