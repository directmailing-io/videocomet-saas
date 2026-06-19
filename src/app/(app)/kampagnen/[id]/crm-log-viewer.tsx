"use client";

/**
 * CRM-Event-Log-Viewer für eine Kampagne.
 *
 * Zeigt alle Push-Versuche zum CRM mit Status-Filter (alle / Erfolg /
 * Fehler), Inline-Expand für Request-/Response-Body und 10s-Polling.
 * Pagination via opaker Cursor von der API. Filter-State wird in
 * localStorage gespiegelt — pro Kampagne separat.
 */

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 10_000;
const LS_KEY_PREFIX = "vc:crm-log-filter:";

type FilterStatus = "all" | "ok" | "err";

export interface CrmLogRow {
  id: string;
  ts: string;
  eventKind: string;
  lookupField: string | null;
  lookupValue: string | null;
  contactId: string | null;
  httpStatus: number | null;
  requestBody: unknown;
  responseBody: unknown;
  errorMessage: string | null;
  attempt: number;
}

interface ApiResponse {
  rows?: CrmLogRow[];
  nextCursor?: string | null;
  error?: string;
}

const EVENT_LABEL: Record<string, string> = {
  page_view: "Landingpage-Aufruf",
  video_play: "Video-Play",
  cta_click: "CTA-Klick",
  test_sync: "Test-Sync",
};

export interface CrmLogViewerProps {
  campaignId: string;
  /** Optional: highlight specific log IDs nach Test-Sync. */
  highlightIds?: string[];
}

