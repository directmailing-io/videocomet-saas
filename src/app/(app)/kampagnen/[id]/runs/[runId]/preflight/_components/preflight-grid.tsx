"use client";

import * as React from "react";
import { LeadCard, type PreflightLead } from "./lead-card";

/**
 * Reines Layout-Wrapper: ein 5-Spalten-CSS-Grid mit 12px Gap, das
 * `LeadCard`-Komponenten rendert. Keine virtualization (wir haben
 * bewusst keine Lib im Bundle) — 500 lazy-loaded Karten reichen
 * für Chrome / Safari, weil die Bilder via `loading="lazy"` und
 * `decoding="async"` erst beim Sichtbarwerden vom CDN gepullt werden.
 *
 * Die `onSelectToggle`-Callback bekommt das Original-Maus-Event
 * (für Shift- und Cmd/Ctrl-Erkennung im Hook-Layer).
 */
export interface PreflightGridProps {
  leads: ReadonlyArray<PreflightLead>;
  selected: Set<string>;
  focusedLeadId: string | null;
  onLeadOpen: (leadId: string) => void;
  onSelectToggle: (leadId: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onRetryScreenshot: (leadId: string) => void;
}

export function PreflightGrid({
  leads,
  selected,
  focusedLeadId,
  onLeadOpen,
  onSelectToggle,
  onRetryScreenshot,
}: PreflightGridProps) {
  // Stabile Click-Handler-Erzeuger pro Karte. Da die Liste sich häufig
  // ändert (SSE-Ticks) und wir 500 Karten zeigen, ist der naive
  // Inline-Arrow-Path unter dem Limit, aber via useCallback-Memo
  // wäre die Identity-Stabilität gerettet — wir bauen daher einen
  // kompakten Closure-Factory, der ein einziges Dispatch-Set zurück gibt.

  const handleOpen = React.useCallback(
    (id: string) => () => onLeadOpen(id),
    [onLeadOpen],
  );
  const handleToggle = React.useCallback(
    (id: string) => (e: React.MouseEvent | React.KeyboardEvent) =>
      onSelectToggle(id, e),
    [onSelectToggle],
  );
  const handleRetry = React.useCallback(
    (id: string) => () => onRetryScreenshot(id),
    [onRetryScreenshot],
  );

  return (
    <div
      role="grid"
      aria-label="Lead-Quality-Check-Grid"
      aria-rowcount={leads.length}
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
    >
      {leads.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          selected={selected.has(lead.id)}
          focused={focusedLeadId === lead.id}
          onOpen={handleOpen(lead.id)}
          onSelectToggle={handleToggle(lead.id)}
          onRetryScreenshot={handleRetry(lead.id)}
        />
      ))}
    </div>
  );
}
