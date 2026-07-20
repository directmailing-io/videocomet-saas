"use client";

import * as React from "react";
import {
  Activity,
  CircleAlert,
  Download,
  Loader2,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { FeedRow } from "./_components/feed-row";
import { FilterToolbar } from "./_components/filter-toolbar";
import { StatsRail } from "./_components/stats-rail";
import { LeadDrawer } from "./_components/lead-drawer";
import { useActivityStream } from "./_components/use-activity-stream";
import { useKeyboardShortcuts } from "./_components/use-keyboard-shortcuts";
import type { ActivityKind } from "./_components/event-icon";
import type { LeadTemperature } from "./_components/temperature-badge";
import type { FunnelResult } from "./_components/funnel-card";

// ─────────────────────────────────────────────────────────────────────
// PUBLIC TYPES — exakt aus dem Briefing.
// ─────────────────────────────────────────────────────────────────────

/**
 * ActivityFeedRow — der Vertrag den Agent 1 fixiert hat. Reasonable
 * Anpassungen: alle Felder optional als null möglich (Backend kann fehlen).
 */
export interface ActivityFeedRow {
  eventId: string;
  ts: string;
  kind: ActivityKind;
  payload: Record<string, unknown>;
  sessionId: string | null;
  lead: {
    id: string;
    name: string;
    companyName: string;
    slug: string;
    temperature: LeadTemperature;
  };
  run: {
    id: string;
    name: string;
  } | null;
  campaign: {
    id: string;
    name: string;
  } | null;
}

export interface ActivityCounts {
  total: number;
  uniqueLeads: number;
  byKind: Partial<Record<ActivityKind, number>>;
  byTemperature: Partial<Record<LeadTemperature, number>>;
}

export interface LeadDrawerData {
  email: string | null;
  stats: {
    pageViews: number;
    watchTimeSec: number;
    ctaClicks: number;
    sessions: number;
  };
  events: Array<{
    eventId: string;
    ts: string;
    kind: ActivityKind;
    payload: Record<string, unknown>;
  }>;
}

export type ActivityScope = "global" | "campaign" | "run";
export type DateRangeKey = "today" | "7d" | "30d" | "custom";
export type KindFilter = "all" | ActivityKind;
export type TemperatureFilter = "all" | LeadTemperature;

export interface SavedView {
  id: string;
  name: string;
  filters: {
    kind: KindFilter;
    temperature: TemperatureFilter;
    dateRange: DateRangeKey;
    search: string;
  };
  createdAt: string;
}

export interface ActivityCenterProps {
  scope: ActivityScope;
  campaignId?: string;
  campaignName?: string;
  runId?: string;
  runName?: string;
  /** Wenn true, Topbar (Page-Header) wird unterdrückt — Eltern-Page hat einen. */
  embedded?: boolean;
}

const PAGE_LIMIT = 50;

/**
 * Backend-Funnel-Response auf FunnelCard-Erwartung mappen.
 * Akzeptiert sowohl das aktuelle Backend-Shape (`steps`/`kind`/`pct`) als auch
 * ein potenziell aelteres/neueres (`stages`/`key`/`percent`). Wenn nix passt,
 * liefern wir `{ stages: [] }` — FunnelCard rendert dann seinen leeren State.
 */
function normalizeFunnelResponse(raw: unknown): FunnelResult {
  if (!raw || typeof raw !== "object") return { stages: [] };
  const obj = raw as Record<string, unknown>;
  const source =
    (Array.isArray(obj.stages) ? obj.stages : null) ??
    (Array.isArray(obj.steps) ? obj.steps : null);
  if (!source) return { stages: [] };
  const stages = source
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return null;
      const s = item as Record<string, unknown>;
      const key = String(s.key ?? s.kind ?? "");
      const label = String(s.label ?? "");
      const count = typeof s.count === "number" ? s.count : 0;
      // Backend liefert pct als 0..100. FunnelCard's `percent` ist 0..1.
      let percent: number | undefined;
      if (typeof s.percent === "number") {
        percent = s.percent;
      } else if (typeof s.pct === "number") {
        percent = s.pct / 100;
      }
      return { key, label, count, percent };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  return { stages };
}
const SAVED_VIEWS_KEY = "videocomet.activity.savedViews.v1";

// ─────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────

export function ActivityCenter({
  scope,
  campaignId,
  campaignName,
  runId,
  runName,
  embedded = false,
}: ActivityCenterProps) {
  const { toast } = useToast();
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const liveRegionRef = React.useRef<HTMLDivElement | null>(null);

  // ── Filter-State ──────────────────────────────────────────────────
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const [temperatureFilter, setTemperatureFilter] =
    React.useState<TemperatureFilter>("all");
  const [dateRange, setDateRange] = React.useState<DateRangeKey>("today");
  const [search, setSearch] = React.useState("");

  // ── Data-State ────────────────────────────────────────────────────
  const [rows, setRows] = React.useState<ActivityFeedRow[]>([]);
  const [counts, setCounts] = React.useState<ActivityCounts | null>(null);
  const [funnel, setFunnel] = React.useState<FunnelResult | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingState, setLoadingState] = React.useState<
    "initial" | "ready" | "error"
  >("initial");
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [newRowIds, setNewRowIds] = React.useState<Set<string>>(new Set());

  // ── UI-State ──────────────────────────────────────────────────────
  const [focusedIdx, setFocusedIdx] = React.useState<number>(-1);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerData, setDrawerData] = React.useState<
    LeadDrawerData | "error" | null
  >(null);
  const [drawerLoading, setDrawerLoading] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);

  // ── Saved Views: laden aus localStorage ───────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedView[];
      if (Array.isArray(parsed)) setSavedViews(parsed);
    } catch {
      /* ignore — kaputter Storage darf die App nicht crashen */
    }
  }, []);

  // ── Query-String bauen ────────────────────────────────────────────
  const queryString = React.useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", scope);
    if (campaignId) p.set("campaignId", campaignId);
    if (runId) p.set("runId", runId);
    if (kindFilter !== "all") p.set("kind", kindFilter);
    if (temperatureFilter !== "all") p.set("temperature", temperatureFilter);
    if (dateRange !== "custom") {
      // Defense-in-Depth: ein kaputter Date-Konstruktor (z.B. exotische
      // Browser-Locale) darf nicht die gesamte Seite crashen.
      try {
        const { from, to } = computeDateRange(dateRange);
        if (from) p.set("from", from);
        if (to) p.set("to", to);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[activity-center] computeDateRange threw:", err);
      }
    }
    if (search.trim().length > 0) p.set("search", search.trim());
    p.set("limit", String(PAGE_LIMIT));
    return p.toString();
  }, [scope, campaignId, runId, kindFilter, temperatureFilter, dateRange, search]);

  // ── Feed laden (initial + bei Filter-Wechsel) ─────────────────────
  React.useEffect(() => {
    let cancelled = false;
    setLoadingState("initial");
    setFocusedIdx(-1);

    (async () => {
      try {
        const [feedRes, countsRes] = await Promise.allSettled([
          fetch(`/api/activity/feed?${queryString}`, { cache: "no-store" }),
          fetch(`/api/activity/counts?${queryString}`, { cache: "no-store" }),
        ]);

        if (cancelled) return;

        // Feed (Pflicht)
        if (feedRes.status === "fulfilled" && feedRes.value.ok) {
          try {
            const data = (await feedRes.value.json()) as {
              rows?: ActivityFeedRow[];
              nextCursor?: string | null;
            };
            setRows(Array.isArray(data?.rows) ? data.rows : []);
            setNextCursor(data?.nextCursor ?? null);
            setLoadingState("ready");
          } catch {
            setRows([]);
            setNextCursor(null);
            setLoadingState("error");
          }
        } else {
          setRows([]);
          setNextCursor(null);
          setLoadingState("error");
        }

        // Counts (best-effort — Feed darf auch ohne sie rendern)
        if (countsRes.status === "fulfilled" && countsRes.value.ok) {
          try {
            const c = (await countsRes.value.json()) as ActivityCounts;
            // Sanity: nur setzen wenn das Shape grob passt — sonst crasht
            // counts.total.toLocaleString() im Topbar.
            if (c && typeof c === "object" && typeof c.total === "number") {
              setCounts(c);
            }
          } catch {
            /* counts sind best-effort — Feed läuft auch ohne */
          }
        }
      } catch {
        if (!cancelled) setLoadingState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryString]);

  // ── Funnel laden (nur Kampagne/Run-Scope) ─────────────────────────
  React.useEffect(() => {
    if (scope === "global") {
      setFunnel(null);
      return;
    }
    let cancelled = false;
    const p = new URLSearchParams();
    if (scope === "campaign" && campaignId) {
      p.set("scope", "campaign");
      p.set("campaignId", campaignId);
    } else if (scope === "run" && runId) {
      p.set("scope", "run");
      p.set("runId", runId);
    } else {
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/activity/funnel?${p.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const raw = (await res.json()) as unknown;
        // Backend liefert { scope, totalLeads, steps: [{kind,label,count,pct}] }
        // FunnelCard erwartet { stages: [{key,label,count,percent}] }.
        // Wir normalisieren beim Fetch damit die UI sich nicht mit dem
        // Backend-Shape rumschlagen muss.
        const normalized = normalizeFunnelResponse(raw);
        if (!cancelled) setFunnel(normalized);
      } catch {
        /* funnel ist Bonus — error ist kein Show-Stopper */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, campaignId, runId]);

  // ── SSE-Stream ────────────────────────────────────────────────────
  const { state: streamState, reconnect } = useActivityStream({
    queryString,
    enabled: loadingState !== "initial",
    onAppend: React.useCallback((row: ActivityFeedRow) => {
      // Defense-in-Depth: ein malformed SSE-Payload darf die Liste nicht
      // zerschießen. Mindestens eventId + lead-objekt sind Pflicht — sonst
      // crasht der FeedRow-Render an `row.lead.name`.
      if (!row || typeof row !== "object" || !row.eventId || !row.lead) {
        return;
      }
      setRows((prev) => {
        // Duplikate vermeiden — Backend sendet zwar IDs, aber besser safe.
        if (prev.some((r) => r.eventId === row.eventId)) return prev;
        return [row, ...prev];
      });
      setNewRowIds((prev) => {
        const next = new Set(prev);
        next.add(row.eventId);
        return next;
      });
      // ARIA-Live: subtile Ankündigung für Screen-Reader.
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `Neue Aktivität: ${
          row.lead.name || row.lead.companyName || "Lead"
        }`;
      }
      // Fade-out nach 1.2s — neuer Highlight verschwindet.
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          setNewRowIds((prev) => {
            if (!prev.has(row.eventId)) return prev;
            const next = new Set(prev);
            next.delete(row.eventId);
            return next;
          });
        }, 1200);
      }
    }, []),
    onCounts: React.useCallback((c: ActivityCounts) => {
      // Sanity-Check: kaputtes Payload würde sonst Topbar/StatsRail crashen.
      if (c && typeof c === "object" && typeof c.total === "number") {
        setCounts(c);
      }
    }, []),
  });

  // ── Pagination: Load-More on Scroll-Bottom ────────────────────────
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!nextCursor) return;
    const node = sentinelRef.current;
    if (!node) return;
    let busy = false;

    const observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || busy || !nextCursor) return;
        busy = true;
        setLoadingMore(true);
        try {
          const p = new URLSearchParams(queryString);
          p.set("cursor", nextCursor);
          const res = await fetch(`/api/activity/feed?${p.toString()}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const data = (await res.json()) as {
              rows: ActivityFeedRow[];
              nextCursor: string | null;
            };
            setRows((prev) => [...prev, ...(data.rows ?? [])]);
            setNextCursor(data.nextCursor ?? null);
          }
        } catch {
          /* ignore — User kann scrollen und retry */
        } finally {
          setLoadingMore(false);
          busy = false;
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nextCursor, queryString]);

  // ── Lead-Drawer: bei Selektion lazy-load ──────────────────────────
  const selectedRow = focusedIdx >= 0 ? rows[focusedIdx] ?? null : null;

  const loadDrawerData = React.useCallback(
    async (leadId: string) => {
      setDrawerLoading(true);
      setDrawerData(null);
      try {
        // Wir greifen den Lead-spezifischen Feed über den bestehenden
        // Endpoint ab — Agent 2 macht das auch verfügbar wenn man
        // ?leadId=... mitgibt. Falls nicht implementiert, fällt das
        // graceful auf Error.
        const p = new URLSearchParams();
        p.set("scope", "lead");
        p.set("leadId", leadId);
        p.set("limit", "200");
        const res = await fetch(`/api/activity/feed?${p.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setDrawerData("error");
          return;
        }
        const data = (await res.json()) as {
          rows: ActivityFeedRow[];
          email?: string | null;
          stats?: LeadDrawerData["stats"];
        };
        const events = (data.rows ?? []).map((r) => ({
          eventId: r.eventId,
          ts: r.ts,
          kind: r.kind,
          payload: r.payload,
        }));
        const fallbackStats = computeFallbackStats(data.rows ?? []);
        setDrawerData({
          email: data.email ?? null,
          stats: data.stats ?? fallbackStats,
          events,
        });
      } catch {
        setDrawerData("error");
      } finally {
        setDrawerLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!drawerOpen || !selectedRow) return;
    void loadDrawerData(selectedRow.lead.id);
  }, [drawerOpen, selectedRow, loadDrawerData]);

  // ── Tastatur-Shortcuts ────────────────────────────────────────────
  const moveFocus = React.useCallback(
    (dir: "prev" | "next") => {
      setFocusedIdx((idx) => {
        const max = rows.length - 1;
        if (max < 0) return -1;
        let next = idx + (dir === "next" ? 1 : -1);
        if (idx < 0) next = dir === "next" ? 0 : max;
        next = Math.max(0, Math.min(max, next));
        // Scroll ins View
        window.requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-feed-idx="${next}"]`,
          );
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          el?.focus({ preventScroll: true });
        });
        return next;
      });
    },
    [rows.length],
  );

  const cycleTemperature = React.useCallback((t: LeadTemperature) => {
    setTemperatureFilter((cur) => (cur === t ? "all" : t));
  }, []);

  useKeyboardShortcuts({
    ArrowDown: () => moveFocus("next"),
    ArrowUp: () => moveFocus("prev"),
    Enter: () => {
      if (focusedIdx >= 0 && rows[focusedIdx]) setDrawerOpen(true);
    },
    Escape: () => {
      if (drawerOpen) setDrawerOpen(false);
      else if (exportOpen) setExportOpen(false);
    },
    "Mod+e": () => setExportOpen(true),
    "/": () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    "1": () => cycleTemperature("hot"),
    "2": () => cycleTemperature("engaged"),
    "3": () => cycleTemperature("warm"),
    "4": () => cycleTemperature("cold"),
    "5": () => cycleTemperature("inactive"),
  });

  // ── Saved-Views: persist helper ───────────────────────────────────
  const persistViews = React.useCallback((views: SavedView[]) => {
    setSavedViews(views);
    try {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    } catch {
      /* Storage voll oder disabled — kein Show-Stopper */
    }
  }, []);

  const handleSaveCurrentView = React.useCallback(() => {
    const name = window.prompt(
      "Name für diese Ansicht?",
      defaultViewName({ kindFilter, temperatureFilter, dateRange, search }),
    );
    if (!name) return;
    const view: SavedView = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      name: name.trim().slice(0, 60),
      filters: {
        kind: kindFilter,
        temperature: temperatureFilter,
        dateRange,
        search,
      },
      createdAt: new Date().toISOString(),
    };
    persistViews([view, ...savedViews]);
    toast({
      title: "Ansicht gespeichert",
      description: `„${view.name}" steht jetzt unter Saved Views.`,
      variant: "success",
    });
  }, [
    kindFilter,
    temperatureFilter,
    dateRange,
    search,
    savedViews,
    persistViews,
    toast,
  ]);

  const handleApplySavedView = React.useCallback(
    (id: string) => {
      const view = savedViews.find((v) => v.id === id);
      if (!view) return;
      setKindFilter(view.filters.kind);
      setTemperatureFilter(view.filters.temperature);
      setDateRange(view.filters.dateRange);
      setSearch(view.filters.search);
    },
    [savedViews],
  );

  const handleDeleteSavedView = React.useCallback(
    (id: string) => {
      persistViews(savedViews.filter((v) => v.id !== id));
    },
    [savedViews, persistViews],
  );

  // ── Export ────────────────────────────────────────────────────────
  const exportHref = `/api/activity/export?${queryString}`;

  // ── Render ────────────────────────────────────────────────────────
  const showFunnel = scope === "campaign" || scope === "run";

  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <ActivityTopbar
          counts={counts}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onExport={() => setExportOpen(true)}
          streamState={streamState}
          onReconnect={reconnect}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 lg:gap-6">
        <StatsRail
          counts={counts}
          activeTemperature={temperatureFilter}
          onTemperatureChange={setTemperatureFilter}
          funnel={funnel}
          showFunnel={showFunnel}
        />

        <section className="min-w-0 flex flex-col bg-surface rounded-squircle-md shadow-card overflow-hidden">
          <FilterToolbar
            searchQuery={search}
            onSearchChange={setSearch}
            activeKind={kindFilter}
            onKindChange={setKindFilter}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            counts={counts}
            savedViews={savedViews}
            onApplySavedView={handleApplySavedView}
            onSaveCurrentView={handleSaveCurrentView}
            onDeleteSavedView={handleDeleteSavedView}
            searchInputRef={searchInputRef}
            scopeLocked={embedded}
          />

          {/* Sticky-Header für Scope-Kontext (im Tab-Mode) */}
          {embedded && (
            <div className="px-4 sm:px-6 py-2 text-xs text-ink-muted bg-surface-soft border-b border-line-soft">
              {scope === "campaign" && campaignName
                ? `Scope: Kampagne · ${campaignName}`
                : scope === "run" && runName
                  ? `Scope: Runde · ${runName}`
                  : null}
            </div>
          )}

          <div
            role="grid"
            aria-label="Aktivitäts-Feed"
            aria-rowcount={rows.length}
            className="flex-1"
          >
            {loadingState === "initial" && (
              <FeedSkeleton />
            )}

            {loadingState === "error" && rows.length === 0 && (
              <EmptyState
                icon={<CircleAlert />}
                title="Verbindung fehlgeschlagen"
                subtitle="Die Aktivität konnte nicht geladen werden. Bitte versuchen Sie es erneut."
                action={
                  <Button onClick={() => reconnect()}>Erneut versuchen</Button>
                }
              />
            )}

            {loadingState === "ready" && rows.length === 0 && (
              <EmptyState
                icon={<Activity />}
                title="Noch keine Aktivität"
                subtitle="Sobald Empfänger Ihre Landingpages besuchen, erscheinen die Events hier in Echtzeit."
              />
            )}

            {rows.length > 0 && (
              <ul role="rowgroup" className="flex flex-col">
                {rows.map((row, idx) => (
                  <li
                    key={row.eventId}
                    data-feed-idx={idx}
                    role="presentation"
                  >
                    <FeedRow
                      row={row}
                      focused={idx === focusedIdx}
                      isNew={newRowIds.has(row.eventId)}
                      onSelect={() => {
                        setFocusedIdx(idx);
                        setDrawerOpen(true);
                      }}
                      onFocus={() => setFocusedIdx(idx)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* Sentinel für Infinite-Scroll */}
            {nextCursor && (
              <div
                ref={sentinelRef}
                className="flex items-center justify-center h-12 text-xs text-ink-muted"
                aria-hidden="true"
              >
                {loadingMore && (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Mehr laden…
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ARIA-Live für neue SSE-Events */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <LeadDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setDrawerData(null);
        }}
        selectedRow={selectedRow}
        data={drawerData}
        loading={drawerLoading}
        onNavigate={(dir) => moveFocus(dir)}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        counts={counts}
        href={exportHref}
        filterSummary={summarizeFilters({
          kindFilter,
          temperatureFilter,
          dateRange,
          search,
          campaignName,
          runName,
          scope,
        })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TOPBAR
// ─────────────────────────────────────────────────────────────────────

function ActivityTopbar({
  counts,
  dateRange,
  onDateRangeChange,
  onExport,
  streamState,
  onReconnect,
}: {
  counts: ActivityCounts | null;
  dateRange: DateRangeKey;
  onDateRangeChange: (r: DateRangeKey) => void;
  onExport: () => void;
  streamState: "connecting" | "live" | "error" | "off";
  onReconnect: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-2">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-ink leading-tight">
            Aktivität
          </h1>
          <StreamPill state={streamState} onReconnect={onReconnect} />
        </div>
        <p className="text-sm text-ink-muted leading-relaxed">
          {counts
            ? `${formatNumber(counts.total)} Events · ${formatNumber(counts.uniqueLeads)} Leads`
            : streamState === "connecting"
              ? "Lädt Übersicht…"
              : "0 Events · 0 Leads"}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1 rounded-full bg-surface-muted p-0.5">
          {(
            [
              { key: "today", label: "Heute" },
              { key: "7d", label: "7 Tage" },
              { key: "30d", label: "30 Tage" },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onDateRangeChange(p.key)}
              aria-pressed={dateRange === p.key}
              className={cn(
                "h-8 px-3 rounded-full text-xs font-semibold transition-colors",
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
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Download className="size-3.5" />}
          onClick={onExport}
        >
          Export
        </Button>
      </div>
    </div>
  );
}

function StreamPill({
  state,
  onReconnect,
}: {
  state: "connecting" | "live" | "error" | "off";
  onReconnect: () => void;
}) {
  const dotColor =
    state === "live"
      ? "bg-ok"
      : state === "connecting"
        ? "bg-warn"
        : state === "error"
          ? "bg-danger"
          : "bg-ink-muted";
  const label =
    state === "live"
      ? "Live"
      : state === "connecting"
        ? "Verbindet…"
        : state === "error"
          ? "Getrennt"
          : "Aus";

  return (
    <button
      type="button"
      onClick={() => {
        if (state === "error" || state === "off") onReconnect();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 shadow-card",
        "text-[11px] font-semibold text-ink-soft",
        (state === "error" || state === "off") &&
          "cursor-pointer hover:bg-surface-muted",
      )}
      aria-label={`Stream-Status: ${label}`}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          dotColor,
          state === "live" && "animate-pulse",
        )}
      />
      <Radio className="size-3 opacity-50" />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EXPORT-DIALOG
// ─────────────────────────────────────────────────────────────────────

function ExportDialog({
  open,
  onOpenChange,
  counts,
  href,
  filterSummary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: ActivityCounts | null;
  href: string;
  filterSummary: string;
}) {
  const anchorRef = React.useRef<HTMLAnchorElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aktivität exportieren</DialogTitle>
          <DialogDescription>
            Format: CSV. Die Datei enthält alle Events der aktuellen Auswahl.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-squircle-sm bg-surface-soft px-4 py-3 text-sm">
          <p className="font-semibold text-ink mb-1">
            {counts
              ? `${formatNumber(counts.total)} Events · ${formatNumber(counts.uniqueLeads)} Leads`
              : "Auswahl wird berechnet…"}
          </p>
          <p className="text-xs text-ink-muted">Filter: {filterSummary}</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            asChild
            iconLeft={<Download className="size-4" />}
            onClick={() => {
              // Browser triggert Download via <a download>
              window.setTimeout(() => onOpenChange(false), 200);
            }}
          >
            <a ref={anchorRef} href={href} download>
              Herunterladen
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FEED-SKELETON
// ─────────────────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <ul className="flex flex-col" aria-label="Aktivität wird geladen">
      {Array.from({ length: 8 }).map((_, i) => (
        <li
          key={i}
          className="h-14 px-3 sm:px-4 flex items-center gap-3 border-b border-line-soft"
        >
          <span className="w-12 h-3 bg-surface-muted rounded animate-pulse" />
          <span className="size-8 rounded-full bg-surface-muted animate-pulse" />
          <span className="flex-1 flex flex-col gap-1.5">
            <span className="h-3 w-1/3 bg-surface-muted rounded animate-pulse" />
            <span className="h-2 w-1/2 bg-surface-muted rounded animate-pulse" />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * `Number#toLocaleString` crasht zwar nicht direkt, aber unser API-Vertrag
 * verspricht ein `number`, und JSON-Parsing einer kaputten Response könnte
 * uns ein `undefined`/`null` unterjubeln. Defense-in-Depth: Coerce zu 0.
 */
function formatNumber(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  try {
    return n.toLocaleString("de-DE");
  } catch {
    return String(Math.trunc(n));
  }
}

function computeDateRange(key: DateRangeKey): { from: string; to: string } {
  const now = new Date();
  // `to` immer auf Ende des aktuellen Tages legen — nicht auf `now`. Sonst
  // werden Events, die NACH dem Verbindungs-Aufbau eintreffen, vom Filter
  // ausgeschlossen (`event.ts > to`) und Du musst reloaden um sie zu sehen.
  // Der Server-SSE-Tick bumpt das `to` zusätzlich auf jedem Poll auf live
  // `now`, damit auch Sessions, die über Mitternacht laufen, korrekt sind.
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  if (key === "today") {
    from.setHours(0, 0, 0, 0);
  } else if (key === "7d") {
    from.setDate(now.getDate() - 7);
    from.setHours(0, 0, 0, 0);
  } else if (key === "30d") {
    from.setDate(now.getDate() - 30);
    from.setHours(0, 0, 0, 0);
  }
  // Sanity-Check: ungültige Daten (z.B. NaN nach Date-Math) dürfen nicht
  // als ISO-String erzwungen werden — `Date#toISOString` wirft dann
  // RangeError und crasht den Render.
  const safeFrom = Number.isFinite(from.getTime()) ? from : now;
  const safeTo = Number.isFinite(to.getTime()) ? to : now;
  return { from: safeFrom.toISOString(), to: safeTo.toISOString() };
}

function computeFallbackStats(rows: ActivityFeedRow[]): LeadDrawerData["stats"] {
  let pageViews = 0;
  let watchTimeSec = 0;
  let ctaClicks = 0;
  const sessions = new Set<string>();
  for (const r of rows) {
    if (r.kind === "page_view") pageViews += 1;
    if (r.kind === "cta_click") ctaClicks += 1;
    if (r.sessionId) sessions.add(r.sessionId);
    if (r.kind === "time_on_page" && typeof r.payload?.seconds === "number") {
      watchTimeSec += r.payload.seconds as number;
    }
  }
  return { pageViews, watchTimeSec, ctaClicks, sessions: sessions.size };
}

function summarizeFilters(opts: {
  kindFilter: KindFilter;
  temperatureFilter: TemperatureFilter;
  dateRange: DateRangeKey;
  search: string;
  campaignName?: string;
  runName?: string;
  scope: ActivityScope;
}): string {
  const parts: string[] = [];
  if (opts.scope === "campaign" && opts.campaignName)
    parts.push(`Kampagne ${opts.campaignName}`);
  if (opts.scope === "run" && opts.runName)
    parts.push(`Runde ${opts.runName}`);
  if (opts.dateRange === "today") parts.push("Heute");
  else if (opts.dateRange === "7d") parts.push("letzte 7 Tage");
  else if (opts.dateRange === "30d") parts.push("letzte 30 Tage");
  if (opts.kindFilter !== "all") parts.push(`Kind: ${opts.kindFilter}`);
  if (opts.temperatureFilter !== "all")
    parts.push(`Temperatur: ${opts.temperatureFilter}`);
  if (opts.search.trim()) parts.push(`Suche: „${opts.search.trim()}"`);
  return parts.length ? parts.join(" · ") : "Alle Aktivitäten";
}

function defaultViewName(filters: {
  kindFilter: KindFilter;
  temperatureFilter: TemperatureFilter;
  dateRange: DateRangeKey;
  search: string;
}): string {
  const parts: string[] = [];
  if (filters.temperatureFilter === "hot") parts.push("Heiße Leads");
  else if (filters.temperatureFilter === "engaged") parts.push("Engaged Leads");
  else if (filters.temperatureFilter === "warm") parts.push("Warme Leads");
  else parts.push("Ansicht");
  if (filters.dateRange === "today") parts.push("heute");
  else if (filters.dateRange === "7d") parts.push("diese Woche");
  else if (filters.dateRange === "30d") parts.push("letzte 30 Tage");
  return parts.join(" ");
}
