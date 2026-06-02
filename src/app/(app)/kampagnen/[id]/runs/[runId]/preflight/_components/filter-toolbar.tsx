"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  isProblematic,
  severityOf,
  type PreflightLead,
  type PreflightStatus,
} from "./lead-card";

/**
 * Filter-Modell:
 *   activeFilters ist eine Set-ähnliche Liste von Filter-Keys.
 *   Spezielle Keys:
 *     "all"          → kein Filter
 *     "problematic"  → alle Karten mit !ok && !pending && !running
 *     <PreflightStatus> → exakt dieser Status
 *
 * Mehrfach-Filter sind kombinierbar (Multi-Select), die OR-Semantik gilt.
 */
export type FilterKey = "all" | "problematic" | PreflightStatus;

export type SortKey =
  | "problems_first"
  | "duration_desc"
  | "domain_asc"
  | "upload_order";

const SORT_LABEL: Record<SortKey, string> = {
  problems_first: "Probleme zuerst",
  duration_desc: "Ladezeit absteigend",
  domain_asc: "Domain A–Z",
  upload_order: "Upload-Reihenfolge",
};

const PRIMARY_FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: "problematic", label: "Problematisch" },
  { key: "all", label: "Alle" },
  { key: "ok", label: "OK" },
];

const STATUS_FILTERS: ReadonlyArray<{ key: PreflightStatus; label: string }> = [
  { key: "url_dead", label: "Tote URLs" },
  { key: "tls_error", label: "TLS-Fehler" },
  { key: "url_redirect", label: "Umleitungen" },
  { key: "slow", label: "Langsam" },
  { key: "bot_block", label: "Bot-Block" },
  { key: "missing_field", label: "Daten unvollständig" },
  { key: "duplicate", label: "Duplikate" },
  { key: "screenshot_unavailable", label: "Screenshot fehlt" },
  { key: "unknown_error", label: "Fehler" },
];

export interface FilterToolbarProps {
  /** Volle Lead-Liste — wir berechnen daraus die Chip-Counts. */
  leads: ReadonlyArray<PreflightLead>;
  activeFilters: ReadonlySet<FilterKey>;
  searchQuery: string;
  sort: SortKey;
  onToggleFilter: (key: FilterKey) => void;
  onSearchChange: (q: string) => void;
  onSortChange: (s: SortKey) => void;
}

export function FilterToolbar({
  leads,
  activeFilters,
  searchQuery,
  sort,
  onToggleFilter,
  onSearchChange,
  onSortChange,
}: FilterToolbarProps) {
  // Counts cachen — bei 500 Leads ist das eine schnelle Reduce-Schleife,
  // aber wir vermeiden das pro Render mit useMemo.
  const counts = React.useMemo(() => {
    const c = {
      all: 0,
      problematic: 0,
      ok: 0,
      pending: 0,
      running: 0,
      url_dead: 0,
      tls_error: 0,
      url_redirect: 0,
      slow: 0,
      bot_block: 0,
      missing_field: 0,
      duplicate: 0,
      screenshot_unavailable: 0,
      unknown_error: 0,
    } satisfies Record<string, number>;
    for (const lead of leads) {
      if (lead.removedAt) continue; // entfernte Leads zählen nicht
      c.all += 1;
      const s = lead.preflightStatus;
      if (s === "ok") c.ok += 1;
      else if (s === "pending") c.pending += 1;
      else if (s === "running") c.running += 1;
      else {
        // alle terminalen Nicht-OK-Status sind problematisch
        c.problematic += 1;
        if (s in c) (c as Record<string, number>)[s] += 1;
      }
    }
    return c;
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
    <div className="flex flex-col gap-3">
      {/* Primary Filter-Row */}
      <div className="flex flex-wrap items-center gap-2">
        {PRIMARY_FILTERS.map(({ key, label }) => {
          const count =
            key === "all"
              ? counts.all
              : key === "problematic"
                ? counts.problematic
                : counts.ok;
          return (
            <FilterChip
              key={key}
              label={label}
              count={count}
              active={activeFilters.has(key)}
              variant={
                key === "problematic"
                  ? "warn"
                  : key === "ok"
                    ? "success"
                    : "neutral"
              }
              onClick={() => onToggleFilter(key)}
            />
          );
        })}
        <span className="hidden sm:inline-block h-5 w-px bg-line mx-1" />
        {STATUS_FILTERS.map(({ key, label }) => {
          const count = (counts as Record<string, number>)[key] ?? 0;
          if (count === 0 && !activeFilters.has(key)) return null;
          const sev = severityOf(key);
          return (
            <FilterChip
              key={key}
              label={label}
              count={count}
              active={activeFilters.has(key)}
              variant={
                sev === "danger"
                  ? "danger"
                  : sev === "warn"
                    ? "warn"
                    : "neutral"
              }
              onClick={() => onToggleFilter(key)}
            />
          );
        })}
      </div>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 max-w-md">
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
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">
            Sortieren
          </span>
          <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
            <SelectTrigger className="h-9 min-w-[180px] text-sm">
              <SelectValue placeholder="Sortieren" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  variant: "neutral" | "warn" | "danger" | "success";
  onClick: () => void;
}

const variantInactive: Record<FilterChipProps["variant"], string> = {
  neutral: "bg-surface text-ink-soft border-line hover:bg-surface-muted",
  warn: "bg-surface text-ink-soft border-warn/30 hover:bg-warn/5",
  danger: "bg-surface text-ink-soft border-danger/30 hover:bg-danger/5",
  success: "bg-surface text-ink-soft border-line hover:bg-surface-muted",
};

const variantActive: Record<FilterChipProps["variant"], string> = {
  neutral: "bg-brand-soft text-brand-deep border-brand/40",
  warn: "bg-warn/10 text-warn border-warn/40",
  danger: "bg-danger/10 text-danger border-danger/40",
  success: "bg-ok-soft text-ok border-ok/40",
};

function FilterChip({
  label,
  count,
  active,
  variant,
  onClick,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-full border text-xs font-semibold transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        active ? variantActive[variant] : variantInactive[variant],
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center",
          active
            ? "bg-white/60 text-current"
            : "bg-surface-muted text-ink-muted",
        )}
      >
        {count}
      </span>
    </button>
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
