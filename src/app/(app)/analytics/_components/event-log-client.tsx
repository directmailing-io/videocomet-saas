"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  MousePointerClick,
  Play,
  Search,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fmtDateTimeSec,
  fmtDurationShort,
  kindLabel,
} from "./formatters";

interface CampaignOption {
  id: string;
  name: string;
}

interface EventListItem {
  id: string;
  ts: string;
  kind: string;
  payload: unknown;
  leadId: string;
  leadName: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
  runId: string;
}

type RangeKey = "today" | "7d" | "30d" | "all";

const ALL_KINDS: Array<{ key: string; label: string }> = [
  { key: "page_view", label: "Aufrufe" },
  { key: "video_play", label: "Plays" },
  { key: "video_progress", label: "Progress" },
  { key: "video_ended", label: "Beendet" },
  { key: "cta_click", label: "CTA-Klicks" },
];

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 30_000;

function rangeToFrom(range: RangeKey): Date | undefined {
  if (range === "all") return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d;
  const days = range === "7d" ? 7 : 30;
  d.setDate(d.getDate() - (days - 1));
  return d;
}

function KindIcon({ kind }: { kind: string }): React.JSX.Element {
  const cls = "size-3.5";
  switch (kind) {
    case "page_view":
      return <Eye className={cls} />;
    case "video_play":
      return <Play className={cls} />;
    case "video_progress":
      return <Square className={cls} />;
    case "video_ended":
      return <Flag className={cls} />;
    case "cta_click":
      return <MousePointerClick className={cls} />;
    default:
      return <Square className={cls} />;
  }
}

function kindBadgeClass(kind: string): string {
  switch (kind) {
    case "page_view":
      return "bg-brand-soft text-brand-deep";
    case "video_play":
      return "bg-ok-soft text-ok";
    case "video_progress":
      return "bg-surface-muted text-ink-muted border border-line";
    case "video_ended":
      return "bg-warn-soft text-warn";
    case "cta_click":
      return "bg-danger-soft text-danger";
    default:
      return "bg-surface-muted text-ink-muted border border-line";
  }
}

/**
 * Render a compact preview of an event payload. Different kinds carry
 * different keys (atSec/durationSec on progress, label/href on cta_click,
 * userAgent everywhere). We pick the most useful bits per kind.
 */
function renderPayloadPreview(kind: string, payload: unknown): React.ReactNode {
  if (!payload || typeof payload !== "object") return "—";
  const p = payload as Record<string, unknown>;

  if (kind === "video_progress" || kind === "video_ended" || kind === "video_play") {
    const at = typeof p.atSec === "number" ? p.atSec : Number(p.atSec);
    const dur = typeof p.durationSec === "number" ? p.durationSec : Number(p.durationSec);
    const hasAt = Number.isFinite(at);
    const hasDur = Number.isFinite(dur) && dur > 0;
    if (hasAt && hasDur) {
      return (
        <span className="text-ink-muted">
          bei {fmtDurationShort(at)} / Dauer {fmtDurationShort(dur)}
        </span>
      );
    }
    if (hasAt) return <span className="text-ink-muted">bei {fmtDurationShort(at)}</span>;
    if (hasDur) return <span className="text-ink-muted">Dauer {fmtDurationShort(dur)}</span>;
    return <span className="text-ink-muted">—</span>;
  }

  if (kind === "cta_click") {
    const label = typeof p.label === "string" ? p.label : null;
    const href = typeof p.href === "string" ? p.href : null;
    let host: string | null = null;
    if (href) {
      try {
        host = new URL(href).host;
      } catch {
        host = href;
      }
    }
    if (label && host) {
      return (
        <span>
          <span className="text-ink font-medium">{label}</span>
          <span className="text-ink-muted"> → {host}</span>
        </span>
      );
    }
    if (label) return <span className="text-ink font-medium">{label}</span>;
    if (host) return <span className="text-ink-muted">→ {host}</span>;
    return <span className="text-ink-muted">—</span>;
  }

  // page_view → show referrer host if present
  if (kind === "page_view") {
    const ref = typeof p.referrer === "string" ? p.referrer : null;
    if (ref) {
      try {
        return <span className="text-ink-muted">von {new URL(ref).host}</span>;
      } catch {
        return <span className="text-ink-muted">von {ref}</span>;
      }
    }
    return <span className="text-ink-muted">—</span>;
  }

  return <span className="text-ink-muted">—</span>;
}

