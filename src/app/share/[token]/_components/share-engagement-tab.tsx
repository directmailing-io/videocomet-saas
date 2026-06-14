"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  Search,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SerializableShareLead } from "../share-dashboard";
import { formatDateTimeDE } from "../share-dashboard";

interface ShareEngagementTabProps {
  leads: SerializableShareLead[];
  appUrl: string;
}

type OpenedSortKey = "firstName" | "lastName" | "run" | "views" | "first" | "last";
type PlayedSortKey = "firstName" | "lastName" | "run" | "plays" | "watch" | "last";

/**
 * Engagement-Tab: zwei nebeneinander gestapelte Karten — links die Leads,
 * die mind. die LP geöffnet haben, rechts die mit Video-Play. Jede Karte
 * hat ihre eigene Mini-Suche + Header-Sortierung. Auf Mobile stapeln sie
 * sich; auf >= md liegen sie nebeneinander.
 */
export function ShareEngagementTab({ leads, appUrl }: ShareEngagementTabProps) {
  const opened = React.useMemo(
    () => leads.filter((l) => l.viewCount > 0),
    [leads],
  );
  const played = React.useMemo(
    () => leads.filter((l) => l.playCount > 0),
    [leads],
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <OpenedCard leads={opened} total={leads.length} appUrl={appUrl} />
      <PlayedCard leads={played} total={leads.length} appUrl={appUrl} />
    </div>
  );
}

// ── Opened card ─────────────────────────────────────────────────────────────

function OpenedCard({
  leads,
  total,
  appUrl,
}: {
  leads: SerializableShareLead[];
  total: number;
  appUrl: string;
}) {
  const [search, setSearch] = React.useState("");
  const [sortKey, setSortKey] = React.useState<OpenedSortKey>("first");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter((l) => {
      if (!term) return true;
      const fullName = `${l.firstName ?? ""} ${l.lastName ?? ""} ${l.runName}`
        .toLowerCase();
      return fullName.includes(term);
    });
    return out.slice().sort((a, b) => cmpOpened(a, b, sortKey, sortDir));
  }, [leads, search, sortKey, sortDir]);

  function toggleSort(key: OpenedSortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          Seiten geöffnet ({leads.length.toLocaleString("de-DE")} von{" "}
          {total.toLocaleString("de-DE")})
        </CardTitle>
        <Input
          icon={<Search />}
          placeholder="Suche…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
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
                  sortKey="first"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Erstmals geöffnet
                </SortableTh>
                <SortableTh
                  sortKey="last"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Letzter Aufruf
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-10 text-ink-muted text-sm"
                  >
                    Niemand hat die Seite bisher geöffnet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.leadId}>
                    <TableCell className="font-medium text-ink">
                      <LeadNameLink lead={l} appUrl={appUrl} fallback={l.firstName} />
                    </TableCell>
                    <TableCell className="text-ink">
                      {l.lastName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted truncate max-w-[140px]">
                      {l.runName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.viewCount}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTimeDE(l.firstViewedAt)}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTimeDE(l.lastViewedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Played card ─────────────────────────────────────────────────────────────

function PlayedCard({
  leads,
  total,
  appUrl,
}: {
  leads: SerializableShareLead[];
  total: number;
  appUrl: string;
}) {
  const [search, setSearch] = React.useState("");
  const [sortKey, setSortKey] = React.useState<PlayedSortKey>("last");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter((l) => {
      if (!term) return true;
      const fullName = `${l.firstName ?? ""} ${l.lastName ?? ""} ${l.runName}`
        .toLowerCase();
      return fullName.includes(term);
    });
    return out.slice().sort((a, b) => cmpPlayed(a, b, sortKey, sortDir));
  }, [leads, search, sortKey, sortDir]);

  function toggleSort(key: PlayedSortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          Videos abgespielt ({leads.length.toLocaleString("de-DE")} von{" "}
          {total.toLocaleString("de-DE")})
        </CardTitle>
        <Input
          icon={<Search />}
          placeholder="Suche…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-2"
        />
      </CardHeader>
      <CardContent className="p-0">
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
                  sortKey="watch"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  Watch-Zeit (s)
                </SortableTh>
                <SortableTh
                  sortKey="last"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Letzter Aufruf
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-10 text-ink-muted text-sm"
                  >
                    Niemand hat das Video bisher abgespielt.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.leadId}>
                    <TableCell className="font-medium text-ink">
                      <LeadNameLink lead={l} appUrl={appUrl} fallback={l.firstName} />
                    </TableCell>
                    <TableCell className="text-ink">
                      {l.lastName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted truncate max-w-[140px]">
                      {l.runName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.playCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(l.watchTimeSec)}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTimeDE(l.lastViewedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Shared header / link ────────────────────────────────────────────────────

function LeadNameLink({
  lead,
  appUrl,
  fallback,
}: {
  lead: SerializableShareLead;
  appUrl: string;
  fallback: string | null;
}) {
  const label = fallback ?? "—";
  if (!lead.slug) {
    return <span>{label}</span>;
  }
  return (
    <a
      href={`${appUrl}/v/${lead.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-brand-deep hover:underline"
      title={`${appUrl}/v/${lead.slug}`}
    >
      {label}
      <ExternalLink className="size-3 opacity-70" />
    </a>
  );
}

function SortableTh<K extends string>({
  sortKey,
  current,
  dir,
  onSort,
  children,
  align,
}: {
  sortKey: K;
  current: K;
  dir: "asc" | "desc";
  onSort: (k: K) => void;
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

// ── Sort comparators ────────────────────────────────────────────────────────

function cmpOpened(
  a: SerializableShareLead,
  b: SerializableShareLead,
  key: OpenedSortKey,
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
    case "views":
      return (a.viewCount - b.viewCount) * sign;
    case "first":
      return (tsOrZero(a.firstViewedAt) - tsOrZero(b.firstViewedAt)) * sign;
    case "last":
      return (tsOrZero(a.lastViewedAt) - tsOrZero(b.lastViewedAt)) * sign;
  }
}

function cmpPlayed(
  a: SerializableShareLead,
  b: SerializableShareLead,
  key: PlayedSortKey,
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
    case "plays":
      return (a.playCount - b.playCount) * sign;
    case "watch":
      return (a.watchTimeSec - b.watchTimeSec) * sign;
    case "last":
      return (tsOrZero(a.lastViewedAt) - tsOrZero(b.lastViewedAt)) * sign;
  }
}

function tsOrZero(d: string | null): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}
