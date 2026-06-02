"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityFeedRow } from "../activity-center";
import { EventIcon, describeKind } from "./event-icon";
import { TemperatureDot } from "./temperature-badge";

/**
 * FeedRow — kompakte 56px-Zeile à la Linear: Zeit · Icon · Name+Firma ·
 * Event-Text · Tags · Chevron. Hover-Background + Pointer, Click öffnet
 * den LeadDrawer (via `onSelect`).
 *
 * Wir setzen `tabIndex={focused ? 0 : -1}` damit der Pfeil-Navigation
 * Fokus konsistent zwischen Rows wandern kann (Roving-Tabindex).
 */
export interface FeedRowProps {
  row: ActivityFeedRow;
  focused?: boolean;
  isNew?: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

export const FeedRow = React.forwardRef<HTMLButtonElement, FeedRowProps>(
  ({ row, focused, isNew, onSelect, onFocus }, ref) => {
    const time = React.useMemo(() => formatTime(row.ts), [row.ts]);
    const description = React.useMemo(
      () => describeKind(row.kind, row.payload),
      [row.kind, row.payload],
    );

    const leadDisplay = row.lead.name || row.lead.companyName || "Unbekannter Lead";
    const companyLine = row.lead.name && row.lead.companyName ? row.lead.companyName : null;

    return (
      <button
        ref={ref}
        type="button"
        role="row"
        tabIndex={focused ? 0 : -1}
        onClick={onSelect}
        onFocus={onFocus}
        aria-label={`${time} — ${leadDisplay}: ${description}`}
        className={cn(
          "group w-full text-left flex items-center gap-3 h-14 px-3 sm:px-4",
          "border-b border-line-soft transition-colors",
          "hover:bg-surface-muted/60",
          "focus:outline-none focus-visible:bg-brand-soft/50",
          focused && "bg-brand-soft/40",
          isNew && "animate-in fade-in slide-in-from-top-2 duration-300",
        )}
      >
        {/* Time */}
        <span className="w-12 text-xs tabular-nums text-ink-muted shrink-0">
          {time}
        </span>

        {/* Event icon */}
        <EventIcon kind={row.kind} />

        {/* Lead-Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1.5 min-w-0">
              <TemperatureDot temperature={row.lead.temperature} />
              <span className="truncate text-sm font-semibold text-ink">
                {leadDisplay}
              </span>
              {companyLine && (
                <span className="truncate text-sm text-ink-muted">
                  · {companyLine}
                </span>
              )}
            </div>
            <span className="truncate text-xs text-ink-muted">
              {description}
              {row.run?.name ? ` · Run ${row.run.name}` : ""}
              {row.campaign?.name && !row.run?.name
                ? ` · ${row.campaign.name}`
                : ""}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-ink-muted transition-transform",
            "group-hover:translate-x-0.5",
          )}
        />
      </button>
    );
  },
);
FeedRow.displayName = "FeedRow";

/**
 * "HH:mm" in user-locale. Falls die Zeit > 1 Tag her ist, zeigen wir
 * stattdessen "DD.MM." damit der Kontext nicht verloren geht.
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}
