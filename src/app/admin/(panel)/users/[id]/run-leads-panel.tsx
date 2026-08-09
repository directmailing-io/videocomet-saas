"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";

/**
 * Admin-Drilldown in eine Runde als Modal: Lead-Liste mit Suche,
 * Status-Filter und Pagination (skaliert bis 500+ Leads), Artefakt-Links
 * (Landingpage immer im Preview-Modus — kein View-Tracking!) und
 * Neu-Generieren nach Artefakt-Typ (ganze Runde oder einzelner Lead).
 */

interface AdminLeadRow {
  id: string;
  rowIndex: number;
  name: string;
  slug: string | null;
  lpUrl: string | null;
  status: string;
  errorMessage: string | null;
  currentStage: string | null;
  attempts: number;
  videoUrl: string | null;
  videoMp4Url: string | null;
  pdfUrl: string | null;
  envelopePdfUrl: string | null;
  introStatus: string | null;
  preflightStatus: string;
  preflightErrorMessage: string | null;
  removedAt: string | null;
  removedReason: string | null;
  viewCount: number;
}

interface LeadsResponse {
  run: { id: string; name: string; status: string };
  leads: AdminLeadRow[];
}

const PAGE_SIZE = 50;

const LEAD_STATUS_LABELS: Record<string, string> = {
  pending: "Wartet",
  rendering: "Rendert",
  uploading: "Lädt hoch",
  completed: "Fertig",
  failed: "Fehler",
};

const STATUS_FILTERS = [
  { value: "all", label: "Alle Status" },
  { value: "completed", label: "Fertig" },
  { value: "failed", label: "Fehler" },
  { value: "working", label: "In Arbeit" },
  { value: "removed", label: "Entfernt" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const RUN_MODES: {
  mode: string;
  label: string;
  confirm: string;
  danger?: boolean;
}[] = [
  {
    mode: "all",
    label: "Ganze Runde neu",
    confirm:
      "WIRKLICH die GANZE Runde neu generieren? Alle Videos, Landingpages, Briefe und Umschläge werden neu erstellt.",
    danger: true,
  },
  {
    mode: "video",
    label: "Nur Videos neu",
    confirm: "Nur die Videos aller Leads dieser Runde neu generieren?",
  },
  {
    mode: "pdf",
    label: "Nur Briefe neu",
    confirm: "Nur die Brief-PDFs aller Leads dieser Runde neu generieren?",
  },
  {
    mode: "envelope",
    label: "Nur Umschläge neu",
    confirm: "Nur die Umschlag-PDFs aller Leads dieser Runde neu generieren?",
  },
  {
    mode: "landingpage",
    label: "Nur Landingpages neu",
    confirm:
      "Landingpages dieser Runde aktualisieren? Geht sofort — Videos und Briefe bleiben unverändert.",
  },
];

const LEAD_SCOPES: { scope: string; label: string; confirm: string }[] = [
  {
    scope: "all",
    label: "Alles neu",
    confirm: "komplett neu generieren (Video + Landingpage + Brief + Umschlag)?",
  },
  { scope: "video", label: "Nur Video neu", confirm: "nur das Video neu generieren?" },
  { scope: "pdf", label: "Nur Brief neu", confirm: "nur den Brief neu generieren?" },
  {
    scope: "envelope",
    label: "Nur Umschlag neu",
    confirm: "nur den Umschlag neu generieren?",
  },
];

function leadStatusVariant(
  status: string,
): "brand" | "success" | "warn" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "pending") return "neutral";
  return "brand";
}

function ArtifactLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) {
    return <span className="text-ink-muted/40">{label}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-brand-deep hover:underline whitespace-nowrap"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function RunLeadsDialog({
  runId,
  runName,
  open,
  onOpenChange,
}: {
  runId: string;
  runName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = React.useState<LeadsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [page, setPage] = React.useState(0);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/runs/${runId}/leads`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Fehler ${res.status}`);
      }
      setData((await res.json()) as LeadsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen.");
    }
  }, [runId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function regenerate(
    kind: "run" | "lead",
    id: string,
    payload: Record<string, string>,
    confirmText: string,
  ) {
    if (!window.confirm(confirmText)) return;
    setBusy(id);
    try {
      const url =
        kind === "run"
          ? `/api/admin/runs/${id}/regenerate`
          : `/api/admin/leads/${id}/regenerate`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Fehler ${res.status}`);
      }
      toast({
        title: "Neu angestoßen",
        description:
          payload.mode === "landingpage"
            ? "Landingpages wurden aktualisiert."
            : kind === "run"
              ? `${body?.retried ?? "?"} Leads wurden neu eingereiht.`
              : "Lead wurde neu eingereiht.",
      });
      await load();
    } catch (e) {
      toast({
        title: "Fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler.",
        variant: "danger",
      });
    } finally {
      setBusy(null);
    }
  }

  const allLeads = data?.leads ?? [];
  const failedCount = allLeads.filter(
    (l) => l.status === "failed" && !l.removedAt,
  ).length;
  const runBusy = busy === runId;
  const runRunning = data?.run.status === "generating";

  const q = query.trim().toLowerCase();
  const filtered = allLeads.filter((l) => {
    if (statusFilter === "removed") {
      if (!l.removedAt) return false;
    } else if (statusFilter === "working") {
      if (l.removedAt) return false;
      if (!["pending", "rendering", "uploading"].includes(l.status))
        return false;
    } else if (statusFilter !== "all") {
      if (l.removedAt || l.status !== statusFilter) return false;
    }
    if (!q) return true;
    return (
      l.name.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      (l.slug ?? "").toLowerCase().includes(q)
    );
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageLeads = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min((safePage + 1) * PAGE_SIZE, filtered.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="max-w-5xl p-0 gap-0 max-h-[88vh] grid-rows-[auto_auto_1fr_auto] overflow-hidden"
      >
        {/* Kopf: Run-Name, Status, Zähler */}
        <div className="px-5 pt-5 pb-3 border-b border-line/60">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>Leads · {runName}</DialogTitle>
            {data ? (
              <Badge variant={runRunning ? "brand" : "neutral"} dot>
                {runRunning ? "Läuft gerade" : "Abgeschlossen"}
              </Badge>
            ) : null}
          </div>
          <DialogDescription className="mt-1">
            {data ? (
              <>
                {allLeads.length} Leads
                {failedCount > 0 ? (
                  <span className="text-danger">
                    {" "}
                    · {failedCount} fehlgeschlagen
                  </span>
                ) : null}
                {runRunning
                  ? " — Runde läuft, Neu-Generieren ist erst nach Abschluss möglich."
                  : ""}
              </>
            ) : (
              "Lade Leads …"
            )}
          </DialogDescription>
        </div>

        {/* Toolbar: Suche, Filter, Neu-Generieren */}
        <div className="px-5 py-3 border-b border-line/60 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Lead suchen (Name, ID, Slug) …"
              className="w-full rounded-full border border-line bg-surface pl-8 pr-3 py-1.5 text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(0);
            }}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={runBusy || runRunning}>
                <RefreshCw
                  className={`size-3.5 mr-1.5 ${runBusy ? "animate-spin" : ""}`}
                />
                Neu generieren
                <ChevronDown className="size-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Ganze Runde</DropdownMenuLabel>
              {failedCount > 0 ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void regenerate(
                      "run",
                      runId,
                      { mode: "failed" },
                      `${failedCount} fehlgeschlagene Leads dieser Runde neu generieren?`,
                    )
                  }
                >
                  Nur Fehlgeschlagene ({failedCount})
                </DropdownMenuItem>
              ) : null}
              {RUN_MODES.map((m) => (
                <React.Fragment key={m.mode}>
                  {m.danger ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    danger={m.danger}
                    onSelect={() =>
                      void regenerate("run", runId, { mode: m.mode }, m.confirm)
                    }
                  >
                    {m.label}
                  </DropdownMenuItem>
                </React.Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Tabelle */}
        <div className="overflow-auto px-5">
          {error ? (
            <div className="py-6 text-sm text-danger">
              {error}{" "}
              <button className="underline" onClick={() => void load()}>
                Erneut versuchen
              </button>
            </div>
          ) : !data ? (
            <div className="py-6 text-sm text-ink-muted">Lade Leads …</div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-sm text-ink-muted">
              Keine Leads gefunden
              {q || statusFilter !== "all" ? " — Filter anpassen?" : "."}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
                  <th className="py-2 pr-3 font-semibold">#</th>
                  <th className="py-2 pr-3 font-semibold">Lead</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Artefakte</th>
                  <th className="py-2 pr-3 font-semibold">Fehler</th>
                  <th className="py-2 font-semibold text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {pageLeads.map((l) => {
                  const removed = Boolean(l.removedAt);
                  const errText =
                    l.errorMessage ??
                    l.preflightErrorMessage ??
                    (removed
                      ? `Entfernt (${l.removedReason ?? "manuell"})`
                      : null);
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-line/50 last:border-0 ${
                        removed ? "opacity-50" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 text-ink-muted tabular-nums">
                        {l.rowIndex + 1}
                      </td>
                      <td className="py-2 pr-3 max-w-[200px]">
                        <span
                          className="font-medium text-ink block truncate"
                          title={`${l.name}\nID: ${l.id}`}
                        >
                          {l.name}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge variant={leadStatusVariant(l.status)} dot>
                          {LEAD_STATUS_LABELS[l.status] ?? l.status}
                        </Badge>
                        {l.attempts > 1 ? (
                          <span
                            className="ml-1 text-[10px] text-ink-muted"
                            title={`${l.attempts} Versuche`}
                          >
                            ×{l.attempts}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <ArtifactLink
                            href={l.videoMp4Url ?? l.videoUrl}
                            label="Video"
                          />
                          <ArtifactLink
                            href={
                              l.lpUrl ??
                              (l.slug ? `/v/${l.slug}?preview=1` : null)
                            }
                            label="Landingpage"
                          />
                          <ArtifactLink href={l.pdfUrl} label="Brief" />
                          <ArtifactLink
                            href={l.envelopePdfUrl}
                            label="Umschlag"
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-3 max-w-[220px]">
                        {errText ? (
                          <span
                            className="text-danger block truncate"
                            title={errText}
                          >
                            {errText}
                          </span>
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                busy === l.id || runBusy || runRunning || removed
                              }
                            >
                              <RefreshCw
                                className={`size-3.5 mr-1 ${
                                  busy === l.id ? "animate-spin" : ""
                                }`}
                              />
                              Neu
                              <ChevronDown className="size-3 ml-0.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {LEAD_SCOPES.map((s) => (
                              <DropdownMenuItem
                                key={s.scope}
                                onSelect={() =>
                                  void regenerate(
                                    "lead",
                                    l.id,
                                    { scope: s.scope },
                                    `Lead "${l.name}" ${s.confirm}`,
                                  )
                                }
                              >
                                {s.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Fuß: Pagination */}
        <div className="px-5 py-3 border-t border-line/60 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-muted">
            {filtered.length > 0
              ? `Zeige ${from}–${to} von ${filtered.length} Leads`
              : "Keine Leads"}
            {filtered.length !== allLeads.length
              ? ` (gefiltert aus ${allLeads.length})`
              : ""}
          </span>
          {pageCount > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Zurück
              </Button>
              <span className="text-xs text-ink-muted tabular-nums px-1">
                Seite {safePage + 1}/{pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Weiter
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