export function CrmLogViewer({ campaignId, highlightIds }: CrmLogViewerProps) {
  const storageKey = `${LS_KEY_PREFIX}${campaignId}`;

  const [filter, setFilter] = React.useState<FilterStatus>("all");
  const [rows, setRows] = React.useState<CrmLogRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  // Filter aus localStorage hydrieren
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "ok" || raw === "err" || raw === "all") {
        setFilter(raw);
      }
    } catch {
      // ignore broken storage
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, filter);
    } catch {
      // ignore quota
    }
  }, [filter, storageKey]);

  const queryString = React.useMemo(() => {
    const p = new URLSearchParams();
    p.set("status", filter);
    p.set("limit", "50");
    return p.toString();
  }, [filter]);

  const fetchInitial = React.useCallback(
    async (silent: boolean) => {
      if (!silent) setLoadingInitial(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/campaigns/${campaignId}/crm-log?${queryString}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as ApiResponse;
        setRows(body.rows ?? []);
        setNextCursor(body.nextCursor ?? null);
      } catch {
        setError("Log konnte nicht geladen werden.");
      } finally {
        setLoadingInitial(false);
        setRefreshing(false);
      }
    },
    [campaignId, queryString],
  );

  React.useEffect(() => {
    void fetchInitial(false);
  }, [fetchInitial]);

  // 10s-Polling
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const i = window.setInterval(() => {
      void fetchInitial(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(i);
  }, [fetchInitial]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams();
      p.set("status", filter);
      p.set("limit", "50");
      p.set("cursor", nextCursor);
      const res = await fetch(
        `/api/campaigns/${campaignId}/crm-log?${p.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const body = (await res.json()) as ApiResponse;
      setRows((prev) => [...prev, ...(body.rows ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const highlightSet = React.useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter + Refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
          {(["all", "ok", "err"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors",
                filter === f
                  ? "bg-brand text-white shadow-brand"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {f === "all" ? "Alle" : f === "ok" ? "Erfolg" : "Fehler"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void fetchInitial(true)}
          loading={refreshing}
          iconLeft={<RefreshCw className="size-3.5" />}
        >
          Aktualisieren
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {loadingInitial ? (
        <div className="rounded-squircle-md border border-line bg-surface-muted/40 px-4 py-12 text-center text-sm text-ink-muted">
          Lade Log ...
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CircleCheck />}
          title="Noch keine Log-Einträge"
          subtitle="Sobald die Kampagne erste Lead-Events ans CRM pusht, erscheinen die Versuche hier."
        />
      ) : (
        <div className="overflow-hidden rounded-squircle-md border border-line bg-surface">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-surface-soft border-b border-line">
              <tr>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted w-8" />
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Zeit
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Event
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Match-Wert
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Contact-ID
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((row) => {
                const isOpen = expanded.has(row.id);
                const highlighted = highlightSet.has(row.id);
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "transition-colors hover:bg-surface-soft cursor-pointer",
                        highlighted && "bg-brand-soft/40",
                      )}
                      onClick={() => toggleExpand(row.id)}
                    >
                      <td className="px-3 py-2 align-middle w-8">
                        {isOpen ? (
                          <ChevronDown className="size-4 text-ink-muted" />
                        ) : (
                          <ChevronRight className="size-4 text-ink-muted" />
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-xs tabular-nums text-ink whitespace-nowrap">
                        {formatTime(row.ts)}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <EventBadge eventKind={row.eventKind} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <MatchValueCell row={row} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="font-mono text-[11px] text-ink-muted">
                          {row.contactId ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <StatusBadge row={row} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-muted/30">
                        <td />
                        <td colSpan={5} className="px-4 py-4">
                          <ExpandedDetails row={row} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadMore}
            loading={loadingMore}
          >
            Mehr laden
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Hilfs-Cells ─────────────────────────────────────────────────────────────

function EventBadge({ eventKind }: { eventKind: string }) {
  const label = EVENT_LABEL[eventKind] ?? eventKind;
  return <Badge variant="neutral">{label}</Badge>;
}

function MatchValueCell({ row }: { row: CrmLogRow }) {
  if (!row.lookupValue) {
    return <span className="text-ink-muted text-xs">—</span>;
  }
  return (
    <span
      className="text-xs text-ink truncate inline-block max-w-[220px] align-bottom"
      title={`${row.lookupField ?? ""}: ${row.lookupValue}`}
    >
      {row.lookupValue}
    </span>
  );
}

function StatusBadge({ row }: { row: CrmLogRow }) {
  // Übersprungen: kein httpStatus + keine errorMessage
  if (row.httpStatus === null && !row.errorMessage) {
    return <Badge variant="neutral">Übersprungen</Badge>;
  }
  if (row.errorMessage || (row.httpStatus !== null && row.httpStatus >= 400)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="danger" dot>
          Fehler
        </Badge>
        {row.attempt > 1 && (
          <span className="text-[10px] text-ink-muted">#{row.attempt}</span>
        )}
      </span>
    );
  }
  return (
    <Badge variant="success" dot>
      OK
    </Badge>
  );
}

function ExpandedDetails({ row }: { row: CrmLogRow }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <Field label="HTTP-Status" value={row.httpStatus?.toString() ?? "—"} />
        <Field label="Versuch" value={row.attempt.toString()} />
        <Field label="Lookup-Feld" value={row.lookupField ?? "—"} />
        <Field label="Contact-ID" value={row.contactId ?? "—"} mono />
      </div>

      {row.errorMessage && (
        <div className="flex items-start gap-2 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-3 py-2 text-xs text-danger">
          <CircleX className="size-3.5 shrink-0 mt-0.5" />
          <p className="break-words min-w-0">{row.errorMessage}</p>
        </div>
      )}

      <JsonPanel label="Request-Body" data={row.requestBody} />
      <JsonPanel label="Response-Body" data={row.responseBody} />
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p
        className={cn(
          "text-ink mt-0.5 break-all",
          mono && "font-mono text-[11px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function JsonPanel({ label, data }: { label: string; data: unknown }) {
  if (data === null || data === undefined) {
    return null;
  }
  let pretty: string;
  try {
    pretty = JSON.stringify(data, null, 2);
  } catch {
    pretty = String(data);
  }
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
        {label}
      </p>
      <pre className="rounded-squircle-sm border border-line bg-surface p-3 text-[11px] leading-relaxed text-ink whitespace-pre-wrap break-words max-h-[280px] overflow-auto font-mono">
        {pretty}
      </pre>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}
