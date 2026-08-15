"use client";

/**
 * Bild-Platzhalter fuer den Canvas-Builder: wird an allen Bild-Stellen
 * gerendert, solange noch keine URL gesetzt ist. Auf der Public-Seite
 * (kein Provider) und im Beispiel-Lead-Modus ergibt er null — das
 * Server-HTML bleibt unveraendert.
 *
 * Optik: sanfter Verlauf in Theme-Farben + Bild-Icon + Hinweistext,
 * damit Laien sofort sehen "hier kommt ein Bild hin" statt sich zu
 * wundern, warum die Sektion leer aussieht.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditableBlock } from "./editable-text";

export function ImagePlaceholder({
  label = "Bild im Panel rechts hochladen",
  className,
  style,
  rounded = true,
}: {
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  /** false z. B. bei full-bleed Bildern (Kante an Kante, eckig). */
  rounded?: boolean;
}): React.ReactNode {
  const ctx = useEditableBlock();
  if (!ctx || ctx.sampleMode) return null;
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2",
        "border border-dashed px-4 py-10 text-center select-none",
        className,
      )}
      style={{
        borderColor: "var(--lp-color-primary)",
        background:
          "linear-gradient(135deg, var(--lp-color-primary-soft, rgba(0,0,0,0.04)), var(--lp-color-surface, rgba(0,0,0,0.02)))",
        borderRadius: rounded ? "var(--lp-radius-image)" : undefined,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="size-8 opacity-50"
        style={{ color: "var(--lp-color-primary)" }}
      >
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="9" cy="10" r="1.8" fill="currentColor" />
        <path
          d="M4 18l5-5 3.5 3.5L16 13l4 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-xs font-medium opacity-60">{label}</span>
    </div>
  );
}
