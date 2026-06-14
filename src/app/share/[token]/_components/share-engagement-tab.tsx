"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Bereits zusammengesetzte URL-Basis pro Lead — `${leadBaseUrl}/${slug}`. */
  leadBaseUrl: string;
  /** Wird für den CSV-Dateinamen genutzt. Fallback "campaign". */
  campaignName: string;
}

/**
 * Identifier pro Engagement-Bucket — bestimmt Sortier-Default, Metrik-Spalte,
 * Status-Text und CSV-Dateinamen. Wir teilen den gleichen Tabellen-Korpus,
 * damit die drei Karten visuell konsistent bleiben.
 */
type BucketKind = "opened" | "played" | "clicked";

type SortKey =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "address"
  | "run"
  | "metric"
  | "ts";

interface BucketConfig {
  kind: BucketKind;
  title: string;
  emptyText: string;
  metricLabel: string;
  metricHeader: string;
  timestampLabel: string;
  /** Zugriff auf die für diesen Bucket relevante Aggregat-Zahl. */
  metricValue: (l: SerializableShareLead) => number;
  /** Zugriff auf den für diesen Bucket relevanten Zeitstempel (ISO-String). */
  timestamp: (l: SerializableShareLead) => string | null;
  /** Default-Sortierung (was hat fachlich am meisten Sinn). */
  defaultSort: SortKey;
}

const BUCKET_CONFIGS: Record<BucketKind, BucketConfig> = {
  opened: {
    kind: "opened",
    title: "Seite geöffnet",
    emptyText: "Niemand hat die Seite bisher geöffnet.",
    metricLabel: "Aufrufe",
    metricHeader: "Aufrufe",
    timestampLabel: "Letzter Aufruf",
    metricValue: (l) => l.viewCount,
    timestamp: (l) => l.lastViewedAt,
    defaultSort: "ts",
  },
  played: {
    kind: "played",
    title: "Video abgespielt",
    emptyText: "Niemand hat das Video bisher abgespielt.",
    metricLabel: "Plays",
    metricHeader: "Plays",
    timestampLabel: "Letzter Aufruf",
    metricValue: (l) => l.playCount,
    timestamp: (l) => l.lastViewedAt,
    defaultSort: "ts",
  },
  clicked: {
    kind: "clicked",
    title: "CTA geklickt",
    emptyText: "Niemand hat den CTA bisher geklickt.",
    metricLabel: "CTA-Klicks",
    metricHeader: "CTA-Klicks",
    timestampLabel: "Letzter Klick",
    metricValue: (l) => l.ctaClickCount,
    timestamp: (l) => l.lastCtaAt,
    defaultSort: "ts",
  },
};

/**
 * Engagement-Tab: drei vertikal gestapelte Karten — Seite geöffnet, Video
 * abgespielt, CTA geklickt. Jede Karte zeigt dieselben Lead-Spalten plus
 * eine bucket-spezifische Metrik + Zeitstempel-Spalte. Pro Karte gibt es
 * eine eigene Suche, eigene Sortierung und einen CSV-Export.
 */
export function ShareEngagementTab({
  leads,
  leadBaseUrl,
  campaignName,
}: ShareEngagementTabProps) {
  const opened = React.useMemo(
    () => leads.filter((l) => l.viewCount > 0),
    [leads],
  );
  const played = React.useMemo(
    () => leads.filter((l) => l.playCount > 0),
    [leads],
  );
  const clicked = React.useMemo(
    () => leads.filter((l) => l.ctaClickCount > 0),
    [leads],
  );

  return (
    <div className="flex flex-col gap-4">
      <EngagementCard
        config={BUCKET_CONFIGS.opened}
        leads={opened}
        total={leads.length}
        leadBaseUrl={leadBaseUrl}
        campaignName={campaignName}
      />
      <EngagementCard
        config={BUCKET_CONFIGS.played}
        leads={played}
        total={leads.length}
        leadBaseUrl={leadBaseUrl}
        campaignName={campaignName}
      />
      <EngagementCard
        config={BUCKET_CONFIGS.clicked}
        leads={clicked}
        total={leads.length}
        leadBaseUrl={leadBaseUrl}
        campaignName={campaignName}
      />
    </div>
  );
}

// ── Engagement card ─────────────────────────────────────────────────────────

