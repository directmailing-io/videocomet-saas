"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SerializableShareLead } from "../share-dashboard";
import { formatDateTimeDE } from "../share-dashboard";

const PAGE_SIZE = 50;

type SortKey =
  | "firstName"
  | "lastName"
  | "run"
  | "status"
  | "views"
  | "plays"
  | "ctas"
  | "watch"
  | "createdAt";

interface ShareLeadsTabProps {
  leads: SerializableShareLead[];
  appUrl: string;
}

/**
 * Leads-Tab der Public-Share-Sicht. Reiner Client-State — Server liefert
 * einmal initial, alles Filtern / Sortieren / Paginieren bleibt im Browser.
 * Pattern bewusst aus `campaign-leads-table.tsx` übernommen (Ergonomie-
 * Konsistenz), aber gekappt um Owner-spezifische Aktionen.
 */
export function ShareLeadsTab({ leads, appUrl }: ShareLeadsTabProps) {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [runFilter, setRunFilter] = React.useState<string>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(0);

  const runs = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      if (!seen.has(l.runId)) seen.set(l.runId, l.runName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [leads]);

  // Reset Pagination wenn sich irgendein Filter / Sortier-Modus ändert.
  React.useEffect(() => {
    setPage(0);
  }, [search, statusFilter, runFilter, sortKey, sortDir]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (runFilter !== "all" && l.runId !== runFilter) return false;
      if (!term) return true;
      const first = (l.firstName ?? "").toLowerCase();
      const last = (l.lastName ?? "").toLowerCase();
      const run = l.runName.toLowerCase();
      const slug = (l.slug ?? "").toLowerCase();
      return (
        first.includes(term) ||
        last.includes(term) ||
        run.includes(term) ||
        slug.includes(term)
      );
    });
    return out.slice().sort((a, b) => sortCmp(a, b, sortKey, sortDir));
  }, [leads, search, statusFilter, runFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setRunFilter("all");
  }

  const filtersActive =
    search.trim() !== "" || statusFilter !== "all" || runFilter !== "all";

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,180px,200px,auto] gap-3 items-end">
          <Input
            icon={<Search />}
            placeholder="Suche nach Vorname, Nachname, Run oder Slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="completed">Fertig</SelectItem>
              <SelectItem value="pending">Wartet</SelectItem>
              <SelectItem value="rendering">Wird gerendert</SelectItem>
              <SelectItem value="uploading">Wird hochgeladen</SelectItem>
              <SelectItem value="failed">Fehler</SelectItem>
            </SelectContent>
          </Select>
          <Select value={runFilter} onValueChange={setRunFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Runde" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Runden</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="md"
            disabled={!filtersActive}
            onClick={resetFilters}
            type="button"
          >
            Filter zurücksetzen
          </Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  sortKey="firstName"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Vorname
                </SortableTh>
                <SortableTh
                  sortKey="lastName"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Nachname
                </SortableTh>
                <SortableTh
                  sortKey="run"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Run
                </SortableTh>
                <TableHead>PageURL</TableHead>
                <SortableTh
                  sortKey="status"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Status
                </SortableTh>
                <SortableTh
                  sortKey="views"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  Aufrufe
                </SortableTh>
                <SortableTh
                  sortKey="plays"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  Plays
                </SortableTh>
                <SortableTh
                  sortKey="ctas"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  CTA-Klicks
                </SortableTh>
                <SortableTh
                  sortKey="watch"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  Watch (s)
                </SortableTh>
                <SortableTh
                  sortKey="createdAt"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Erstellt
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-center py-12 text-ink-muted text-sm"
                  >
                    Keine Leads für die aktuellen Filter.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((l) => (
                  <TableRow key={l.leadId}>
                    <TableCell className="font-medium text-ink">
                      {l.firstName ?? "—"}
                    </TableCell>
                    <TableCell className="text-ink">
                      {l.lastName ?? "—"}
                    </TableCell>
                    <TableCell className="text-ink-muted text-xs truncate max-w-[180px]">
                      {l.runName}
                    </TableCell>
                    <TableCell>
                      {l.slug ? (
                        <a
                          href={`${appUrl}/v/${l.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                          title={`${appUrl}/v/${l.slug}`}
                        >
                          <ExternalLink className="size-3" />
                          /v/{l.slug}
                        </a>
                      ) : (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(l.status)} dot>
                        {statusLabel(l.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.viewCount || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.playCount || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.ctaClickCount || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.watchTimeSec > 0 ? Math.round(l.watchTimeSec) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTimeDE(l.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-muted tabular-nums">
          {leads.length.toLocaleString("de-DE")} Leads
          {filtered.length !== leads.length && (
            <> ({filtered.length.toLocaleString("de-DE")} gefiltert)</>
          )}
        </span>
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              iconLeft={<ChevronLeft className="size-4" />}
            >
              Zurück
            </Button>
            <span className="text-xs text-ink-muted tabular-nums">
              Seite {page + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              iconRight={<ChevronRight className="size-4" />}
            >
              Weiter
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sortable header ─────────────────────────────────────────────────────────

function SortableTh({
  sortKey,
  current,
  dir,
  onSort,
  children,
  align,
}: {
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  align?: "right";
}) {
  const active = sortKey === current;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-ink transition-colors",
          active && "text-ink",
        )}
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sortCmp(
  a: SerializableShareLead,
  b: SerializableShareLead,
  key: SortKey,
  dir: "asc" | "desc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "firstName":
      return (a.firstName ?? "").localeCompare(b.firstName ?? "") * sign;
    case "lastName":
      return (a.lastName ?? "").localeCompare(b.lastName ?? "") * sign;
    case "run":
      return a.runName.localeCompare(b.runName) * sign;
    case "status":
      return a.status.localeCompare(b.status) * sign;
    case "views":
      return (a.viewCount - b.viewCount) * sign;
    case "plays":
      return (a.playCount - b.playCount) * sign;
    case "ctas":
      return (a.ctaClickCount - b.ctaClickCount) * sign;
    case "watch":
      return (a.watchTimeSec - b.watchTimeSec) * sign;
    case "createdAt": {
      const av = new Date(a.createdAt).getTime();
      const bv = new Date(b.createdAt).getTime();
      return (av - bv) * sign;
    }
  }
}

function statusVariant(
  s: string,
): "success" | "warn" | "danger" | "neutral" | "brand" {
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  if (s === "rendering" || s === "uploading") return "brand";
  return "neutral";
}

function statusLabel(s: string): string {
  switch (s) {
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    case "rendering":
      return "Wird gerendert";
    case "uploading":
      return "Wird hochgeladen";
    case "pending":
      return "Wartet";
    default:
      return s;
  }
}
