"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import type { ShareRemovedReason } from "@/lib/db/queries/campaign-shares";
import type { SerializableShareRemovedLead } from "../share-dashboard";
import { formatDateTimeDE } from "../share-dashboard";

type SortKey =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "address"
  | "run"
  | "reason"
  | "removedAt";

interface ShareRemovedTabProps {
  leads: SerializableShareRemovedLead[];
  /**
   * Wird aktuell in der Aussortiert-Tabelle nicht direkt verwendet (keine
   * PageURL-Spalte für entfernte Leads), bleibt aber im Prop-Vertrag, damit
   * spätere UI-Ergänzungen (z.B. "Ursprung-Link für Duplikate") konsistent
   * mit den anderen Tabs angebunden werden können.
   */
  leadBaseUrl: string;
}

/**
 * Mapping `removed_reason` → deutsches Label + Badge-Variant. Single source of
 * truth für sowohl die Header-Filter-Select-Optionen als auch den Zellen-
 * Badge in der Tabelle.
 */
const REASON_META: Record<
  ShareRemovedReason,
  { label: string; variant: "warn" | "danger" | "neutral" }
> = {
  duplicate: { label: "Duplikat", variant: "warn" },
  user_rejected: { label: "Manuell entfernt", variant: "neutral" },
  auto_failed: { label: "Auto-Fail", variant: "danger" },
  pipeline_failed: { label: "Pipeline-Fehler", variant: "danger" },
  incomplete_data: { label: "Unvollständige Daten", variant: "warn" },
};

const ALL_REASONS: ShareRemovedReason[] = [
  "duplicate",
  "user_rejected",
  "auto_failed",
  "pipeline_failed",
  "incomplete_data",
];

function reasonLabel(r: ShareRemovedReason | null): string {
  if (!r) return "—";
  return REASON_META[r]?.label ?? r;
}

/**
 * Verdichtet `removed_detail` in eine kurze, menschenlesbare Zeile. Wir
 * unterscheiden:
 *
 *  - `duplicate`:    Wir zeigen entweder `duplicate_of_lead_id` (wenn vom
 *                    Server gesetzt) oder, falls vorhanden, die strukturierte
 *                    `duplicateOfRowIndex` aus der typisierten Variante.
 *                    Bewusst KEIN Slug-Lookup in v1 — würde einen zusätzlichen
 *                    Backend-Roundtrip pro Lead erfordern.
 *  - sonstige:       Falls ein freier `reason_text` oder `message` mitgeliefert
 *                    wurde → diesen Wert.
 *  - Fallback:       "—".
 *
 * Wir typisieren das Detail bewusst als `Record<string, unknown>` und greifen
 * defensiv zu, weil die strukturierte Form (siehe `RemovedDetail`) historisch
 * gewachsen ist und ältere Rows abweichende Schemata haben können.
 */
function detailSummary(detail: Record<string, unknown> | null): string {
  if (!detail) return "—";

  // Frei-Text-Felder zuerst — die haben Vorrang, weil ein Operator sie
  // explizit als Kommentar gesetzt hat.
  const freeText =
    pickString(detail, "reason_text") ?? pickString(detail, "message");
  if (freeText) return freeText;

  // Duplikat-Spezifik. Wir zeigen sowohl die snake_case-Variante (`duplicate_
  // of_lead_id`) als auch die strukturierte Form (`duplicateOfRowIndex` aus
  // `RemovedDetail`). v1: KEIN Slug-Lookup — wir zeigen die rohe UUID/Index-
  // Nummer, damit der Customer sehen kann WELCHER andere Lead das Duplikat
  // ausgelöst hat.
  const dupId = pickString(detail, "duplicate_of_lead_id");
  if (dupId) return `Duplikat von ${dupId}`;

  const dupRow = pickNumber(detail, "duplicateOfRowIndex");
  if (dupRow !== null) return `Duplikat von Zeile #${dupRow}`;

  // Strukturierte Detail-Felder aus `RemovedDetail`-Variants:
  const missing = pickStringArray(detail, "missingColumns");
  if (missing && missing.length > 0) {
    return `Fehlende Felder: ${missing.join(", ")}`;
  }

  return "—";
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | null {
  const v = obj[key];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
    return v as string[];
  }
  return null;
}

/**
 * Aussortiert-Tab der Public-Share-Sicht. Zeigt alle Leads mit
 * `removed_at IS NOT NULL` zusammen mit Grund (badge) und einer kurzen
 * Detail-Zeile aus `removed_detail`. Filterung/Sortierung läuft komplett
 * client-side über das vom Server initial mitgegebene Set.
 */
