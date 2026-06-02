"use client";

import * as React from "react";
import { Bookmark, BookmarkPlus, ChevronDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  ActivityCounts,
  DateRangeKey,
  KindFilter,
  SavedView,
} from "../activity-center";

/**
 * FilterToolbar — sticky-row über dem Feed. Linear-tight, eine Akzentfarbe
 * (brand) für aktive Chips, sonst muted greys. Suchfeld debounced 200ms
 * an den Parent, exakt wie in der Preflight-Toolbar.
 */

const DATE_PRESETS: Array<{ key: DateRangeKey; label: string }> = [
  { key: "today", label: "Heute" },
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
];

const KIND_CHIPS: Array<{ key: KindFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "page_view", label: "Page-Views" },
  { key: "video_play", label: "Video gestartet" },
  { key: "video_progress", label: "Video gesehen" },
  { key: "video_ended", label: "Video beendet" },
  { key: "cta_click", label: "CTA-Klicks" },
  { key: "link_click", label: "Link-Klicks" },
  { key: "scroll_depth", label: "Scroll" },
];

export interface FilterToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeKind: KindFilter;
  onKindChange: (k: KindFilter) => void;
  dateRange: DateRangeKey;
  onDateRangeChange: (r: DateRangeKey) => void;
  counts: ActivityCounts | null;
  savedViews: SavedView[];
  onApplySavedView: (id: string) => void;
  onSaveCurrentView: () => void;
  onDeleteSavedView: (id: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Im Tab-Mode locken wir den Scope (kein Date-Picker am Toolbar-Header) */
  scopeLocked?: boolean;
}

export function FilterToolbar({
  searchQuery,
  onSearchChange,
  activeKind,
  onKindChange,
  dateRange,
  onDateRangeChange,
  counts,
  savedViews,
  onApplySavedView,
  onSaveCurrentView,
  onDeleteSavedView,
  searchInputRef,
  scopeLocked,
}: FilterToolbarProps) {
  const [localSearch, setLocalSearch] = React.useState(searchQuery);

  // Debounce 200ms an den Parent — identische Pattern wie preflight.
  React.useEffect(() => setLocalSearch(searchQuery), [searchQuery]);
  React.useEffect(() => {
    if (localSearch === searchQuery) return;
    const t = window.setTimeout(() => onSearchChange(localSearch), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const kindCounts = counts?.byKind ?? {};

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-surface/95 backdrop-blur border-b border-line">
      <div className="flex flex-col gap-3">
        {/* Row 1: Kind-Chips + Date + Saved Views */}
        <div className="flex flex-wrap items-center gap-2">
          {KIND_CHIPS.map(({ key, label }) => {
            const count =
              key === "all"
                ? counts?.total ?? 0
                : (kindCounts as Record<string, number>)[key] ?? 0;
            // Zero-Kinds (außer 'all') verstecken wir um die Toolbar ruhig zu halten,
            // außer der User hat sie gerade aktiv selektiert.
            if (key !== "all" && count === 0 && activeKind !== key) return null;
            return (
              <Chip
                key={key}
                label={label}
                count={count}
                active={activeKind === key}
                onClick={() => onKindChange(key)}
              />
            );
          })}

          <span className="flex-1" />

          {!scopeLocked && (
            <div className="flex items-center gap-1 rounded-full bg-surface-muted p-0.5">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onDateRangeChange(p.key)}
                  aria-pressed={dateRange === p.key}
                  className={cn(
                    "h-7 px-3 rounded-full text-xs font-semibold transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    dateRange === p.key
                      ? "bg-surface text-ink shadow-card"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <SavedViewsMenu
            views={savedViews}
            onApply={onApplySavedView}
            onSaveCurrent={onSaveCurrentView}
            onDelete={onDeleteSavedView}
          />
        </div>

        {/* Row 2: Search */}
        <div className="flex items-center gap-3">
          <div className="flex-1 max-w-md">
            <Input
              // Callback-Ref, weil das primitive Input nicht-nullable Refs
              // typisiert hat. Wir spiegeln das Element in den optionalen
              // Parent-Ref.
              ref={(el) => {
                if (searchInputRef) {
                  (
                    searchInputRef as React.MutableRefObject<HTMLInputElement | null>
                  ).current = el;
                }
              }}
              type="search"
              placeholder="Name, Firma, Domain…"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              icon={<Search />}
              aria-label="Aktivität durchsuchen"
              className="h-9 py-2"
            />
          </div>
          {counts && (
            <p className="text-xs text-ink-muted truncate hidden sm:block">
              {counts.total.toLocaleString("de-DE")} Events
              {counts.uniqueLeads
                ? ` · ${counts.uniqueLeads.toLocaleString("de-DE")} Leads`
                : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function Chip({ label, count, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-full border text-xs font-semibold transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        active
          ? "bg-brand-soft text-brand-deep border-brand/40"
          : "bg-surface text-ink-soft border-line hover:bg-surface-muted",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center",
          active ? "bg-white/60 text-current" : "bg-surface-muted text-ink-muted",
        )}
      >
        {count.toLocaleString("de-DE")}
      </span>
    </button>
  );
}

interface SavedViewsMenuProps {
  views: SavedView[];
  onApply: (id: string) => void;
  onSaveCurrent: () => void;
  onDelete: (id: string) => void;
}

function SavedViewsMenu({ views, onApply, onSaveCurrent, onDelete }: SavedViewsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line bg-surface",
            "text-xs font-semibold text-ink-soft hover:bg-surface-muted transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          )}
          aria-label="Gespeicherte Ansichten"
        >
          <Bookmark className="size-3.5" />
          Saved Views
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Gespeicherte Ansichten</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {views.length === 0 ? (
          <div className="px-2 py-3 text-xs text-ink-muted">
            Noch keine gespeicherten Filter.
          </div>
        ) : (
          views.map((v) => (
            <SavedViewRow
              key={v.id}
              view={v}
              onApply={() => onApply(v.id)}
              onDelete={() => onDelete(v.id)}
            />
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSaveCurrent()}>
          <BookmarkPlus className="size-4 text-ink-muted" />
          Aktuelle Filter speichern
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SavedViewRow({
  view,
  onApply,
  onDelete,
}: {
  view: SavedView;
  onApply: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        onClick={onApply}
        className="flex-1 text-left px-2 py-1.5 text-sm text-ink rounded hover:bg-surface-muted truncate"
      >
        {view.name}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Ansicht „${view.name}" löschen`}
        className="p-1 rounded text-ink-muted hover:text-danger hover:bg-danger/10"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
