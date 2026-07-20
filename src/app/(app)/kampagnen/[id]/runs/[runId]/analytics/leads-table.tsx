"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Link as LinkIcon,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StatusFilter = "all" | "opened" | "started" | "completed" | "failed";
type SortKey = "name" | "status" | "openedAt";

interface LeadRow {
  id: string;
  slug: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string;
  opens: number;
  firstOpenAt: string | null;
  lastOpenAt: string | null;
  videoStarted: boolean;
  watchedPercent: number;
  ctaClicked: number;
  videoUrl: string | null;
  pageUrl: string | null;
  pdfUrl: string | null;
  lastEventAt: string | null;
}

interface ApiResponse {
  items: LeadRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "opened", label: "Geöffnet" },
  { key: "started", label: "Video gestartet" },
  { key: "completed", label: "Fertig" },
  { key: "failed", label: "Fehlerhaft" },
];

const LIMIT = 25;

function statusBadge(s: string): { variant: "brand" | "success" | "warn" | "danger" | "neutral"; label: string } {
  switch (s) {
    case "completed":
      return { variant: "success", label: "Fertig" };
    case "failed":
      return { variant: "danger", label: "Fehler" };
    case "rendering":
    case "uploading":
      return { variant: "brand", label: "In Arbeit" };
    case "pending":
      return { variant: "neutral", label: "Wartet" };
    default:
      return { variant: "neutral", label: s };
  }
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(d));
  } catch {
    return "";
  }
}

function fullName(l: LeadRow): string {
  const fn = (l.firstName ?? "").trim();
  const ln = (l.lastName ?? "").trim();
  const both = `${fn} ${ln}`.trim();
  return both || l.email || "(ohne Name)";
}

export function LeadsTable({ runId }: { runId: string }) {
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [sort, setSort] = React.useState<SortKey>("name");
  const [page, setPage] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");

  const [data, setData] = React.useState<ApiResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Debounce search input by 250ms to avoid hammering the API.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Reset page when filters change.
  React.useEffect(() => {
    setPage(0);
  }, [status, sort, debouncedQ]);

  React.useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", String(LIMIT));
    if (debouncedQ) params.set("q", debouncedQ);
    fetch(`/api/runs/${runId}/leads?${params.toString()}`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ApiResponse>;
      })
      .then((json) => {
        if (!aborted) setData(json);
      })
      .catch((err) => {
        if (!aborted) setError(err instanceof Error ? err.message : "Fehler");
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [runId, status, sort, page, debouncedQ]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / LIMIT) - 1);

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((t) => {
            const active = status === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatus(t.key)}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (active
                    ? "bg-brand text-white shadow-brand"
                    : "bg-surface-soft text-ink-muted hover:bg-canvas-deep hover:text-ink")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="md:ml-auto w-full md:w-72">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name oder Email suchen"
            icon={<Search />}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          title="Konnte nicht geladen werden"
          subtitle={error}
        />
      ) : items.length === 0 && !loading ? (
        <EmptyState
          title="Keine Leads gefunden"
          subtitle={
            debouncedQ
              ? "Suche zurück setzen oder Filter wechseln."
              : "Sobald Leads tracken, erscheinen sie hier."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Lead"
                active={sort === "name"}
                onClick={() => setSort("name")}
              />
              <SortableHead
                label="Status"
                active={sort === "status"}
                onClick={() => setSort("status")}
              />
              <TableHead className="text-right">Öffnungen</TableHead>
              <TableHead className="text-right">Watch %</TableHead>
              <TableHead className="text-right">CTA</TableHead>
              <SortableHead
                label="Letzte Aktivitaet"
                active={sort === "openedAt"}
                onClick={() => setSort("openedAt")}
                className="text-right"
              />
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-ink-muted py-8">
                  Lade...
                </TableCell>
              </TableRow>
            ) : (
              items.map((l) => {
                const sb = statusBadge(l.status);
                const lastAt = l.lastEventAt ?? l.lastOpenAt;
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-ink">{fullName(l)}</span>
                        {l.email && (
                          <span className="text-xs text-ink-muted">{l.email}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={sb.variant} dot>
                        {sb.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.opens}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(l.watchedPercent)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.ctaClicked}
                    </TableCell>
                    <TableCell className="text-right text-xs text-ink-muted">
                      {fmtDate(lastAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions lead={l} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-ink-muted">
          <div>
            {total} Leads gesamt, Seite {page + 1} von {lastPage + 1}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              iconLeft={<ChevronLeft className="size-4" />}
            >
              Zurück
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= lastPage || loading}
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

function SortableHead({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 text-inherit transition-colors " +
          (active ? "text-brand-deep" : "hover:text-ink")
        }
      >
        {label}
      </button>
    </TableHead>
  );
}

function RowActions({ lead }: { lead: LeadRow }) {
  const onCopy = React.useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore; older browsers / iframes without clipboard permission
    }
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-soft hover:text-ink transition-colors"
          aria-label="Aktionen"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {lead.pageUrl ? (
          <DropdownMenuItem asChild>
            <a
              href={`${lead.pageUrl}${lead.pageUrl.includes("?") ? "&" : "?"}preview=1`}
              target="_blank"
              rel="noreferrer"
              title="Im Vorschau-Modus öffnen (kein Tracking)"
            >
              <ExternalLink className="size-4 text-ink-muted" />
              Landingpage öffnen (Vorschau)
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <ExternalLink className="size-4 text-ink-muted" />
            Landingpage nicht verfügbar
          </DropdownMenuItem>
        )}
        {lead.videoUrl ? (
          <DropdownMenuItem onSelect={() => onCopy(lead.videoUrl as string)}>
            <LinkIcon className="size-4 text-ink-muted" />
            Video-URL kopieren
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <LinkIcon className="size-4 text-ink-muted" />
            Kein Video
          </DropdownMenuItem>
        )}
        {lead.pdfUrl ? (
          <DropdownMenuItem asChild>
            <a href={lead.pdfUrl} target="_blank" rel="noreferrer">
              <Download className="size-4 text-ink-muted" />
              PDF herunterladen
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Download className="size-4 text-ink-muted" />
            Kein PDF
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
