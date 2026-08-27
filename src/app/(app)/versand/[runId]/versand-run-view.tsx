"use client";

/**
 * Versandzentrale — Runden-Detail: Lead-Tabelle mit Bulk-Auswahl,
 * Sortierung nach beliebiger CSV-Spalte (Export übernimmt EXAKT diese
 * Reihenfolge für Briefe UND Umschläge), Filtern, Teilexport mit
 * anschließendem Status-Dialog (Nichts ändern / In Bearbeitung /
 * Versendet + Datum) und E-Mail-Anbindung.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpZA,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileDown,
  Mail,
  Mailbox,
  Search,
  Undo2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPersonName } from "@/lib/format-name";
import { sortLeadsForBundle } from "@/lib/bundle-helpers";
import { cn } from "@/lib/utils";

// ── Typen ──────────────────────────────────────────────────────────────────

export interface VersandLeadItem {
  id: string;
  rowIndex: number;
  data: Record<string, string>;
  abVariant: "A" | "B" | null;
  hasPdf: boolean;
  letterStatus: "open" | "in_progress" | "sent";
  letterSentAt: string | null;
  letterExportedAt: string | null;
  letterPlannedAt: string | null;
  letterReturnedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  ctaClickCount: number;
  lastCtaAt: string | null;
  emailStatus: string | null;
}

type LetterStatus = "open" | "in_progress" | "sent";
type StatusFilter = "all" | LetterStatus | "email_sent";

/** E-Mail gilt als versendet, sobald sie raus ist (inkl. Klick/Antwort). */
const EMAIL_SENT_STATUSES = new Set(["sent", "clicked", "replied"]);
type ExtraFilter =
  | "all"
  | "sent_no_reaction"
  | "sent_today"
  | "sent_7d"
  | "planned"
  | "returned";

const SORT_ORIGINAL = "__original__";
const PDFS_PER_FILE = [10, 25, 50, 100, 200, 500];

const LETTER_STATUS_META: Record<
  LetterStatus,
  { label: string; badge: "neutral" | "warn" | "success" }
> = {
  open: { label: "Offen", badge: "neutral" },
  in_progress: { label: "In Bearbeitung", badge: "warn" },
  sent: { label: "Versendet", badge: "success" },
};

const EMAIL_STATUS_LABELS: Record<string, string> = {
  scheduled: "Geplant",
  sent: "Gesendet",
  clicked: "Geklickt",
  replied: "Antwort erhalten",
  bounced: "Unzustellbar",
  failed: "Fehlgeschlagen",
  skipped: "Übersprungen",
  unsubscribed: "Abgemeldet",
};

