"use client";

/**
 * Versandzentrale — Runden-Detail: Lead-Tabelle mit Bulk-Auswahl,
 * Sortierung per Klick auf Tabellen-Header (Export übernimmt EXAKT diese
 * Reihenfolge für Briefe UND Umschläge), Filtern, Teilexport mit
 * anschließendem Status-Dialog und E-Mail-Anbindung. Kontakt-Details
 * öffnen die GLOBALE Kontakt-Ansicht (identisch zu Kontakte & Listen).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  FileDown,
  Mail,
  Mailbox,
  MoreHorizontal,
  Search,
  Undo2,
} from "lucide-react";
import { ContactDetailSlideOver } from "../../kontakte/contact-detail-slideover";
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
  contactId: string | null;
  email: string | null;
  data: Record<string, string>;
  abVariant: "A" | "B" | null;
  hasPdf: boolean;
  hasEnvelope: boolean;
  letterStatus: "open" | "in_progress" | "sent" | "discarded";
  letterSentAt: string | null;
  letterExportedAt: string | null;
  letterReturnedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  ctaClickCount: number;
  lastCtaAt: string | null;
  emailStatus: string | null;
  emailHistory: LeadEmailHistoryItem[];
}

export interface LeadEmailHistoryItem {
  sentAt: string | null;
  status: string;
  repliedAt: string | null;
  subject: string;
}

type LetterStatus = "open" | "in_progress" | "sent" | "discarded";

/** E-Mail gilt als versendet, sobald sie raus ist (inkl. Klick/Antwort). */
const EMAIL_SENT_STATUSES = new Set(["sent", "clicked", "replied"]);

/** EIN Filter für alles — Brief-Status, E-Mail-Status und Spezialfälle. */
type LeadFilter =
  | "all"
  | "letter_open"
  | "letter_in_progress"
  | "letter_sent"
  | "letter_discarded"
  | "email_sent"
  | "sent_no_reaction"
  | "sent_today"
  | "sent_7d"
  | "returned";

const SORT_ORIGINAL = "__original__";
const PDFS_PER_FILE = [10, 25, 50, 100, 200, 500];

const LETTER_STATUS_META: Record<
  LetterStatus,
  { label: string; badge: "neutral" | "warn" | "success" | "danger" }