export function ShareRemovedTab({ leads }: ShareRemovedTabProps) {
  const [search, setSearch] = React.useState("");
  const [runFilter, setRunFilter] = React.useState<string>("all");
  const [reasonFilter, setReasonFilter] = React.useState<string>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("removedAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const runs = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of leads) {
      if (!seen.has(l.runId)) seen.set(l.runId, l.runName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [leads]);

  // Distinct Reasons in den Daten — wir zeigen nur Filter-Optionen, die
  // tatsächlich vorkommen, damit der Operator keine leeren Buckets sieht.
  const reasonsInData = React.useMemo(() => {
    const set = new Set<ShareRemovedReason>();
    for (const l of leads) {
      if (l.removedReason) set.add(l.removedReason);
    }
    // Stable order: orientiert sich an ALL_REASONS, damit die Dropdown-
    // Reihenfolge nicht je nach Datenset wackelt.
    return ALL_REASONS.filter((r) => set.has(r));
  }, [leads]);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter((l) => {
      if (runFilter !== "all" && l.runId !== runFilter) return false;
      if (reasonFilter !== "all" && (l.removedReason ?? "") !== reasonFilter)
        return false;
      if (!term) return true;
      const first = (l.firstName ?? "").toLowerCase();
      const last = (l.lastName ?? "").toLowerCase();
      const run = l.runName.toLowerCase();
      const phone = (l.phone ?? "").toLowerCase();
      const email = (l.email ?? "").toLowerCase();
      const address = (l.address ?? "").toLowerCase();
      const reasonLbl = reasonLabel(l.removedReason).toLowerCase();
      return (
        first.includes(term) ||
        last.includes(term) ||
        run.includes(term) ||
        phone.includes(term) ||
        email.includes(term) ||
        address.includes(term) ||
        reasonLbl.includes(term)
      );
    });
    return out.slice().sort((a, b) => sortCmp(a, b, sortKey, sortDir));
  }, [leads, search, runFilter, reasonFilter, sortKey, sortDir]);

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
    setRunFilter("all");
    setReasonFilter("all");
  }

  const filtersActive =
    search.trim() !== "" || runFilter !== "all" || reasonFilter !== "all";

  if (leads.length === 0) {
    return (
      <Card className="p-12">
        <p className="text-center text-sm text-ink-muted">
          Keine Leads wurden ausgesortiert.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,200px,220px,auto] gap-3 items-end">
          <Input
            icon={<Search />}
            placeholder="Suche nach Name, Telefon, E-Mail, Adresse, Run, Grund…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Grund" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Gründe</SelectItem>
              {reasonsInData.map((r) => (
                <SelectItem key={r} value={r}>
                  {REASON_META[r].label}
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
                  sortKey="email"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  E-Mail
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
                <SortableTh
                  sortKey="reason"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Grund
                </SortableTh>
                <TableHead>Detail</TableHead>
                <SortableTh
                  sortKey="removedAt"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                >
                  Entfernt am
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-12 text-ink-muted text-sm"
                  >
                    Keine Leads für die aktuellen Filter.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => {
                  const meta = l.removedReason
                    ? REASON_META[l.removedReason]
                    : null;
                  return (
                    <TableRow key={l.leadId}>
                      <TableCell className="font-medium text-ink">
                        {l.firstName ?? "—"}
                      </TableCell>
                      <TableCell className="text-ink">
                        {l.lastName ?? "—"}
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
                      <TableCell
                        className="text-xs text-ink-soft truncate max-w-[200px]"
                        title={l.address ?? undefined}
                      >
                        {l.address ?? (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted text-xs truncate max-w-[180px]">
                        {l.runName}
                      </TableCell>
                      <TableCell>
                        {meta ? (
                          <Badge variant={meta.variant} dot>
                            {meta.label}
                          </Badge>
                        ) : (
                          <span className="text-ink-muted text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-xs text-ink-soft truncate max-w-[260px]"
                        title={detailSummary(l.removedDetail)}
                      >
                        {detailSummary(l.removedDetail)}
                      </TableCell>
                      <TableCell className="text-xs text-ink-muted whitespace-nowrap">
                        {formatDateTimeDE(l.removedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-muted tabular-nums">
          {leads.length.toLocaleString("de-DE")} Leads ausgesortiert
          {filtered.length !== leads.length && (
            <> ({filtered.length.toLocaleString("de-DE")} gefiltert)</>
          )}
        </span>
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
}: {
  sortKey: SortKey;
  current: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = sortKey === current;
  return (
    <TableHead>
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
  a: SerializableShareRemovedLead,
  b: SerializableShareRemovedLead,
  key: SortKey,
  dir: "asc" | "desc",
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
    case "reason":
      return reasonLabel(a.removedReason).localeCompare(
        reasonLabel(b.removedReason),
      ) * sign;
    case "removedAt": {
      const av = new Date(a.removedAt).getTime();
      const bv = new Date(b.removedAt).getTime();
      return (av - bv) * sign;
    }
  }
}