const EXTRA_FILTER_OPTIONS: { value: ExtraFilter; label: string }[] = [
  { value: "all", label: "Alle anzeigen" },
  { value: "sent_no_reaction", label: "Versendet ohne Reaktion" },
  { value: "sent_today", label: "Heute versendet" },
  { value: "sent_7d", label: "Letzte 7 Tage versendet" },
  { value: "planned", label: "Mit geplantem Termin" },
  { value: "returned", label: "Rückläufer" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function displayName(d: Record<string, string>): string {
  const first = d.firstName || d.Vorname || "";
  const last = d.lastName || d.Nachname || "";
  const composed =
    [first, last].filter(Boolean).join(" ") || d.name || d.fullName || "";
  return composed ? formatPersonName(composed) : `Zeile ?`;
}

/** Reaktion NACH Versanddatum (davor = eigene Tests, zählt nicht). */
function reactedAfterSend(l: VersandLeadItem): boolean {
  if (l.letterStatus !== "sent" || !l.letterSentAt) return false;
  const sent = new Date(l.letterSentAt).getTime();
  const viewed = l.lastViewedAt ? new Date(l.lastViewedAt).getTime() : 0;
  const cta = l.lastCtaAt ? new Date(l.lastCtaAt).getTime() : 0;
  return viewed > sent || cta > sent;
}

function isStuckInProgress(l: VersandLeadItem): boolean {
  if (l.letterStatus !== "in_progress" || !l.letterExportedAt) return false;
  return Date.now() - new Date(l.letterExportedAt).getTime() > 7 * 86_400_000;
}

/** Datum-Input (YYYY-MM-DD) → ISO mit 12:00 lokal, damit die Zeitzone den Tag nicht verschiebt. */
function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString();
}

function todayInputValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function defaultBaseName(runName: string): string {
  return (
    runName
      .replace(/[äöüÄÖÜß]/g, (c) =>
        ({ ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" })[c] ?? c,
      )
      .replace(/[^a-zA-Z0-9-_ ]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60) || "videocomet"
  );
}

// ── Hauptkomponente ────────────────────────────────────────────────────────

export function VersandRunView({
  runId,
  runName,
  campaignId,
  campaignName,
  abActive,
  columns,
  notCompletedCount,
  leads: initialLeads,
}: {
  runId: string;
  runName: string;
  runStatus: string;
  campaignId: string;
  campaignName: string;
  abActive: boolean;
  columns: string[];
  notCompletedCount: number;
  leads: VersandLeadItem[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [leads, setLeads] = React.useState(initialLeads);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = React.useState(SORT_ORIGINAL);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [extraFilter, setExtraFilter] = React.useState<ExtraFilter>("all");
  const [abFilter, setAbFilter] = React.useState<"all" | "A" | "B">("all");
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Dialoge
  const [exportOpen, setExportOpen] = React.useState(false);
  const [postExportIds, setPostExportIds] = React.useState<string[] | null>(null);
  const [sentDialogIds, setSentDialogIds] = React.useState<string[] | null>(null);
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false);

  // ── Filter + Sortierung ──────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;

    return leads.filter((l) => {
      if (statusFilter === "email_sent") {
        if (!l.emailStatus || !EMAIL_SENT_STATUSES.has(l.emailStatus))
          return false;
      } else if (statusFilter !== "all" && l.letterStatus !== statusFilter) {
        return false;
      }
      if (abFilter !== "all" && l.abVariant !== abFilter) return false;
      if (extraFilter === "sent_no_reaction") {
        if (l.letterStatus !== "sent" || reactedAfterSend(l)) return false;
      } else if (extraFilter === "sent_today") {
        if (!l.letterSentAt || new Date(l.letterSentAt) < todayStart) return false;
      } else if (extraFilter === "sent_7d") {
        if (!l.letterSentAt || new Date(l.letterSentAt).getTime() < sevenDaysAgo)
          return false;
      } else if (extraFilter === "planned") {
        if (!l.letterPlannedAt || l.letterStatus === "sent") return false;
      } else if (extraFilter === "returned") {
        if (!l.letterReturnedAt) return false;
      }
      if (q) {
        const hay = Object.values(l.data ?? {})
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, statusFilter, extraFilter, abFilter, search]);

  const sorted = React.useMemo(() => {
    // EXAKT derselbe Sortier-Algorithmus wie der Bundle-Export auf dem
    // Server (sortLeadsForBundle) — was der User hier sieht, ist die
    // Kuvertier-Reihenfolge im ZIP.
    if (sortBy === SORT_ORIGINAL) return filtered;
    return sortLeadsForBundle(
      filtered as unknown as Parameters<typeof sortLeadsForBundle>[0],
      sortBy,
      sortDir,
    ) as unknown as VersandLeadItem[];
  }, [filtered, sortBy, sortDir]);

  // Anzeige-Spalten: bekannte Info-Spalten (Firma/PLZ/Ort) sofern vorhanden;
  // die aktive Sortier-Spalte wird immer mit angezeigt.
  const infoColumns = React.useMemo(() => {
    const found: string[] = [];
    const lower = columns.map((c) => [c, c.toLowerCase()] as const);
    for (const patterns of [
      ["firma", "company", "unternehmen"],
      ["plz", "zip", "postleitzahl"],
      ["ort", "city", "stadt"],
    ]) {
      const hit = lower.find(([, lc]) => patterns.some((p) => lc.includes(p)));
      if (hit) found.push(hit[0]);
    }
    if (
      sortBy !== SORT_ORIGINAL &&
      !found.includes(sortBy) &&
      !/name|vorname|nachname/i.test(sortBy)
    ) {
      found.unshift(sortBy);
    }
    return found.slice(0, 3);
  }, [columns, sortBy]);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  // Kampagne ohne Brief-PDFs ⇒ komplette Brief-Steuerung ausblenden — der
  // User kann hier dann nur E-Mails verschicken.
  const hasLetters = React.useMemo(() => leads.some((l) => l.hasPdf), [leads]);

  const emailCounts = React.useMemo(() => {
    let sent = 0,
      scheduled = 0,
      replied = 0;
    for (const l of leads) {
      if (!l.emailStatus) continue;
      if (EMAIL_SENT_STATUSES.has(l.emailStatus)) sent++;
      if (l.emailStatus === "scheduled") scheduled++;
      if (l.emailStatus === "replied") replied++;
    }
    return { sent, scheduled, replied };
  }, [leads]);

  const counts = React.useMemo(() => {
    let open = 0,
      inProgress = 0,
      sent = 0,
      reacted = 0;
    for (const l of leads) {
      if (l.letterStatus === "open") open++;
      else if (l.letterStatus === "in_progress") inProgress++;
      else {
        sent++;
        if (reactedAfterSend(l)) reacted++;
      }
    }
    return { open, inProgress, sent, reacted };
  }, [leads]);

  const stuckLeads = React.useMemo(() => leads.filter(isStuckInProgress), [leads]);

  // ── Auswahl ──────────────────────────────────────────────────────────────
  const visibleIds = React.useMemo(() => sorted.map((l) => l.id), [sorted]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── API-Aktionen ─────────────────────────────────────────────────────────
  async function applyLetterAction(
    ids: string[],
    body: Record<string, unknown>,
    successMsg: string,
    patch: (l: VersandLeadItem) => VersandLeadItem,
  ): Promise<boolean> {
    if (busy || ids.length === 0) return false;
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}/letter-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, ...body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const idSet = new Set(ids);
      setLeads((prev) => prev.map((l) => (idSet.has(l.id) ? patch(l) : l)));
      setSelected(new Set());
      toast({ variant: "success", title: successMsg });
      router.refresh();
      return true;
    } catch (err) {
      toast({
        variant: "danger",
        title: "Aktion fehlgeschlagen",
        description:
          err instanceof Error ? err.message : "Bitte erneut versuchen.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function markStatus(ids: string[], status: LetterStatus, sentAtIso?: string) {
    const label =
      status === "sent"
        ? `${ids.length} Brief${ids.length === 1 ? "" : "e"} als versendet markiert`
        : status === "in_progress"
          ? `${ids.length} Brief${ids.length === 1 ? "" : "e"} auf „In Bearbeitung" gesetzt`
          : `${ids.length} Brief${ids.length === 1 ? "" : "e"} auf „Offen" zurückgesetzt`;
    return applyLetterAction(
      ids,
      { action: "status", status, ...(sentAtIso ? { sentAt: sentAtIso } : {}) },
      label,
      (l) => ({
        ...l,
        letterStatus: status,
        letterSentAt:
          status === "sent" ? (sentAtIso ?? new Date().toISOString()) : null,
      }),
    );
  }

  /** 7-Tage-Hinweis: 1 Klick — versendet, rückdatiert aufs Exportdatum. */
  async function resolveStuck() {
    if (busy || stuckLeads.length === 0) return;
    // Gruppen nach Exportdatum (das API nimmt EIN sentAt pro Call).
    const groups = new Map<string, string[]>();
    for (const l of stuckLeads) {
      const key = l.letterExportedAt ?? new Date().toISOString();
      groups.set(key, [...(groups.get(key) ?? []), l.id]);
    }
    setBusy(true);
    try {
      for (const [sentAt, ids] of Array.from(groups.entries())) {
        const res = await fetch(`/api/runs/${runId}/letter-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadIds: ids, action: "status", status: "sent", sentAt }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const idSet = new Set(ids);
        setLeads((prev) =>
          prev.map((l) =>
            idSet.has(l.id)
              ? { ...l, letterStatus: "sent" as const, letterSentAt: sentAt }
              : l,
          ),
        );
      }
      toast({
        variant: "success",
        title: `${stuckLeads.length} Brief${stuckLeads.length === 1 ? "" : "e"} als versendet markiert`,
        description: "Versanddatum = jeweiliges Exportdatum.",
      });
      router.refresh();
    } catch {
      toast({
        variant: "danger",
        title: "Markierung fehlgeschlagen",
        description: "Bitte erneut versuchen.",
      });
    } finally {
      setBusy(false);
    }
  }

  /** „E-Mail an Auswahl" → Blast-Wizard mit vorausgewählten Leads. */
  function emailToSelection() {
    try {
      sessionStorage.setItem(
        "vc-email-preselect",
        JSON.stringify({ campaignId, runId, leadIds: selectedVisible }),
      );
    } catch {
      /* Storage voll/blockiert → Wizard startet ohne Vorauswahl */
    }
    router.push(`/kampagnen/${campaignId}/email/neu?vorauswahl=1`);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const kpiCards: {
    key: StatusFilter;
    label: string;
    value: number;
    sub?: string;
    dot: string;
  }[] = [
    { key: "open", label: "Offen", value: counts.open, dot: "bg-ink-muted/50" },
    {
      key: "in_progress",
      label: "In Bearbeitung",
      value: counts.inProgress,
      dot: "bg-amber-500",
    },
    {
      key: "sent",
      label: "Versendet",
      value: counts.sent,
      sub:
        counts.sent > 0
          ? `${counts.reacted} Reaktion${counts.reacted === 1 ? "" : "en"} danach`
          : undefined,
      dot: "bg-emerald-500",
    },
  ];

  const emailSubParts: string[] = [];
  if (emailCounts.scheduled > 0)
    emailSubParts.push(`${emailCounts.scheduled} in Warteschlange`);
  if (emailCounts.replied > 0)
    emailSubParts.push(
      `${emailCounts.replied} Antwort${emailCounts.replied === 1 ? "" : "en"}`,
    );
  const emailKpiCard = {
    key: "email_sent" as StatusFilter,
    label: "Versendet",
    value: emailCounts.sent,
    sub:
      emailSubParts.length > 0
        ? emailSubParts.join(" · ")
        : emailCounts.sent === 0
          ? "Noch keine E-Mails versendet"
          : undefined,
    dot: "bg-brand",
  };

  function renderKpiCard(c: {
    key: StatusFilter;
    label: string;
    value: number;
    sub?: string;
    dot: string;
  }) {
    const active = statusFilter === c.key;
    return (
      <button
        key={c.key}
        type="button"
        onClick={() => setStatusFilter(active ? "all" : c.key)}
        className={cn(
          "h-full w-full rounded-squircle-lg bg-surface p-4 text-left shadow-card transition-all",
          active
            ? "ring-2 ring-brand/40"
            : "hover:shadow-card-hover hover:-translate-y-0.5",
        )}
        aria-pressed={active}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <span className={cn("size-2 rounded-full", c.dot)} />
          {c.label}
          {active && <span className="text-brand">· Filter aktiv</span>}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums text-ink">
          {c.value}
        </div>
        {c.sub && <div className="text-xs text-ink-muted">{c.sub}</div>}
      </button>
    );
  }

  return (
    <>
      <PageHeader
        title={runName}
        subtitle={`Versand · Kampagne ${campaignName}`}
        actions={
          <Button asChild variant="ghost" iconLeft={<ArrowLeft className="size-4" />}>
            <Link href="/versand">Zur Versandzentrale</Link>
          </Button>
        }
      />

      {/* 7-Tage-Hinweis */}
      {stuckLeads.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-squircle-lg bg-amber-500/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="size-4 shrink-0" />
            {stuckLeads.length === 1
              ? "1 Brief ist seit über 7 Tagen „In Bearbeitung“ — schon versendet?"
              : `${stuckLeads.length} Briefe sind seit über 7 Tagen „In Bearbeitung“ — schon versendet?`}
          </p>
          <Button size="sm" variant="ghost" onClick={resolveStuck} disabled={busy}>
            Ja, als versendet markieren (Datum = Exportdatum)
          </Button>
        </div>
      )}

      {/* Hinweis auf nicht fertige Leads */}
      {notCompletedCount > 0 && (
        <p className="mb-4 text-xs text-ink-muted">
          {notCompletedCount} Lead{notCompletedCount === 1 ? "" : "s"} dieser
          Runde {notCompletedCount === 1 ? "ist" : "sind"} noch nicht fertig
          generiert und {notCompletedCount === 1 ? "fehlt" : "fehlen"} deshalb
          hier.
        </p>
      )}

      {/* KPI-Karten = Status-Filter, klar nach Kanal gruppiert */}
      <div className="mb-4 grid gap-x-4 gap-y-3 lg:grid-cols-4">
        {hasLetters && (
          <div className="lg:col-span-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <Mailbox className="size-3.5" />
              Briefe per Post
            </p>
            <div className="grid grid-cols-3 gap-3">
              {kpiCards.map((c) => renderKpiCard(c))}
            </div>
          </div>
        )}
        <div className={hasLetters ? undefined : "max-w-xs"}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            <Mail className="size-3.5" />
            E-Mails
          </p>
          {renderKpiCard(emailKpiCard)}
        </div>
      </div>

      {/* Werkzeugleiste */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen …"
            className="w-44 rounded-full bg-surface py-2 pl-9 pr-3 text-sm text-ink shadow-card placeholder:text-ink-muted outline-none ring-brand/40 transition-shadow focus:ring-2"
          />
        </div>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SORT_ORIGINAL}>
              Sortierung: wie importiert
            </SelectItem>
            {columns.map((col) => (
              <SelectItem key={col} value={col}>
                Sortieren nach: {col}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sortBy !== SORT_ORIGINAL && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            iconLeft={
              sortDir === "asc" ? (
                <ArrowDownAZ className="size-4" />
              ) : (
                <ArrowUpZA className="size-4" />
              )
            }
          >
            {sortDir === "asc" ? "Aufsteigend" : "Absteigend"}
          </Button>
        )}

        {hasLetters && (
          <Select
            value={extraFilter}
            onValueChange={(v) => setExtraFilter(v as ExtraFilter)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXTRA_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value === "all" ? o.label : `Filter: ${o.label}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {abActive && (
          <Select
            value={abFilter}
            onValueChange={(v) => setAbFilter(v as "all" | "A" | "B")}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Brief A + B</SelectItem>
              <SelectItem value="A">Nur Brief A</SelectItem>
              <SelectItem value="B">Nur Brief B</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Tabelle */}
      {sorted.length === 0 ? (
        <div className="bg-surface rounded-squircle-lg shadow-card">
          <EmptyState
            icon={<Search />}
            title="Keine Leads gefunden"
            subtitle="Passe Filter oder Suche an, um Leads zu sehen."
          />
        </div>
      ) : (
        <div className="bg-surface rounded-squircle-lg shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="w-10 px-4 py-2.5">
                  <Checkbox
                    checked={
                      allVisibleSelected
                        ? true
                        : selectedVisible.length > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={toggleAll}
                    aria-label="Alle sichtbaren Leads auswählen"
                  />
                </th>
                <th className="px-3 py-2.5 font-semibold">Name</th>
                {infoColumns.map((col) => (
                  <th key={col} className="px-3 py-2.5 font-semibold">
                    {col}
                  </th>
                ))}
                {hasLetters && (
                  <th className="px-3 py-2.5 font-semibold">Brief</th>
                )}
                <th className="px-3 py-2.5 font-semibold">E-Mail</th>
                <th className="px-4 py-2.5 font-semibold">Reaktion</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const isSel = selected.has(l.id);
                const meta = LETTER_STATUS_META[l.letterStatus];
                const reacted = reactedAfterSend(l);
                return (
                  <tr
                    key={l.id}
                    onClick={() => toggleOne(l.id)}
                    className={cn(
                      "cursor-pointer border-b border-line-soft last:border-0 transition-colors",
                      isSel ? "bg-brand-soft/40" : "hover:bg-surface-soft",
                    )}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleOne(l.id)}
                        aria-label="Lead auswählen"
                      />
                    </td>
                    <td className="px-3 py-3 font-medium text-ink">
                      <span className="line-clamp-1">{displayName(l.data)}</span>
                      {abActive && l.abVariant && (
                        <span className="ml-1.5 rounded bg-surface-muted px-1 text-[10px] font-semibold text-ink-muted">
                          {l.abVariant}
                        </span>
                      )}
                    </td>
                    {infoColumns.map((col) => (
                      <td key={col} className="px-3 py-3 text-ink-muted">
                        <span className="line-clamp-1">{l.data?.[col] ?? "—"}</span>
                      </td>
                    ))}
                    {hasLetters && (
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={meta.badge} dot>
                          {meta.label}
                        </Badge>
                        {l.letterStatus === "sent" && l.letterSentAt && (
                          <span className="text-xs tabular-nums text-ink-muted">
                            {formatDate(l.letterSentAt)}
                          </span>
                        )}
                        {l.letterStatus !== "sent" && l.letterPlannedAt && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-brand">
                            <CalendarClock className="size-3" />
                            {formatDate(l.letterPlannedAt)}
                          </span>
                        )}
                        {l.letterReturnedAt && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600">
                            <Undo2 className="size-3" />
                            Rückläufer
                          </span>
                        )}
                      </div>
                    </td>
                    )}
                    <td className="px-3 py-3 text-xs text-ink-muted">
                      {l.emailStatus
                        ? (EMAIL_STATUS_LABELS[l.emailStatus] ?? l.emailStatus)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {reacted ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                          <CheckCircle2 className="size-3.5" />
                          Reagiert
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky Auswahl-Leiste */}
      {selectedVisible.length > 0 && (
        <div className="sticky bottom-4 z-20 mt-4 flex justify-center">
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-white shadow-ink">
            <span className="text-sm font-semibold tabular-nums">
              {selectedVisible.length} ausgewählt
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Aufheben
            </button>
            <span className="mx-1 h-4 w-px bg-white/20" />
            {hasLetters && (
              <>
                <button
                  type="button"
                  onClick={() => setExportOpen(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/90 disabled:opacity-50"
                >
                  <FileDown className="size-3.5" />
                  PDFs exportieren
                </button>
                <button
                  type="button"
                  onClick={() => setSentDialogIds(selectedVisible)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-3.5" />
                  Als versendet markieren
                </button>
              </>
            )}
            <button
              type="button"
              onClick={emailToSelection}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              <Mail className="size-3.5" />
              E-Mail an Auswahl
            </button>
            {hasLetters && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  Mehr
                  <ChevronDown className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => void markStatus(selectedVisible, "in_progress")}
                >
                  Status: In Bearbeitung
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void markStatus(selectedVisible, "open")}
                >
                  Status: Offen (zurücksetzen)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPlanDialogOpen(true)}>
                  Versandtermin planen …
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void applyLetterAction(
                      selectedVisible,
                      { action: "plan", plannedAt: null },
                      "Geplante Termine entfernt",
                      (l) => ({ ...l, letterPlannedAt: null }),
                    )
                  }
                >
                  Geplanten Termin entfernen
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void applyLetterAction(
                      selectedVisible,
                      { action: "returned", returned: true },
                      "Als Rückläufer markiert",
                      (l) => ({
                        ...l,
                        letterReturnedAt: new Date().toISOString(),
                      }),
                    )
                  }
                >
                  Als Rückläufer markieren
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void applyLetterAction(
                      selectedVisible,
                      { action: "returned", returned: false },
                      "Rückläufer-Markierung entfernt",
                      (l) => ({ ...l, letterReturnedAt: null }),
                    )
                  }
                >
                  Rückläufer-Markierung entfernen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        runId={runId}
        runName={runName}
        leadIds={selectedVisible}
        totalCompleted={leads.length}
        sortBy={sortBy === SORT_ORIGINAL ? undefined : sortBy}
        sortDir={sortDir}
        onExported={(ids) => {
          const now = new Date().toISOString();
          const idSet = new Set(ids);
          setLeads((prev) =>
            prev.map((l) =>
              idSet.has(l.id) ? { ...l, letterExportedAt: now } : l,
            ),
          );
          setExportOpen(false);
          setPostExportIds(ids);
        }}
      />

      <PostExportDialog
        ids={postExportIds}
        onClose={() => setPostExportIds(null)}
        busy={busy}
        onApply={async (choice, dateValue) => {
          if (!postExportIds) return;
          if (choice === "in_progress") {
            await markStatus(postExportIds, "in_progress");
          } else if (choice === "sent") {
            await markStatus(postExportIds, "sent", dateInputToIso(dateValue));
          }
          setPostExportIds(null);
        }}
      />

      <MarkSentDialog
        ids={sentDialogIds}
        onClose={() => setSentDialogIds(null)}
        busy={busy}
        onApply={async (dateValue) => {
          if (!sentDialogIds) return;
          const ok = await markStatus(
            sentDialogIds,
            "sent",
            dateInputToIso(dateValue),
          );
          if (ok) setSentDialogIds(null);
        }}
      />

      <PlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        busy={busy}
        onApply={async (dateValue) => {
          const ids = selectedVisible;
          const iso = dateInputToIso(dateValue);
          const ok = await applyLetterAction(
            ids,
            { action: "plan", plannedAt: iso },
            `Versandtermin für ${ids.length} Brief${ids.length === 1 ? "" : "e"} geplant`,
            (l) => ({ ...l, letterPlannedAt: iso }),
          );
          if (ok) setPlanDialogOpen(false);
        }}
      />
    </>
  );
}

// ── Export-Dialog ──────────────────────────────────────────────────────────

function ExportDialog({
  open,
  onOpenChange,
  runId,
  runName,
  leadIds,
  totalCompleted,
  sortBy,
  sortDir,
  onExported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  runId: string;
  runName: string;
  leadIds: string[];
  totalCompleted: number;
  sortBy: string | undefined;
  sortDir: "asc" | "desc";
  onExported: (ids: string[]) => void;
}) {
  const { toast } = useToast();
  const defaultBase = React.useMemo(() => defaultBaseName(runName), [runName]);
  const [baseName, setBaseName] = React.useState(defaultBase);
  const [pdfsPerFile, setPdfsPerFile] = React.useState("100");
  const [downloading, setDownloading] = React.useState(false);
  const isPartial = leadIds.length < totalCompleted;

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    toast({
      variant: "default",
      title: "Bundle wird vorbereitet …",
      description:
        "Der Download startet automatisch. Kann bei vielen Leads einige Sekunden dauern.",
    });
    try {
      const res = await fetch(`/api/runs/${runId}/pdf-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfsPerFile: Number(pdfsPerFile),
          baseName: baseName.trim() || defaultBase,
          leadIds,
          ...(sortBy ? { sortBy, sortDir } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const nameMatch = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename =
        (nameMatch && decodeURIComponent(nameMatch[1])) ??
        `${baseName.trim() || defaultBase}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onExported(leadIds);
    } catch (err) {
      toast({
        variant: "danger",
        title: "Bundle konnte nicht erstellt werden",
        description:
          err instanceof Error ? err.message : "Bitte erneut versuchen.",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {leadIds.length} Brief{leadIds.length === 1 ? "" : "e"} exportieren
          </DialogTitle>
          <DialogDescription>
            {isPartial
              ? `Teilexport: ${leadIds.length} von ${totalCompleted} Briefen. `
              : "Alle Briefe dieser Runde. "}
            Umschläge kommen automatisch mit — in exakt derselben Reihenfolge
            wie die Briefe (so wie die Tabelle gerade sortiert ist).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="vz-export-name">Dateiname</Label>
            <Input
              id="vz-export-name"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="vz-export-size">PDFs pro Datei</Label>
            <Select value={pdfsPerFile} onValueChange={setPdfsPerFile}>
              <SelectTrigger id="vz-export-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PDFS_PER_FILE.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} Leads pro PDF
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={downloading}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            onClick={handleDownload}
            iconLeft={<FileDown className="size-4" />}
            loading={downloading}
            disabled={downloading}
          >
            {downloading ? "Wird erstellt …" : "ZIP herunterladen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Nach-Export-Dialog: Nichts ändern / In Bearbeitung / Versendet ─────────

function PostExportDialog({
  ids,
  onClose,
  busy,
  onApply,
}: {
  ids: string[] | null;
  onClose: () => void;
  busy: boolean;
  onApply: (
    choice: "keep" | "in_progress" | "sent",
    dateValue: string,
  ) => void | Promise<void>;
}) {
  const [choice, setChoice] = React.useState<"keep" | "in_progress" | "sent">(
    "in_progress",
  );
  const [dateValue, setDateValue] = React.useState(todayInputValue());

  React.useEffect(() => {
    if (ids) {
      setChoice("in_progress");
      setDateValue(todayInputValue());
    }
  }, [ids]);

  const n = ids?.length ?? 0;
  const options: {
    value: "keep" | "in_progress" | "sent";
    label: string;
    hint: string;
  }[] = [
    {
      value: "keep",
      label: "Nichts ändern",
      hint: "Das war nur ein Test-Export — Status und Statistik bleiben unberührt.",
    },
    {
      value: "in_progress",
      label: "In Bearbeitung",
      hint: "Die Briefe werden jetzt gedruckt und kuvertiert.",
    },
    {
      value: "sent",
      label: "Versendet",
      hint: "Die Briefe sind (oder werden heute) zur Post gebracht.",
    },
  ];

  return (
    <Dialog open={ids !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>ZIP heruntergeladen — wie geht es weiter?</DialogTitle>
          <DialogDescription>
            Was soll mit {n === 1 ? "dem exportierten Brief" : `den ${n} exportierten Briefen`} passieren?
            Nichts ändert sich automatisch — du entscheidest.
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Status nach Export" className="space-y-1.5 py-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={choice === opt.value}
              onClick={() => setChoice(opt.value)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-squircle-sm px-3 py-2.5 text-left transition-colors",
                choice === opt.value
                  ? "bg-brand-soft/60 ring-2 ring-brand/30"
                  : "bg-surface-soft hover:bg-brand-soft/30",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1 size-3.5 shrink-0 rounded-full border-2",
                  choice === opt.value ? "border-brand bg-brand" : "border-line",
                )}
              />
              <span>
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="block text-xs text-ink-muted">{opt.hint}</span>
              </span>
            </button>
          ))}
          {choice === "sent" && (
            <div className="pl-9 pt-1">
              <Label htmlFor="vz-post-export-date">Versanddatum</Label>
              <Input
                id="vz-post-export-date"
                type="date"
                value={dateValue}
                max={todayInputValue()}
                onChange={(e) => setDateValue(e.target.value)}
                className="mt-1 w-44"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => void onApply(choice, dateValue)}
            loading={busy}
            disabled={busy || (choice === "sent" && !dateValue)}
          >
            Übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Versendet-Dialog (aus der Auswahl-Leiste) ──────────────────────────────

function MarkSentDialog({
  ids,
  onClose,
  busy,
  onApply,
}: {
  ids: string[] | null;
  onClose: () => void;
  busy: boolean;
  onApply: (dateValue: string) => void | Promise<void>;
}) {
  const [dateValue, setDateValue] = React.useState(todayInputValue());

  React.useEffect(() => {
    if (ids) setDateValue(todayInputValue());
  }, [ids]);

  const n = ids?.length ?? 0;

  return (
    <Dialog open={ids !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {n} Brief{n === 1 ? "" : "e"} als versendet markieren
          </DialogTitle>
          <DialogDescription>
            Ab diesem Datum zählen Aufrufe der Landingpage als echte Reaktion.
            Das Datum darf in der Vergangenheit liegen, falls die Briefe schon
            früher rausgegangen sind.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label htmlFor="vz-sent-date">Versanddatum</Label>
          <Input
            id="vz-sent-date"
            type="date"
            value={dateValue}
            max={todayInputValue()}
            onChange={(e) => setDateValue(e.target.value)}
            className="mt-1 w-44"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            onClick={() => void onApply(dateValue)}
            loading={busy}
            disabled={busy || !dateValue}
            iconLeft={<CheckCircle2 className="size-4" />}
          >
            Als versendet markieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Versandtermin-Dialog ───────────────────────────────────────────────────

function PlanDialog({
  open,
  onOpenChange,
  busy,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  onApply: (dateValue: string) => void | Promise<void>;
}) {
  const [dateValue, setDateValue] = React.useState("");

  React.useEffect(() => {
    if (open) setDateValue("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Versandtermin planen</DialogTitle>
          <DialogDescription>
            Reine Erinnerung für dich — es wird nichts automatisch versendet.
            Der Termin erscheint in der Übersicht und an den Leads.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label htmlFor="vz-plan-date">Geplantes Versanddatum</Label>
          <Input
            id="vz-plan-date"
            type="date"
            value={dateValue}
            min={todayInputValue()}
            onChange={(e) => setDateValue(e.target.value)}
            className="mt-1 w-44"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            onClick={() => void onApply(dateValue)}
            loading={busy}
            disabled={busy || !dateValue}
            iconLeft={<CalendarClock className="size-4" />}
          >
            Termin speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
