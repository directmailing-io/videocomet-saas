"use client";

/**
 * Kampagnen-weite Lead-Tabelle (über alle Runden hinweg).
 *
 * Features: clientseitige Suche, Status-Filter, Aktivitäts-Filter
 * (geöffnet / abgespielt / CTA geklickt), Sortierung pro Spalte,
 * Paginierung. Daten kommen einmalig server-seitig — Bewegungen sind
 * pure JS-Operationen auf dem `initial`-Array.
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  MousePointerClick,
  Play,
  Search,
} from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CampaignLeadRowSerialized {
  id: string;
  rowIndex: number;
  runId: string;
  runName: string;
  data: Record<string, string>;
  slug: string | null;
  status: string;
  videoUrl: string | null;
  pdfUrl: string | null;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  playCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  lastCtaAt: string | null;
  createdAt: string;
}

type SortKey =
  | "name"
  | "company"
  | "run"
  | "status"
  | "views"
  | "plays"
  | "watch"
  | "ctas"
  | "lastViewed"
  | "lastCta";

type ActivityFilter = "all" | "opened" | "played" | "cta" | "none";

const PAGE_SIZE = 25;

export function CampaignLeadsTable({
  campaignId,
  initial,
  appUrl,
}: {
  campaignId: string;
  initial: CampaignLeadRowSerialized[];
  appUrl: string;
}) {
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [activityFilter, setActivityFilter] = React.useState<ActivityFilter>(
    "all",
  );
  const [runFilter, setRunFilter] = React.useState<string>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("lastViewed");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(0);

  const runs = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of initial) {
      if (!seen.has(l.runId)) seen.set(l.runId, l.runName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [initial]);

  // Reset pagination on filter change.
  React.useEffect(() => {
    setPage(0);
  }, [search, statusFilter, activityFilter, runFilter, sortKey, sortDir]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    let out = initial.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (runFilter !== "all" && l.runId !== runFilter) return false;
      if (activityFilter === "opened" && l.viewCount <= 0) return false;
      if (activityFilter === "played" && l.playCount <= 0) return false;
      if (activityFilter === "cta" && l.ctaClickCount <= 0) return false;
      if (activityFilter === "none" && (l.viewCount > 0 || l.playCount > 0 || l.ctaClickCount > 0))
        return false;
      if (!term) return true;
      const name = displayName(l.data);
      const company = displayCompany(l.data);
      const email = l.data.email ?? l.data["E-Mail"] ?? l.data.Email ?? "";
      return (
        name.toLowerCase().includes(term) ||
        company.toLowerCase().includes(term) ||
        email.toLowerCase().includes(term) ||
        l.runName.toLowerCase().includes(term) ||
        (l.slug ?? "").toLowerCase().includes(term)
      );
    });
    out = out.slice().sort((a, b) => sortCmp(a, b, sortKey, sortDir));
    return out;
  }, [initial, search, statusFilter, activityFilter, runFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,180px,180px,180px] gap-3 items-end">
          <div>
            <Input
              icon={<Search />}
              placeholder="Suche nach Name, Firma, E-Mail, Runde oder Slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="completed">Fertig</SelectItem>
              <SelectItem value="failed">Fehler</SelectItem>
              <SelectItem value="pending">Wartet</SelectItem>
              <SelectItem value="rendering">Wird gerendert</SelectItem>
              <SelectItem value="uploading">Wird hochgeladen</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={activityFilter}
            onValueChange={(v) => setActivityFilter(v as ActivityFilter)}
          >
            <SelectTrigger><SelectValue placeholder="Aktivität" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Aktivität</SelectItem>
              <SelectItem value="opened">Landingpage geöffnet</SelectItem>
              <SelectItem value="played">Video abgespielt</SelectItem>
              <SelectItem value="cta">CTA geklickt</SelectItem>
              <SelectItem value="none">Keine Aktivität</SelectItem>
            </SelectContent>
          </Select>
          <Select value={runFilter} onValueChange={setRunFilter}>
            <SelectTrigger><SelectValue placeholder="Runde" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Runden</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh sortKey="name" current={sortKey} dir={sortDir} onSort={toggleSort}>Lead</SortableTh>
                <SortableTh sortKey="company" current={sortKey} dir={sortDir} onSort={toggleSort}>Firma</SortableTh>
                <SortableTh sortKey="run" current={sortKey} dir={sortDir} onSort={toggleSort}>Runde</SortableTh>
                <SortableTh sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort}>Status</SortableTh>
                <SortableTh sortKey="views" current={sortKey} dir={sortDir} onSort={toggleSort} align="right">
                  <Eye className="size-3.5 inline-block mr-1" />
                  Aufrufe
                </SortableTh>
                <SortableTh sortKey="plays" current={sortKey} dir={sortDir} onSort={toggleSort} align="right">
                  <Play className="size-3.5 inline-block mr-1" />
                  Plays
                </SortableTh>
                <SortableTh sortKey="watch" current={sortKey} dir={sortDir} onSort={toggleSort} align="right">
                  Watch
                </SortableTh>
                <SortableTh sortKey="ctas" current={sortKey} dir={sortDir} onSort={toggleSort} align="right">
                  <MousePointerClick className="size-3.5 inline-block mr-1" />
                  CTA
                </SortableTh>
                <SortableTh sortKey="lastViewed" current={sortKey} dir={sortDir} onSort={toggleSort}>
                  Zuletzt geöffnet
                </SortableTh>
                <TableHead>Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-ink-muted text-sm">
                    Keine Leads für die aktuellen Filter.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="text-sm font-medium text-ink truncate max-w-[220px]">
                        {displayName(l.data)}
                      </div>
                      {l.data.email && (
                        <div className="text-xs text-ink-muted truncate max-w-[220px]">
                          {l.data.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm truncate max-w-[180px]">
                      {displayCompany(l.data) || "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/kampagnen/${campaignId}/runs/${l.runId}`}
                        className="text-xs text-brand-deep hover:underline truncate inline-block max-w-[140px]"
                      >
                        {l.runName}
                      </Link>
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
                    <TableCell className="text-right tabular-nums text-ink-muted text-xs">
                      {l.watchTimeSec > 0 ? formatDuration(l.watchTimeSec) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.ctaClickCount || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatRel(l.lastViewedAt) ?? "—"}
                    </TableCell>
                    <TableCell>
                      {l.slug ? (
                        <a
                          href={`${appUrl}/v/${l.slug}?preview=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                          title="Im Vorschau-Modus öffnen"
                        >
                          <ExternalLink className="size-3" />
                          Vorschau
                        </a>
                      ) : (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-muted tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} von {filtered.length} Leads
          </span>
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
        </div>
      )}
    </div>
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function sortCmp(
  a: CampaignLeadRowSerialized,
  b: CampaignLeadRowSerialized,
  key: SortKey,
  dir: "asc" | "desc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "name":
      return displayName(a.data).localeCompare(displayName(b.data)) * sign;
    case "company":
      return displayCompany(a.data).localeCompare(displayCompany(b.data)) * sign;
    case "run":
      return a.runName.localeCompare(b.runName) * sign;
    case "status":
      return a.status.localeCompare(b.status) * sign;
    case "views":
      return (a.viewCount - b.viewCount) * sign;
    case "plays":
      return (a.playCount - b.playCount) * sign;
    case "watch":
      return (a.watchTimeSec - b.watchTimeSec) * sign;
    case "ctas":
      return (a.ctaClickCount - b.ctaClickCount) * sign;
    case "lastViewed": {
      const av = a.lastViewedAt ? new Date(a.lastViewedAt).getTime() : 0;
      const bv = b.lastViewedAt ? new Date(b.lastViewedAt).getTime() : 0;
      return (av - bv) * sign;
    }
    case "lastCta": {
      const av = a.lastCtaAt ? new Date(a.lastCtaAt).getTime() : 0;
      const bv = b.lastCtaAt ? new Date(b.lastCtaAt).getTime() : 0;
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

function displayName(data: Record<string, string>): string {
  const first =
    data.firstName ||
    data.Vorname ||
    data.vorname ||
    data.first_name ||
    data.fullName ||
    data.name ||
    "";
  const last = data.lastName || data.Nachname || data.nachname || data.last_name || "";
  const composed = [first, last].filter(Boolean).join(" ").trim();
  return composed || data.email || data["E-Mail"] || "(unbenannt)";
}

function displayCompany(data: Record<string, string>): string {
  return (
    data.companyName ||
    data.company ||
    data.Firma ||
    data.firma ||
    data.Unternehmen ||
    ""
  );
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRel(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "gerade eben";
  if (ms < 3_600_000) return `vor ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `vor ${Math.floor(ms / 3_600_000)} Std`;
  if (ms < 30 * 86_400_000) return `vor ${Math.floor(ms / 86_400_000)} Tg`;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