> = {
  open: { label: "Offen", badge: "neutral" },
  in_progress: { label: "In Bearbeitung", badge: "warn" },
  sent: { label: "Versendet", badge: "success" },
  discarded: { label: "Aussortiert", badge: "danger" },
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

const EMAIL_STATUS_BADGE: Record<
  string,
  "brand" | "success" | "warn" | "danger" | "neutral"
> = {
  scheduled: "neutral",
  sent: "success",
  clicked: "brand",
  replied: "brand",
  bounced: "danger",
  failed: "danger",
  skipped: "neutral",
  unsubscribed: "warn",
};

const FILTER_OPTIONS: {
  value: LeadFilter;
  label: string;
  letterOnly?: boolean;
}[] = [
  { value: "all", label: "Alle Leads" },
  { value: "letter_open", label: "Brief offen", letterOnly: true },
  { value: "letter_in_progress", label: "Brief in Bearbeitung", letterOnly: true },
  { value: "letter_sent", label: "Brief versendet", letterOnly: true },
  { value: "letter_discarded", label: "Aussortiert", letterOnly: true },
  { value: "email_sent", label: "E-Mail versendet" },
  { value: "sent_no_reaction", label: "Versendet ohne Reaktion", letterOnly: true },
  { value: "sent_today", label: "Heute versendet", letterOnly: true },
  { value: "sent_7d", label: "Letzte 7 Tage versendet", letterOnly: true },
  { value: "returned", label: "Rückläufer", letterOnly: true },
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return `${new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))} Uhr`;
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
  const [filter, setFilter] = React.useState<LeadFilter>("all");
  const [abFilter, setAbFilter] = React.useState<"all" | "A" | "B">("all");
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Dialoge
  const [exportMode, setExportMode] = React.useState<{
    ids: string[];
    envelopesOnly: boolean;
  } | null>(null);
  const [postExportIds, setPostExportIds] = React.useState<string[] | null>(null);
  const [sentDialogIds, setSentDialogIds] = React.useState<string[] | null>(null);
  // Globale Kontakt-Ansicht (identisch zu Kontakte & Listen); Fallback-Dialog
  // nur für Alt-Leads ohne verknüpften Kontakt + für den E-Mail-Verlauf.
  const [detailContactId, setDetailContactId] = React.useState<string | null>(
    null,
  );
  const [detailLead, setDetailLead] = React.useState<VersandLeadItem | null>(
    null,
  );

  // ── Filter + Sortierung ──────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;

    return leads.filter((l) => {
      switch (filter) {
        case "letter_open":
          if (l.letterStatus !== "open") return false;
          break;
        case "letter_in_progress":
          if (l.letterStatus !== "in_progress") return false;
          break;
        case "letter_sent":
          if (l.letterStatus !== "sent") return false;
          break;
        case "letter_discarded":
          if (l.letterStatus !== "discarded") return false;
          break;
        case "email_sent":
          if (!l.emailStatus || !EMAIL_SENT_STATUSES.has(l.emailStatus))
            return false;
          break;
        case "sent_no_reaction":
          if (l.letterStatus !== "sent" || reactedAfterSend(l)) return false;
          break;
        case "sent_today":
          if (!l.letterSentAt || new Date(l.letterSentAt) < todayStart)
            return false;
          break;
        case "sent_7d":
          if (!l.letterSentAt || new Date(l.letterSentAt).getTime() < sevenDaysAgo)
            return false;
          break;
        case "returned":
          if (!l.letterReturnedAt) return false;
          break;
      }
      if (abFilter !== "all" && l.abVariant !== abFilter) return false;
      if (q) {
        const hay = Object.values(l.data ?? {})
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, filter, abFilter, search]);

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

  // ── Kennzahlen ───────────────────────────────────────────────────────────
  // Kampagne ohne Brief-PDFs ⇒ komplette Brief-Steuerung ausblenden — der
  // User kann hier dann nur E-Mails verschicken.
  const hasLetters = React.useMemo(() => leads.some((l) => l.hasPdf), [leads]);
  const hasEnvelopes = React.useMemo(
    () => leads.some((l) => l.hasEnvelope),
    [leads],
  );

  const emailCounts = React.useMemo(() => {
    let sent = 0,
      scheduled = 0;
    for (const l of leads) {
      if (!l.emailStatus) continue;
      if (EMAIL_SENT_STATUSES.has(l.emailStatus)) sent++;
      if (l.emailStatus === "scheduled") scheduled++;
    }
    return { sent, scheduled };
  }, [leads]);

  const letterSentCount = React.useMemo(
    () => leads.filter((l) => l.letterStatus === "sent").length,
    [leads],
  );

  const discardedCount = React.useMemo(
    () => leads.filter((l) => l.letterStatus === "discarded").length,
    [leads],
  );

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
    const noun = `${ids.length} Brief${ids.length === 1 ? "" : "e"}`;
    const label =
      status === "sent"
        ? `${noun} als versendet markiert`
        : status === "in_progress"
          ? `${noun} auf „In Bearbeitung" gesetzt`
          : status === "discarded"
            ? `${noun} aussortiert`
            : `${noun} auf „Offen" zurückgesetzt`;
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

  /** Blast-Wizard mit vorausgewählten Leads öffnen. */
  function emailTo(ids: string[]) {
    try {
      sessionStorage.setItem(
        "vc-email-preselect",
        JSON.stringify({ campaignId, runId, leadIds: ids }),
      );
    } catch {
      /* Storage voll/blockiert → Wizard startet ohne Vorauswahl */
    }
    router.push(
      `/kampagnen/${campaignId}/email/neu?vorauswahl=1&zurueck=${encodeURIComponent(`/versand/${runId}`)}`,
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  // Aussortierte Leads bleiben bei „an alle"-Aktionen außen vor.
  const allLeadIds = React.useMemo(
    () => leads.filter((l) => l.letterStatus !== "discarded").map((l) => l.id),
    [leads],
  );

  /** Header-Klick: 1. Klick aufsteigend, 2. absteigend, 3. wie importiert. */
  function headerSort(col: string) {
    if (sortBy === col) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortBy(SORT_ORIGINAL);
        setSortDir("asc");
      }
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  /** Spalte, über die der Name-Header sortiert (beste Namens-Spalte der CSV). */
  const nameSortColumn = React.useMemo(() => {
    for (const re of [/nachname|last.?name/i, /^name$/i, /vorname|first.?name/i, /name/i]) {
      const hit = columns.find((c) => re.test(c));
      if (hit) return hit;
    }
    return null;
  }, [columns]);

  function SortableTh({ col, label }: { col: string | null; label: string }) {
    const active = col !== null && sortBy === col;
    return (
      <th className="px-3 py-2.5 font-semibold">
        {col ? (
          <button
            type="button"
            onClick={() => headerSort(col)}
            className={cn(
              "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink",
              active && "text-ink",
            )}
            title="Klicken zum Sortieren — die Reihenfolge gilt auch für den PDF-Export"
          >
            {label}
            {active &&
              (sortDir === "asc" ? (
                <ArrowUp className="size-3" />
              ) : (
                <ArrowDown className="size-3" />
              ))}
          </button>
        ) : (
          label
        )}
      </th>
    );
  }

  return (
    <>
      <PageHeader
        title={runName}
        subtitle={`Versand · Kampagne ${campaignName}`}
        actions={
          <>
            <Button
              asChild
              variant="ghost"
              iconLeft={<ArrowLeft className="size-4" />}
            >
              <Link href="/versand">Zur Versandzentrale</Link>
            </Button>
            {hasLetters ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="subtle"
                      iconRight={<ChevronDown className="size-4" />}
                      disabled={busy || leads.length === 0}
                    >
                      Mehr
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => emailTo(allLeadIds)}>
                      <Mail className="size-4" />
                      E-Mail an alle
                    </DropdownMenuItem>
                    {hasEnvelopes && (
                      <DropdownMenuItem
                        onSelect={() =>
                          setExportMode({ ids: allLeadIds, envelopesOnly: true })
                        }
                      >
                        <Mailbox className="size-4" />
                        Nur Umschläge herunterladen
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  iconLeft={<FileDown className="size-4" />}
                  onClick={() =>
                    setExportMode({ ids: allLeadIds, envelopesOnly: false })
                  }
                  disabled={busy || leads.length === 0}
                >
                  PDF-Bundle herunterladen
                </Button>
              </>
            ) : (
              <Button
                iconLeft={<Mail className="size-4" />}
                onClick={() => emailTo(allLeadIds)}
                disabled={busy || leads.length === 0}
              >
                E-Mail an alle
              </Button>
            )}
          </>
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

      {/* Drei einfache Kennzahlen — keine Filter, keine Fachbegriffe */}
      <div className="mb-6 flex flex-wrap gap-3">
        <div className="w-48 rounded-squircle-lg bg-surface p-4 shadow-card">
          <p className="text-xs font-medium text-ink-muted">
            Leads in dieser Runde
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {leads.length}
          </p>
          {discardedCount > 0 && (
            <p className="text-xs text-red-600">
              davon {discardedCount} aussortiert
            </p>
          )}
        </div>
        {hasLetters && (
          <div className="w-48 rounded-squircle-lg bg-surface p-4 shadow-card">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Mailbox className="size-3.5" />
              Per Post versendet
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {letterSentCount}
              <span className="text-sm font-medium text-ink-muted">
                {" "}
                von {leads.length}
              </span>
            </p>
          </div>
        )}
        <div className="w-48 rounded-squircle-lg bg-surface p-4 shadow-card">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Mail className="size-3.5" />
            Per E-Mail versendet
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            {emailCounts.sent}
            <span className="text-sm font-medium text-ink-muted">
              {" "}
              von {leads.length}
            </span>
          </p>
          {emailCounts.scheduled > 0 && (
            <p className="text-xs text-ink-muted">
              {emailCounts.scheduled} in Warteschlange
            </p>
          )}
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

        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as LeadFilter)}
        >
          <SelectTrigger
            className={cn(
              "h-auto w-auto rounded-full border-0 py-2 shadow-card",
              filter !== "all" && "ring-2 ring-brand/40",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.filter((o) => hasLetters || !o.letterOnly).map(
              (o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value === "all" ? o.label : `Filter: ${o.label}`}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>

        {abActive && (
          <Select
            value={abFilter}
            onValueChange={(v) => setAbFilter(v as "all" | "A" | "B")}
          >
            <SelectTrigger
              className={cn(
                "h-auto w-auto rounded-full border-0 py-2 shadow-card",
                abFilter !== "all" && "ring-2 ring-brand/40",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Brief A + B</SelectItem>
              <SelectItem value="A">Nur Brief A</SelectItem>
              <SelectItem value="B">Nur Brief B</SelectItem>
            </SelectContent>
          </Select>
        )}

        {sortBy !== SORT_ORIGINAL && (
          <button
            type="button"
            onClick={() => {
              setSortBy(SORT_ORIGINAL);
              setSortDir("asc");
            }}
            className="rounded-full bg-surface-muted px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
            title="Zurück zur Reihenfolge, wie die Liste importiert wurde"
          >
            Sortiert nach „{sortBy}" · zurücksetzen
          </button>
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
                <SortableTh col={nameSortColumn} label="Name" />
                {infoColumns.map((col) => (
                  <SortableTh key={col} col={col} label={col} />
                ))}
                {hasLetters && (
                  <th className="px-3 py-2.5 font-semibold">Brief</th>
                )}
                <th className="px-3 py-2.5 font-semibold">E-Mail</th>
                <th className="w-12 px-4 py-2.5">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const isSel = selected.has(l.id);
                const meta = LETTER_STATUS_META[l.letterStatus];
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
                    <td
                      className="px-3 py-3 font-medium text-ink"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          l.contactId
                            ? setDetailContactId(l.contactId)
                            : setDetailLead(l)
                        }
                        className="text-left underline-offset-2 hover:underline"
                        title="Kontakt-Details öffnen"
                      >
                        <span className="line-clamp-1">
                          {displayName(l.data)}
                        </span>
                      </button>
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
                        {l.letterReturnedAt && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600">
                            <Undo2 className="size-3" />
                            Rückläufer
                          </span>
                        )}
                      </div>
                    </td>
                    )}
                    <td
                      className="px-3 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {l.email && (
                        <span
                          className="block max-w-48 truncate text-xs text-ink"
                          title={l.email}
                        >
                          {l.email}
                        </span>
                      )}
                      {l.emailHistory.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDetailLead(l)}
                          className="group/email mt-0.5 text-left"
                          title="E-Mail-Verlauf anzeigen"
                        >
                          <Badge
                            variant={
                              EMAIL_STATUS_BADGE[l.emailStatus ?? ""] ??
                              "neutral"
                            }
                            dot
                          >
                            {EMAIL_STATUS_LABELS[l.emailStatus ?? ""] ??
                              l.emailStatus}
                          </Badge>
                          <span className="mt-0.5 block text-[11px] text-ink-muted underline-offset-2 group-hover/email:underline">
                            {(() => {
                              const sentMails = l.emailHistory.filter(
                                (m) => m.sentAt,
                              );
                              if (sentMails.length === 0)
                                return "Noch keine gesendet";
                              const last =
                                sentMails[sentMails.length - 1].sentAt;
                              return `${sentMails.length}× gesendet · zuletzt ${formatDate(last)}`;
                            })()}
                          </span>
                        </button>
                      ) : (
                        !l.email && (
                          <span className="text-xs text-ink-muted">—</span>
                        )
                      )}
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                            title="Aktionen für diesen Lead"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => emailTo([l.id])}>
                            <Mail className="size-4" />
                            E-Mail verschicken
                          </DropdownMenuItem>
                          {l.hasPdf && (
                            <DropdownMenuItem asChild>
                              <a
                                href={`/api/leads/${l.id}/pdf`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <FileDown className="size-4" />
                                Brief herunterladen
                              </a>
                            </DropdownMenuItem>
                          )}
                          {l.hasEnvelope && (
                            <DropdownMenuItem asChild>
                              <a
                                href={`/api/leads/${l.id}/envelope-pdf`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Mailbox className="size-4" />
                                Umschlag herunterladen
                              </a>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                    >
                      Status setzen
                      <ChevronDown className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="font-medium text-emerald-700 focus:bg-emerald-500/10"
                      onSelect={() => setSentDialogIds(selectedVisible)}
                    >
                      <span className="size-2 rounded-full bg-emerald-500" />
                      Versendet …
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="font-medium text-amber-700 focus:bg-amber-500/10"
                      onSelect={() =>
                        void markStatus(selectedVisible, "in_progress")
                      }
                    >
                      <span className="size-2 rounded-full bg-amber-500" />
                      In Bearbeitung
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="font-medium"
                      onSelect={() => void markStatus(selectedVisible, "open")}
                    >
                      <span className="size-2 rounded-full bg-ink-muted" />
                      Offen
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="font-medium text-red-600 focus:bg-red-500/10"
                      onSelect={() =>
                        void markStatus(selectedVisible, "discarded")
                      }
                    >
                      <span className="size-2 rounded-full bg-red-500" />
                      Aussortiert
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  onClick={() =>
                    setExportMode({ ids: selectedVisible, envelopesOnly: false })
                  }
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/90 disabled:opacity-50"
                >
                  <FileDown className="size-3.5" />
                  PDFs exportieren
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => emailTo(selectedVisible)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/90 disabled:opacity-50"
            >
              <Mail className="size-3.5" />
              E-Mail versenden
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

      {detailContactId && (
        <ContactDetailSlideOver
          contactId={detailContactId}
          onClose={() => setDetailContactId(null)}
          onChanged={() => router.refresh()}
        />
      )}

      <LeadDetailDialog
        lead={detailLead}
        onClose={() => setDetailLead(null)}
        abActive={abActive}
      />

      <ExportDialog
        mode={exportMode}
        onClose={() => setExportMode(null)}
        runId={runId}
        runName={runName}
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
          setExportMode(null);
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
    </>
  );
}

// ── Export-Dialog ──────────────────────────────────────────────────────────

function ExportDialog({
  mode,
  onClose,
  runId,
  runName,
  totalCompleted,
  sortBy,
  sortDir,
  onExported,
}: {
  mode: { ids: string[]; envelopesOnly: boolean } | null;
  onClose: () => void;
  runId: string;
  runName: string;
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
  const leadIds = mode?.ids ?? [];
  const envelopesOnly = mode?.envelopesOnly ?? false;
  const isPartial = leadIds.length < totalCompleted;

  async function handleDownload() {
    if (downloading || !mode) return;
    setDownloading(true);
    toast({
      variant: "default",
      title: envelopesOnly
        ? "Umschläge werden vorbereitet …"
        : "Bundle wird vorbereitet …",
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
          ...(envelopesOnly ? { envelopesOnly: true } : {}),
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
      if (envelopesOnly) {
        // Kein Export-Protokoll, kein Status-Dialog — Umschläge sind
        // nur Beilage, der Brief-Status bleibt unberührt.
        toast({ variant: "success", title: "Umschläge heruntergeladen" });
        onClose();
      } else {
        onExported(leadIds);
      }
    } catch (err) {
      toast({
        variant: "danger",
        title: envelopesOnly
          ? "Umschläge konnten nicht erstellt werden"
          : "Bundle konnte nicht erstellt werden",
        description:
          err instanceof Error ? err.message : "Bitte erneut versuchen.",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {envelopesOnly
              ? `${leadIds.length} Umschl${leadIds.length === 1 ? "ag" : "äge"} herunterladen`
              : `${leadIds.length} Brief${leadIds.length === 1 ? "" : "e"} exportieren`}
          </DialogTitle>
          <DialogDescription>
            {isPartial
              ? `Teilexport: ${leadIds.length} von ${totalCompleted} Leads. `
              : envelopesOnly
                ? "Alle Umschläge dieser Runde — ohne Briefe. "
                : "Alle Briefe dieser Runde. "}
            {envelopesOnly
              ? "Die Reihenfolge ist exakt die der Tabelle (so wie sie gerade sortiert ist)."
              : "Umschläge kommen automatisch mit — in exakt derselben Reihenfolge wie die Briefe (so wie die Tabelle gerade sortiert ist)."}
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
            iconLeft={
              envelopesOnly ? (
                <Mailbox className="size-4" />
              ) : (
                <FileDown className="size-4" />
              )
            }
            loading={downloading}
            disabled={downloading}
          >
            {downloading
              ? "Wird erstellt …"
              : envelopesOnly
                ? "Umschläge herunterladen"
                : "ZIP herunterladen"}
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
      <DialogContent size="md">
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
      <DialogContent size="md">
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
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              id="vz-sent-date"
              type="date"
              value={dateValue}
              max={todayInputValue()}
              onChange={(e) => setDateValue(e.target.value)}
              className="w-44"
            />
            {(
              [
                ["Heute", 0],
                ["Gestern", 1],
              ] as const
            ).map(([label, daysAgo]) => {
              const d = new Date();
              d.setDate(d.getDate() - daysAgo);
              const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDateValue(value)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    dateValue === value
                      ? "bg-ink text-white"
                      : "bg-surface-muted text-ink-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
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

// ── Lead-Detail-Dialog ─────────────────────────────────────────────────────

function LeadDetailDialog({
  lead,
  onClose,
  abActive,
}: {
  lead: VersandLeadItem | null;
  onClose: () => void;
  abActive: boolean;
}) {
  const sectionHeading =
    "mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted";
  return (
    <Dialog open={lead !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {lead ? displayName(lead.data) : ""}
            {abActive && lead?.abVariant && (
              <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs font-semibold text-ink-muted align-middle">
                Brief {lead.abVariant}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Alles zu diesem Lead in dieser Runde — Brief, E-Mails und Daten.
          </DialogDescription>
        </DialogHeader>

        {lead && (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            {/* Brief */}
            {lead.hasPdf && (
              <section>
                <p className={sectionHeading}>
                  <Mailbox className="size-3.5" />
                  Brief per Post
                </p>
                <div className="flex flex-wrap items-center gap-2 rounded-squircle-md bg-surface-soft px-3.5 py-2.5 text-sm">
                  <Badge variant={LETTER_STATUS_META[lead.letterStatus].badge} dot>
                    {LETTER_STATUS_META[lead.letterStatus].label}
                  </Badge>
                  {lead.letterSentAt && (
                    <span className="text-ink-muted">
                      Versendet am {formatDate(lead.letterSentAt)}
                    </span>
                  )}
                  {lead.letterStatus !== "sent" && lead.letterExportedAt && (
                    <span className="text-ink-muted">
                      Exportiert am {formatDate(lead.letterExportedAt)}
                    </span>
                  )}
                  {lead.letterReturnedAt && (
                    <span className="inline-flex items-center gap-1 font-medium text-red-600">
                      <Undo2 className="size-3.5" />
                      Rückläufer seit {formatDate(lead.letterReturnedAt)}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* E-Mails */}
            <section>
              <p className={sectionHeading}>
                <Mail className="size-3.5" />
                E-Mails
              </p>
              {lead.email && (
                <p className="mb-1.5 text-sm text-ink">
                  <a
                    href={`mailto:${lead.email}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {lead.email}
                  </a>
                </p>
              )}
              {lead.emailHistory.length === 0 ? (
                <p className="rounded-squircle-md bg-surface-soft px-3.5 py-2.5 text-sm text-ink-muted">
                  Noch keine E-Mail an diesen Lead versendet.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {lead.emailHistory
                    .slice()
                    .reverse()
                    .map((m, i) => (
                      <li
                        key={i}
                        className="rounded-squircle-md bg-surface-soft px-3.5 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium tabular-nums text-ink">
                            {m.sentAt
                              ? formatDateTime(m.sentAt)
                              : "Wartet in der Warteschlange"}
                          </span>
                          <Badge
                            variant={EMAIL_STATUS_BADGE[m.status] ?? "neutral"}
                            dot
                          >
                            {EMAIL_STATUS_LABELS[m.status] ?? m.status}
                          </Badge>
                        </div>
                        {m.subject && (
                          <p className="mt-1 text-sm text-ink line-clamp-1">
                            „{m.subject}“
                          </p>
                        )}
                        {m.repliedAt && (
                          <p className="mt-0.5 text-[11px] font-medium text-brand">
                            Antwort erhalten am {formatDateTime(m.repliedAt)}
                          </p>
                        )}
                      </li>
                    ))}
                </ol>
              )}
            </section>

            {/* Reaktion */}
            <section>
              <p className={sectionHeading}>
                <CheckCircle2 className="size-3.5" />
                Reaktion
              </p>
              <div className="rounded-squircle-md bg-surface-soft px-3.5 py-2.5 text-sm text-ink">
                {lead.viewCount === 0 && lead.ctaClickCount === 0 ? (
                  <span className="text-ink-muted">
                    Landingpage bisher nicht aufgerufen.
                  </span>
                ) : (
                  <>
                    <p>
                      Landingpage {lead.viewCount}× aufgerufen
                      {lead.lastViewedAt
                        ? ` · zuletzt am ${formatDate(lead.lastViewedAt)}`
                        : ""}
                    </p>
                    {lead.ctaClickCount > 0 && (
                      <p>
                        Kontakt-Button {lead.ctaClickCount}× geklickt
                        {lead.lastCtaAt
                          ? ` · zuletzt am ${formatDate(lead.lastCtaAt)}`
                          : ""}
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* Daten aus der Lead-Liste */}
            <section>
              <p className={sectionHeading}>Daten aus deiner Lead-Liste</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-squircle-md bg-surface-soft px-3.5 py-2.5 text-sm sm:grid-cols-2">
                {Object.entries(lead.data ?? {}).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      {key}
                    </dt>
                    <dd className="truncate text-ink" title={value}>
                      {value || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Schließen</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
