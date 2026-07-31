"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  isProblematic,
  type PreflightLead,
  type PreflightStatus,
} from "./lead-card";

/**
 * Filter-Modell (vereinfacht): genau EINE aktive Sicht.
 *   "problematic"  → alle Karten mit !ok && !pending && !running
 *   "ok"           → nur geprüfte, unauffällige Leads
 *   "all"          → kein Filter
 * Die Status-Detail-Keys bleiben im Typ erhalten, damit
 * `applyFilterAndSort` abwärtskompatibel bleibt.
 */
export type FilterKey = "all" | "problematic" | PreflightStatus;

export type SortKey =
  | "problems_first"
  | "duration_desc"
  | "domain_asc"
  | "upload_order";

const VIEWS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "problematic", label: "Auffällig" },
  { key: "ok", label: "OK" },
  { key: "all", label: "Alle" },
];

export interface FilterToolbarProps {
  /** Volle Lead-Liste — wir berechnen daraus die Counts pro Sicht. */
  leads: ReadonlyArray<PreflightLead>;
  view: FilterKey;
  searchQuery: string;
  onViewChange: (key: FilterKey) => void;
  onSearchChange: (q: string) => void;
}

export function FilterToolbar({
  leads,
  view,
  searchQuery,
  onViewChange,
  onSearchChange,
}: FilterToolbarProps) {
  const counts = React.useMemo(() => {
    let all = 0;
    let problematic = 0;
    let ok = 0;
    for (const lead of leads) {
      if (lead.removedAt) continue;
      all += 1;
      const s = lead.preflightStatus;
      if (s === "ok") ok += 1;
      else if (s !== "pending" && s !== "running") problematic += 1;
    }
    return { all, problematic, ok };
  }, [leads]);

  // Lokales Search-Input mit Debounce nach 200ms an Parent.
  const [localSearch, setLocalSearch] = React.useState(searchQuery);
  React.useEffect(() => setLocalSearch(searchQuery), [searchQuery]);
  React.useEffect(() => {
    if (localSearch === searchQuery) return;
    const t = window.setTimeout(() => onSearchChange(localSearch), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      {/* Segment-Schalter: eine Sicht, klare Wahl */}
      <div
        role="tablist"
        aria-label="Leads filtern"
        className="inline-flex items-center rounded-full bg-surface-soft p-1 self-start"
      >
        {VIEWS.map(({ key, label }) => {
          const count =
            key === "all"
              ? counts.all
              : key === "problematic"
                ? counts.problematic
                : counts.ok;
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(key)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold transition-all duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                active
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <span>{label}</span>
              <span
                className={cn(
                  "tabular-nums text-[11px] font-bold",
                  active && key === "problematic" && count > 0
                    ? "text-warn"
                    : "text-ink-muted",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 max-w-sm">
        <Input
          type="search"
          placeholder="Name, Firma oder Domain…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          icon={<Search />}
          aria-label="Leads durchsuchen"
          className="h-9 py-2"
        />
      </div>
    </div>
  );
}

/**
 * Anwenden von Filter + Search + Sort auf eine Lead-Liste.
 * Exportiert, damit der Client-Wrapper denselben Pfad benutzt und
 * Filterung & Sort als Memo (`useMemo`) hochheben kann.
 */
export function applyFilterAndSort(
  leads: ReadonlyArray<PreflightLead>,
  activeFilters: ReadonlySet<FilterKey>,
  searchQuery: string,
  sort: SortKey,
): PreflightLead[] {
  const q = searchQuery.trim().toLowerCase();
  const hasAll = activeFilters.has("all") || activeFilters.size === 0;

  const filtered = leads.filter((lead) => {
    if (lead.removedAt) return false;
    // Filter-Match: leere Auswahl = alles; "all"-Chip = alles
    if (!hasAll) {
      const matchesAny = Array.from(activeFilters).some((f) => {
        if (f === "problematic") return isProblematic(lead.preflightStatus);
        return lead.preflightStatus === f;
      });
      if (!matchesAny) return false;
    }
    if (q.length > 0) {
      const hay = [
        lead.firstName,
        lead.lastName,
        lead.fullName,
        lead.companyName,
        lead.websiteUrl,
        lead.preflightFinalUrl,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  switch (sort) {
    case "problems_first": {
      const severityOrder: Record<string, number> = {
        url_dead: 0,
        tls_error: 1,
        bot_block: 2,
        url_redirect: 3,
        slow: 4,
        missing_field: 5,
        duplicate: 6,
        screenshot_unavailable: 7,
        unknown_error: 8,
        running: 9,
        pending: 10,
        ok: 11,
      };
      return [...filtered].sort((a, b) => {
        const da = severityOrder[a.preflightStatus] ?? 99;
        const db = severityOrder[b.preflightStatus] ?? 99;
        if (da !== db) return da - db;
        return a.rowIndex - b.rowIndex;
      });
    }
    case "duration_desc":
      return [...filtered].sort(
        (a, b) =>
          (b.preflightDurationMs ?? 0) - (a.preflightDurationMs ?? 0),
      );
    case "domain_asc":
      return [...filtered].sort((a, b) => {
        const da = (a.preflightFinalUrl ?? a.websiteUrl ?? "").toLowerCase();
        const db = (b.preflightFinalUrl ?? b.websiteUrl ?? "").toLowerCase();
        return da.localeCompare(db);
      });
    case "upload_order":
    default:
      return [...filtered].sort((a, b) => a.rowIndex - b.rowIndex);
  }
}

/**
 * Convenience-Helper: gibt alle problematischen Lead-IDs der aktuell
 * gefilterten Liste zurück — gebraucht für die "F"-Shortcut-Aktion.
 */
export function pickProblematicIds(
  leads: ReadonlyArray<PreflightLead>,
): string[] {
  return leads
    .filter((l) => !l.removedAt && isProblematic(l.preflightStatus))
    .map((l) => l.id);
}

// Re-export Status-Label für Konsumenten, die ohne lead-card-Import
// auskommen wollen.
export { STATUS_LABEL };
