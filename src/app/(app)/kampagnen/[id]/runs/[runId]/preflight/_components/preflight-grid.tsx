"use client";

import * as React from "react";
import { LeadCard, type PreflightLead } from "./lead-card";

/**
 * Reines Layout-Wrapper: ein 4-Spalten-CSS-Grid auf Desktop, das
 * `LeadCard`-Komponenten rendert.
 *
 * Click-Verhalten (User-Wunsch):
 *  - Linksklick auf Card  → toggle Auswahl
 *  - Rechtsklick auf Card → Context-Menu (Details / Bild laden / URL …)
 *  - Enter / Space        → toggle (Keyboard, fokussierte Card)
 *
 * Die `onSelectToggle`-Callback bekommt das Original-Event (für Shift-
 * und Cmd/Ctrl-Erkennung im Selection-Hook).
 */
export interface PreflightGridProps {
  leads: ReadonlyArray<PreflightLead>;
  selected: Set<string>;
  focusedLeadId: string | null;
  onSelectToggle: (leadId: string, e: React.MouseEvent | React.KeyboardEvent) => void;
  onContextMenu: (leadId: string, e: React.MouseEvent) => void;
  onRetryScreenshot: (leadId: string) => void;
}

export function PreflightGrid({
  leads,
  selected,
  focusedLeadId,
  onSelectToggle,
  onContextMenu,
  onRetryScreenshot,
}: PreflightGridProps) {
  const handleToggle = React.useCallback(
    (id: string) => (e: React.MouseEvent | React.KeyboardEvent) =>
      onSelectToggle(id, e),
    [onSelectToggle],
  );
  const handleContext = React.useCallback(
    (id: string) => (e: React.MouseEvent) => onContextMenu(id, e),
    [onContextMenu],
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
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
    >
      {leads.map((lead) => (
        <LeadCard
          key={lead.id}
          lead={lead}
          selected={selected.has(lead.id)}
          focused={focusedLeadId === lead.id}
          onSelectToggle={handleToggle(lead.id)}
          onContextMenu={handleContext(lead.id)}
          onRetryScreenshot={handleRetry(lead.id)}
        />
      ))}
    </div>
  );
}