function EngagementCard({
  config,
  leads,
  total,
  leadBaseUrl,
  campaignName,
}: {
  config: BucketConfig;
  leads: SerializableShareLead[];
  total: number;
  leadBaseUrl: string;
  campaignName: string;
}) {
  const [search, setSearch] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>(config.defaultSort);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchTerm = (l: SerializableShareLead): boolean => {
      if (!term) return true;
      const haystack = [
        l.firstName,
        l.lastName,
        l.phone,
        l.email,
        l.address,
        l.runName,
        l.slug,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    };
    return leads
      .filter(matchTerm)
      .slice()
      .sort((a, b) => cmp(a, b, sortKey, sortDir, config));
  }, [leads, search, sortKey, sortDir, config]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function onExport() {
    const filename = buildCsvFilename(campaignName, config.kind);
    const csv = buildCsv(filtered, leadBaseUrl, config);
    downloadCsv(csv, filename);
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            {config.title} ({leads.length.toLocaleString("de-DE")} von{" "}
            {total.toLocaleString("de-DE")})
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconLeft={<Download className="size-4" />}
            disabled={filtered.length === 0}
            onClick={onExport}
          >
            CSV-Export
          </Button>
        </div>
        <Input
          icon={<Search />}
          placeholder="Suche nach Name, Telefon, E-Mail, Adresse, Run…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
                  sortKey="phone"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Telefon
                </SortableTh>
                <SortableTh
                  sortKey="email"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  E-Mail
                </SortableTh>
                <SortableTh
                  sortKey="address"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Adresse
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
                  sortKey="metric"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  align="right"
                >
                  {config.metricHeader}
                </SortableTh>
                <SortableTh
                  sortKey="ts"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  {config.timestampLabel}
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-10 text-ink-muted text-sm"
                  >
                    {leads.length === 0 ? config.emptyText : "Keine Leads passen zur Suche."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.leadId}>
                    <TableCell className="font-medium text-ink">
                      {l.firstName ?? "—"}
                    </TableCell>
                    <TableCell className="text-ink">
                      {l.lastName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.phone ? (
                        <a
                          href={`tel:${l.phone}`}
                          className="text-brand-deep hover:underline whitespace-nowrap"
                        >
                          {l.phone}
                        </a>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.email ? (
                        <a
                          href={`mailto:${l.email}`}
                          className="text-brand-deep hover:underline truncate inline-block max-w-[200px]"
                          title={l.email}
                        >
                          {l.email}
                        </a>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-xs text-ink-soft truncate max-w-[200px]"
                      title={l.address ?? undefined}
                    >
                      {l.address ?? <span className="text-ink-muted">—</span>}
                    </TableCell>
                    <TableCell className="text-ink-muted text-xs truncate max-w-[140px]">
                      {l.runName}
                    </TableCell>
                    <TableCell>
                      {l.slug ? (
                        <a
                          href={`${leadBaseUrl}/${l.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                          title={`${leadBaseUrl}/${l.slug}`}
                        >
                          <ExternalLink className="size-3" />
                          /{l.slug}
                        </a>
                      ) : (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {config.metricValue(l)}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTimeDE(config.timestamp(l))}
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

// ── Sort comparator ─────────────────────────────────────────────────────────

function cmp(
  a: SerializableShareLead,
  b: SerializableShareLead,
  key: SortKey,
  dir: "asc" | "desc",
  config: BucketConfig,
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "firstName":
      return (a.firstName ?? "").localeCompare(b.firstName ?? "") * sign;
    case "lastName":
      return (a.lastName ?? "").localeCompare(b.lastName ?? "") * sign;
    case "phone":
      return (a.phone ?? "").localeCompare(b.phone ?? "") * sign;
    case "email":
      return (a.email ?? "").localeCompare(b.email ?? "") * sign;
    case "address":
      return (a.address ?? "").localeCompare(b.address ?? "") * sign;
    case "run":
      return a.runName.localeCompare(b.runName) * sign;
    case "metric":
      return (config.metricValue(a) - config.metricValue(b)) * sign;
    case "ts":
      return (tsOrZero(config.timestamp(a)) - tsOrZero(config.timestamp(b))) * sign;
  }
}

function tsOrZero(d: string | null): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

// ── CSV export ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  completed: "Fertig",
  failed: "Fehler",
  rendering: "Wird gerendert",
  uploading: "Wird hochgeladen",
  pending: "Wartet",
};

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

/**
 * Bunny-/Filesystem-safer Slugify nur für den Export-Dateinamen — keine
 * Umlaute, keine Sonderzeichen, lower-case.
 */
function slugifyFilename(input: string): string {
  if (!input) return "campaign";
  const lower = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return lower || "campaign";
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildCsvFilename(campaignName: string, bucket: BucketKind): string {
  return `share-${slugifyFilename(campaignName)}-engagement-${bucket}-${todayIso()}.csv`;
}

/**
 * Quote-and-escape ein einzelnes CSV-Feld. Doppelte Anführungszeichen werden
 * verdoppelt, das ganze Feld in `"…"` gewrappt — auch numerische Werte, damit
 * Excel führende Nullen (Telefon!) nicht abschneidet.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return `""`;
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_SEP = ";";
const CSV_EOL = "\r\n";

function buildCsv(
  rows: SerializableShareLead[],
  leadBaseUrl: string,
  config: BucketConfig,
): string {
  const header = [
    "Vorname",
    "Nachname",
    "Telefon",
    "E-Mail",
    "Adresse",
    "Run",
    "PageURL",
    "Status",
    config.metricHeader,
    config.timestampLabel,
  ];
  const lines: string[] = [];
  lines.push(header.map(csvField).join(CSV_SEP));
  for (const l of rows) {
    const url = l.slug ? `${leadBaseUrl}/${l.slug}` : "";
    lines.push(
      [
        l.firstName ?? "",
        l.lastName ?? "",
        l.phone ?? "",
        l.email ?? "",
        l.address ?? "",
        l.runName,
        url,
        statusLabel(l.status),
        config.metricValue(l),
        formatDateTimeDE(config.timestamp(l)),
      ]
        .map(csvField)
        .join(CSV_SEP),
    );
  }
  return lines.join(CSV_EOL);
}

function downloadCsv(csv: string, filename: string) {
  // UTF-8 BOM, damit Excel die Umlaute beim Doppelklick korrekt erkennt.
  const BOM = "﻿";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Kleiner Delay, damit Safari/Firefox den Blob noch lesen können.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