export function EventLogClient({
  campaigns,
}: {
  campaigns: CampaignOption[];
}) {
  // Filters
  const [range, setRange] = React.useState<RangeKey>("7d");
  // null = all kinds selected (no `kinds` query param)
  const [activeKinds, setActiveKinds] = React.useState<Set<string> | null>(null);
  const [campaignId, setCampaignId] = React.useState<string>("__all__");
  const [q, setQ] = React.useState<string>("");
  const [qDebounced, setQDebounced] = React.useState<string>("");
  const [autoRefresh, setAutoRefresh] = React.useState<boolean>(false);

  const [page, setPage] = React.useState<number>(0);
  const [events, setEvents] = React.useState<EventListItem[]>([]);
  const [total, setTotal] = React.useState<number>(0);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  // Debounce free-text input.
  React.useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to first page whenever a filter changes.
  React.useEffect(() => {
    setPage(0);
  }, [range, activeKinds, campaignId, qDebounced]);

  const fetchEvents = React.useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (activeKinds && activeKinds.size > 0) {
          params.set("kinds", Array.from(activeKinds).join(","));
        }
        if (campaignId !== "__all__") params.set("campaignId", campaignId);
        const from = rangeToFrom(range);
        if (from) params.set("from", from.toISOString());
        if (qDebounced.trim()) params.set("q", qDebounced.trim());
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));

        const res = await fetch(`/api/analytics/events?${params.toString()}`, {
          signal,
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          events: EventListItem[];
          total: number;
        };
        setEvents(data.events);
        setTotal(data.total);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError("Events konnten nicht geladen werden.");
        setEvents([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [activeKinds, campaignId, range, qDebounced, page],
  );

  // Fetch on any filter / page change.
  React.useEffect(() => {
    const ctrl = new AbortController();
    void fetchEvents(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchEvents]);

  // Auto-refresh ticker — re-runs fetch on the same filters every 30s.
  React.useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void fetchEvents();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEvents]);

  function toggleKind(kind: string): void {
    setActiveKinds((prev) => {
      // null = "all kinds" → switching one off starts from the full set
      const base = prev ?? new Set(ALL_KINDS.map((k) => k.key));
      const next = new Set(base);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      // If all selected → collapse back to null (no kinds param).
      if (next.size === ALL_KINDS.length) return null;
      return next;
    });
  }

  function allKindsSelected(): boolean {
    return activeKinds == null;
  }

  function isKindActive(kind: string): boolean {
    if (activeKinds == null) return true;
    return activeKinds.has(kind);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date-range pills */}
            <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
              {(["today", "7d", "30d", "all"] as RangeKey[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    range === r
                      ? "bg-brand text-white shadow-brand"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {r === "today" && "Heute"}
                  {r === "7d" && "7 Tage"}
                  {r === "30d" && "30 Tage"}
                  {r === "all" && "Alles"}
                </button>
              ))}
            </div>

            {/* Campaign select */}
            <div className="min-w-[200px]">
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Alle Kampagnen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Alle Kampagnen</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px] max-w-md">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Lead-Name oder Firma..."
                icon={<Search />}
                className="h-9 py-2"
              />
            </div>

            {/* Auto-refresh toggle */}
            <label className="inline-flex items-center gap-2 text-xs text-ink-muted whitespace-nowrap">
              <Switch
                checked={autoRefresh}
                onCheckedChange={(v) => setAutoRefresh(Boolean(v))}
              />
              <span>Auto-Refresh (30s)</span>
            </label>
          </div>

          {/* Kind pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink-muted mr-1">
              Typ:
            </span>
            <button
              type="button"
              onClick={() => setActiveKinds(null)}
              aria-pressed={allKindsSelected()}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                allKindsSelected()
                  ? "bg-brand text-white shadow-brand"
                  : "bg-surface border border-line text-ink-muted hover:text-ink"
              }`}
            >
              Alle
            </button>
            {ALL_KINDS.map((k) => {
              const active = isKindActive(k.key);
              return (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => toggleKind(k.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    active && !allKindsSelected()
                      ? "bg-brand text-white shadow-brand"
                      : "bg-surface border border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  <KindIcon kind={k.key} />
                  {k.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Events table */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-danger">
              {error}
            </div>
          ) : loading && events.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-ink-muted">
              Wird geladen…
            </div>
          ) : events.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-ink-muted">
              Keine Events fuer die aktuellen Filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeit</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Kampagne</TableHead>
                  <TableHead>Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-ink-muted tabular-nums text-xs">
                      {fmtDateTimeSec(e.ts)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${kindBadgeClass(e.kind)}`}
                      >
                        <KindIcon kind={e.kind} />
                        {kindLabel(e.kind)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-ink truncate max-w-[220px]">
                        {e.leadName}
                      </div>
                      {e.companyName && (
                        <div className="text-xs text-ink-muted truncate max-w-[220px]">
                          {e.companyName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/analytics/kampagnen/${e.campaignId}`}
                        className="text-brand-deep hover:underline truncate max-w-[200px] inline-block align-bottom"
                      >
                        {e.campaignName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {renderPayloadPreview(e.kind, e.payload)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-ink-muted tabular-nums">
            {showingFrom}–{showingTo} von {total} Events
            {loading && events.length > 0 && (
              <span className="ml-2 text-ink-muted">· Aktualisiere…</span>
            )}
          </span>
          <div className="inline-flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              iconLeft={<ChevronLeft className="size-4" />}
            >
              Zurueck
            </Button>
            <span className="text-xs text-ink-muted tabular-nums">
              Seite {page + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              iconRight={<ChevronRight className="size-4" />}
            >
              Weiter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
