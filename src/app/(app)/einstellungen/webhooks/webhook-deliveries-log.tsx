"use client";

/**
 * Deliveries-Log für einen einzelnen Webhook-Endpoint.
 *
 * Wird sowohl inline (kompakt, ohne Polling) als auch im "Auslieferungen
 * ansehen"-Drawer (mit Filter, Polling, Expand) verwendet — gesteuert über
 * den `variant`-Prop.
 *
 * Filter-State wird je nach Endpoint in localStorage gespiegelt, damit ein
 * Wechsel zurück zum Endpoint den letzten Filter wieder zeigt.
 */

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  RefreshCw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENT_LABELS } from "./event-labels";
import type { WebhookDeliveryRow } from "./types";

const POLL_INTERVAL_MS = 10_000;
const LS_KEY_PREFIX = "vc:webhook-deliveries-filter:";

type FilterStatus = "all" | "ok" | "err" | "pending";

interface ApiResponse {
  rows?: WebhookDeliveryRow[];
  nextCursor?: string | null;
  error?: string;
}

export interface WebhookDeliveriesLogProps {
  endpointId: string;
  variant?: "compact" | "full";
}

export function WebhookDeliveriesLog({
  endpointId,
  variant = "full",
}: WebhookDeliveriesLogProps) {
  const { toast } = useToast();
  const storageKey = `${LS_KEY_PREFIX}${endpointId}`;
  const isCompact = variant === "compact";

  const [filter, setFilter] = React.useState<FilterStatus>("all");
  const [rows, setRows] = React.useState<WebhookDeliveryRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [retryingId, setRetryingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Filter aus localStorage hydrieren (nur full-Variant — compact zeigt
  // ohnehin nur "Alle" ohne Toolbar).
  React.useEffect(() => {
    if (isCompact) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "ok" || raw === "err" || raw === "pending" || raw === "all") {
        setFilter(raw);
      }
    } catch {
      // ignore
    }
  }, [storageKey, isCompact]);

  React.useEffect(() => {
    if (isCompact) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, filter);
    } catch {
      // ignore
    }
  }, [filter, storageKey, isCompact]);

  const queryString = React.useMemo(() => {
    const p = new URLSearchParams();
    if (filter !== "all") p.set("status", filter);
    p.set("limit", isCompact ? "5" : "50");
    return p.toString();
  }, [filter, isCompact]);

  const fetchInitial = React.useCallback(
    async (silent: boolean) => {
      if (!silent) setLoadingInitial(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/webhooks/endpoints/${endpointId}/deliveries?${queryString}`,
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
    [endpointId, queryString],
  );

  React.useEffect(() => {
    void fetchInitial(false);
  }, [fetchInitial]);

  // Polling nur in der full-Variant — compact ist nur Vorschau.
  React.useEffect(() => {
    if (isCompact) return;
    if (typeof window === "undefined") return;
    const i = window.setInterval(() => {
      void fetchInitial(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(i);
  }, [fetchInitial, isCompact]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams();
      if (filter !== "all") p.set("status", filter);
      p.set("limit", "50");
      p.set("cursor", nextCursor);
      const res = await fetch(
        `/api/webhooks/endpoints/${endpointId}/deliveries?${p.toString()}`,
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

  async function handleRetry(row: WebhookDeliveryRow) {
    setRetryingId(row.id);
    try {
      const res = await fetch(
        `/api/webhooks/endpoints/${endpointId}/redeliver`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deliveryId: row.id }),
        },
      );
      if (res.status === 202 || res.ok) {
        toast({
          title: "Neuer Versuch eingereiht",
          description: `Event ${row.eventKind}`,
          variant: "success",
        });
        // Refresh nach kurzem Delay — der Worker braucht einen Tick, bis ein
        // neuer Eintrag auftaucht.
        window.setTimeout(() => void fetchInitial(true), 800);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Erneuter Versuch fehlgeschlagen",
          description: body.error ?? `HTTP ${res.status}`,
          variant: "danger",
        });
      }
    } catch {
      toast({
        title: "Erneuter Versuch fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setRetryingId(null);
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

  return (
    <div className="flex flex-col gap-4">
      {!isCompact && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
            {(["all", "ok", "err", "pending"] as const).map((f) => (
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
                {f === "all"
                  ? "Alle"
                  : f === "ok"
                    ? "Erfolg"
                    : f === "err"
                      ? "Fehler"
                      : "Wartend"}
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
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {loadingInitial ? (
        <div className="rounded-squircle-md border border-line bg-surface-muted/40 px-4 py-8 text-center text-sm text-ink-muted">
          Lade Auslieferungen ...
        </div>
      ) : rows.length === 0 ? (
        isCompact ? (
          <p className="text-xs text-ink-muted italic">
            Noch keine Auslieferungen.
          </p>
        ) : (
          <EmptyState
            icon={<Send />}
            title="Noch keine Auslieferungen"
            subtitle="Sobald ein Event diesen Endpoint triggert, erscheinen die Push-Versuche hier."
          />
        )
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
                  Status
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  HTTP
                </th>
                <th className="h-11 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Versuch
                </th>
                <th className="h-11 px-3 text-right align-middle text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((row) => {
                const isOpen = expanded.has(row.id);
                const isError = row.status === "err";
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className="transition-colors hover:bg-surface-soft cursor-pointer"
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
                        <EventLabel kind={row.eventKind} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <DeliveryStatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="font-mono text-xs text-ink-soft tabular-nums">
                          {row.httpStatus ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span className="text-xs text-ink-muted tabular-nums">
                          #{row.attempt}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 align-middle text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isError && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleRetry(row)}
                            loading={retryingId === row.id}
                            iconLeft={<RefreshCw className="size-3.5" />}
                          >
                            Erneut senden
                          </Button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-surface-muted/30">
                        <td />
                        <td colSpan={6} className="px-4 py-4">
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

      {!isCompact && nextCursor && (
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

// ── Helpers ────────────────────────────────────────────────────────────────

function EventLabel({ kind }: { kind: string }) {
  const meta = (
    WEBHOOK_EVENT_LABELS as Record<
      string,
      { label: string; group: "lead" | "run"; description: string } | undefined
    >
  )[kind];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[11px] text-ink-muted">{kind}</span>
      {meta && (
        <span className="text-xs text-ink-soft">— {meta.label}</span>
      )}
    </span>
  );
}

function DeliveryStatusBadge({ status }: { status: WebhookDeliveryRow["status"] }) {
  if (status === "ok") {
    return (
      <Badge variant="success" dot>
        Erfolg
      </Badge>
    );
  }
  if (status === "err") {
    return (
      <Badge variant="danger" dot>
        Fehler
      </Badge>
    );
  }
  return (
    <Badge variant="warn" dot>
      Wartend
    </Badge>
  );
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Maskiert die `v1=…`-Hash-Komponente in der `X-VC-Signature`, damit der
 * Customer-Support-Screenshot keine validen Signaturen leakt. Die `t=…`-
 * Komponente bleibt unverändert (ist nur ein Timestamp).
 */
function maskSignatureHeader(value: string): string {
  // Format: "t=1717000000,v1=abcdef…"
  return value.replace(/v1=[^,\s]+/i, "v1=***");
}

function ExpandedDetails({ row }: { row: WebhookDeliveryRow }) {
  const headers: Array<[string, string]> = React.useMemo(() => {
    if (!row.requestHeaders) return [];
    return Object.entries(row.requestHeaders).map(([k, v]) => {
      if (/^x-vc-signature$/i.test(k)) return [k, maskSignatureHeader(v)];
      return [k, v];
    });
  }, [row.requestHeaders]);

  return (
    <div className="flex flex-col gap-4">
      {row.errorMessage && (
        <div className="rounded-squircle-sm border border-danger/30 bg-danger-soft/40 p-3">
          <p className="text-xs font-semibold text-danger uppercase tracking-wider mb-1">
            Fehler
          </p>
          <p className="text-xs text-ink break-words">{row.errorMessage}</p>
        </div>
      )}

      {row.nextRetryAt && (
        <p className="text-xs text-ink-muted inline-flex items-center gap-1.5">
          <Clock className="size-3.5" />
          Nächster Versuch um {formatTime(row.nextRetryAt)}
        </p>
      )}

      {typeof row.latencyMs === "number" && (
        <p className="text-xs text-ink-muted">
          Latenz: <span className="tabular-nums">{row.latencyMs} ms</span>
        </p>
      )}

      {headers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
            Request-Header
          </p>
          <pre className="rounded-squircle-sm bg-surface border border-line p-2.5 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-all max-h-40 overflow-auto">
            {headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
          </pre>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
          Payload
        </p>
        <pre className="rounded-squircle-sm bg-surface border border-line p-2.5 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-all max-h-60 overflow-auto">
          {formatJsonLike(row.requestBody)}
        </pre>
      </div>

      {row.responseBody !== null && row.responseBody !== undefined && (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
            Response-Body
          </p>
          <pre className="rounded-squircle-sm bg-surface border border-line p-2.5 text-[11px] font-mono text-ink-soft whitespace-pre-wrap break-all max-h-40 overflow-auto">
            {formatJsonLike(row.responseBody)}
          </pre>
        </div>
      )}
    </div>
  );
}

function formatJsonLike(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return v;
    }
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ── Status-Icons (Re-Export für andere Komponenten, die das Set wiederverwenden) ─

export const DeliveryStatusIcons = {
  ok: CircleCheck,
  err: CircleX,
  pending: Clock,
};
