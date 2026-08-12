"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  FileText,
  Mail as MailIcon,
  MoreVertical,
  ExternalLink,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { runStatusLabel, runStatusVariant } from "@/lib/run-status";
import { formatRunEta, type RunEtaEntry } from "@/lib/run-eta-format";
import { BulkExportDialog, type BulkExportType } from "./bulk-export-dialog";
import { ResetTrackingDialog } from "./reset-tracking-dialog";

export interface RunRow {
  id: string;
  name: string;
  status:
    | "draft"
    | "mapping"
    | "preflighting"
    | "awaiting_approval"
    | "approved"
    | "generating"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** A/B-Test-Snapshot + Live-Zähler je Variante (null = ohne A/B-Test). */
  ab: {
    mode: "random" | "sequential";
    weightA: number;
    leadsA: number;
    leadsB: number;
    viewedA: number;
    viewedB: number;
  } | null;
  /** Server-ETA (W3) — nur bei status=generating gefüllt. */
  eta?: RunEtaEntry | null;
  /** Ausgabe-Kennzahlen für die Icon-Spalte. */
  letterCount: number;
  envelopeCount: number;
  emailSentCount: number;
}

function abModeLabel(mode: "random" | "sequential"): string {
  return mode === "sequential" ? "Der Reihe nach" : "Zufällig";
}

function abOpenRate(viewed: number, total: number): string {
  if (total <= 0) return "–";
  return `${Math.round((viewed / total) * 100)} %`;
}

/**
 * Kompakte A/B-Zelle: Verteilungs-Regel als Badge, darunter die
 * Öffnungsrate beider Brief-Varianten. Details (Plays, Watch-Time, CTA)
 * stehen in der Varianten-Auswertung im Übersicht-Tab.
 */
function AbCell({ ab }: { ab: NonNullable<RunRow["ab"]> }) {
  return (
    <div className="space-y-1">
      <Badge variant="brand">
        A/B · {ab.weightA}/{100 - ab.weightA} · {abModeLabel(ab.mode)}
      </Badge>
      <div className="flex items-center gap-3 text-xs text-ink-muted tabular-nums whitespace-nowrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <span className="font-semibold text-ink">A</span>{" "}
              {abOpenRate(ab.viewedA, ab.leadsA)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Brief A: {ab.viewedA} von {ab.leadsA} Leads geöffnet
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <span className="font-semibold text-ink">B</span>{" "}
              {abOpenRate(ab.viewedB, ab.leadsB)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Brief B: {ab.viewedB} von {ab.leadsB} Leads geöffnet
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

interface RunsTableProps {
  campaignId: string;
  campaignName: string;
  initialRuns: RunRow[];
  /** Aus der Kampagne abgeleitet: sind die Ausgabekanäle grundsätzlich konfiguriert? */
  campaignHasLetters: boolean;
  campaignHasEnvelopes: boolean;
  campaignHasEmail: boolean;
}

/**
 * A run is eligible for the bulk-PDF export when it is completed AND has at
 * least one successfully generated lead.
 */
function canBulkExport(r: RunRow): boolean {
  return r.status === "completed" && r.completedLeads > 0;
}

/**
 * Auswählbar sind alle Runden in einem finalen Status — die Auswahl dient
 * sowohl dem Bulk-Export (nur exportierbare Teilmenge) als auch dem
 * Bulk-Löschen. Aktive Runden (preflight/generating/…) bleiben gesperrt,
 * damit niemand eine laufende Pipeline unterm Hintern weglöscht.
 */
function canSelect(r: RunRow): boolean {
  return isFinal(r.status);
}

type FinalStatus = "completed" | "failed" | "cancelled" | "draft";

const ACTIVE_STATUSES = new Set<RunRow["status"]>([
  "mapping",
  "preflighting",
  "awaiting_approval",
  "approved",
  "generating",
  // Notbremse-Pause zählt als aktiv: Run kann fortgesetzt werden und darf
  // nicht bulk-gelöscht werden.
  "paused",
]);
const POLL_INTERVAL_MS = 5000;

function isFinal(status: RunRow["status"]): status is FinalStatus {
  return !ACTIVE_STATUSES.has(status);
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function StatusBadge({ status }: { status: RunRow["status"] }) {
  const variant = runStatusVariant(status);
  const label = runStatusLabel(status);
  if (status === "generating" || status === "preflighting") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap bg-brand-soft text-brand-deep">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
        </span>
        {label}
      </span>
    );
  }
  return (
    <Badge variant={variant} dot>
      {label}
    </Badge>
  );
}

export function RunsTable({
  campaignId,
  campaignName,
  initialRuns,
  campaignHasLetters,
  campaignHasEnvelopes,
  campaignHasEmail,
}: RunsTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [runs, setRuns] = React.useState<RunRow[]>(initialRuns);
  const [deleteTarget, setDeleteTarget] = React.useState<RunRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [resetTarget, setResetTarget] = React.useState<RunRow | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [bulkExportOpen, setBulkExportOpen] = React.useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  // Single-Run-Export via Icon-Klick: übersteuert `selectedIds` für den Dialog.
  const [singleRunExport, setSingleRunExport] = React.useState<{
    run: RunRow;
    type: BulkExportType;
  } | null>(null);

  // Reseed local state when the server-rendered initial data changes
  // (e.g. after a router.refresh() following a delete or a navigation back).
  React.useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

  // Drop any selections that no longer correspond to a visible run (e.g. when
  // a selected run is deleted or polling reveals that it lost eligibility).
  React.useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const r of runs) {
        if (prev.has(r.id) && canSelect(r)) {
          next.add(r.id);
        } else if (prev.has(r.id)) {
          changed = true;
        }
      }
      if (next.size !== prev.size) changed = true;
      return changed ? next : prev;
    });
  }, [runs]);

  // Spalte "A/B-Test" nur zeigen, wenn mindestens eine Runde damit lief —
  // Kampagnen ohne A/B-Test behalten die schlanke Tabelle.
  const anyAb = runs.some((r) => r.ab !== null);

  const eligibleRuns = React.useMemo(() => runs.filter(canSelect), [runs]);
  const selectableCount = eligibleRuns.length;
  const selectedCount = selectedIds.size;
  const masterState: boolean | "indeterminate" =
    selectableCount > 0 && selectedCount === selectableCount
      ? true
      : selectedCount > 0
        ? "indeterminate"
        : false;
  const masterDisabled = selectableCount === 0;

  function toggleRun(id: string, eligible: boolean) {
    if (!eligible) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMaster() {
    if (masterDisabled) return;
    setSelectedIds((prev) => {
      if (prev.size === selectableCount) return new Set();
      return new Set(eligibleRuns.map((r) => r.id));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Export arbeitet nur auf der exportierbaren Teilmenge der Auswahl —
  // Löschen dagegen auf der GESAMTEN Auswahl.
  const selectedExportableRuns = React.useMemo(
    () => runs.filter((r) => selectedIds.has(r.id) && canBulkExport(r)),
    [runs, selectedIds],
  );
  // Memoise the array of ids so the dialog doesn't re-mount on every
  // poll-induced re-render of `runs`.
  const exportableIdsList = React.useMemo(
    () => selectedExportableRuns.map((r) => r.id),
    [selectedExportableRuns],
  );
  const selectedRunsForDialog = React.useMemo(
    () =>
      selectedExportableRuns.map((r) => ({
        id: r.id,
        name: r.name,
        completedLeads: r.completedLeads,
      })),
    [selectedExportableRuns],
  );

  const hasActive = runs.some(
    (r) =>
      ACTIVE_STATUSES.has(r.status) ||
      (r.status === "completed" &&
        r.completedLeads === 0 &&
        r.totalLeads > 0),
  );

  // Live polling: while at least one run is mapping/generating we re-fetch
  // counts every POLL_INTERVAL_MS. We poll each active run individually via
  // GET /api/runs/[id] (which returns per-status lead counts), since /api/runs
  // is only a POST endpoint in this codebase.
  React.useEffect(() => {
    if (!hasActive) return;

    let cancelled = false;
    const tick = async () => {
      // Aktive Runs + Completed-Runs mit stale-aussehenden Countern
      // (z.B. nach einem Pipeline-Regenerate, das die Run-Counter
      // resettet aber Leads aktualisiert hat). Einmaliges Resync
      // genuegt — sobald der Counter > 0 ist, hoert er auf zu pollen.
      const needsSync = (r: RunRow): boolean =>
        ACTIVE_STATUSES.has(r.status) ||
        (r.status === "completed" &&
          r.completedLeads === 0 &&
          r.totalLeads > 0);
      const active = runs.filter(needsSync);
      if (active.length === 0) return;

      const results = await Promise.all(
        active.map(async (r) => {
          try {
            const res = await fetch(`/api/runs/${r.id}`, {
              cache: "no-store",
            });
            if (!res.ok) return null;
            const data = (await res.json()) as {
              run: {
                id: string;
                status: RunRow["status"];
                totalLeads: number;
                startedAt: string | null;
                completedAt: string | null;
              };
              counts: Record<string, number>;
              eta?: RunEtaEntry | null;
            };
            return data;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      setRuns((prev) =>
        prev.map((existing) => {
          const match = results.find((r) => r && r.run.id === existing.id);
          if (!match) return existing;
          return {
            ...existing,
            status: match.run.status,
            totalLeads: match.run.totalLeads ?? existing.totalLeads,
            completedLeads: match.counts.completed ?? 0,
            failedLeads: match.counts.failed ?? 0,
            startedAt: match.run.startedAt ?? existing.startedAt,
            completedAt: match.run.completedAt ?? existing.completedAt,
            eta: match.eta ?? null,
          };
        }),
      );
    };

    // Run once immediately so users don't wait the full interval after mount,
    // then continue on the interval.
    void tick();
    const handle = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
    // We intentionally depend on `hasActive` only, not `runs`, to avoid
    // resetting the interval on every state update. Individual ticks read
    // `runs` via the functional setter and via closure (the snapshot at
    // schedule time is fine because tick() recomputes the active list).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    // Optimistic removal so the row disappears immediately even if the
    // network is slow.
    setRuns((prev) => prev.filter((r) => r.id !== target.id));
    try {
      const res = await fetch(`/api/runs/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // Roll back optimistic removal on failure.
        setRuns((prev) =>
          prev.some((r) => r.id === target.id) ? prev : [target, ...prev],
        );
        toast({
          title: "Löschen fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Runde gelöscht",
        description: target.name,
        variant: "success",
      });
      router.refresh();
    } catch {
      setRuns((prev) =>
        prev.some((r) => r.id === target.id) ? prev : [target, ...prev],
      );
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function confirmBulkDelete() {
    const targets = runs.filter((r) => selectedIds.has(r.id));
    if (targets.length === 0) return;
    setBulkDeleting(true);
    let deleted = 0;
    const failed: RunRow[] = [];
    // Sequentiell statt Promise.all: jeder DELETE räumt Videos/PDFs bei
    // Bunny mit ab — parallel würde das Rate-Limits/Timeouts provozieren.
    for (const target of targets) {
      try {
        const res = await fetch(`/api/runs/${target.id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          deleted += 1;
          setRuns((prev) => prev.filter((r) => r.id !== target.id));
        } else {
          failed.push(target);
        }
      } catch {
        failed.push(target);
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    clearSelection();
    if (failed.length === 0) {
      toast({
        title: deleted === 1 ? "Runde gelöscht" : `${deleted} Runden gelöscht`,
        variant: "success",
      });
    } else {
      toast({
        title: "Teilweise fehlgeschlagen",
        description: `${deleted} gelöscht, ${failed.length} fehlgeschlagen: ${failed
          .map((r) => r.name)
          .join(", ")}`,
        variant: "danger",
      });
    }
    router.refresh();
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={masterState}
                disabled={masterDisabled}
                onCheckedChange={() => toggleMaster()}
                aria-label="Alle Runden auswählen"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Fortschritt</TableHead>
            {anyAb && <TableHead>A/B-Test</TableHead>}
            <TableHead className="w-40">Ausgabe</TableHead>
            <TableHead>Erstellt</TableHead>
            <TableHead className="w-12 text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const pct =
              r.totalLeads > 0
                ? Math.round((r.completedLeads / r.totalLeads) * 100)
                : 0;
            // Unfertige Runden (draft/mapping) führen zurück in den Wizard,
            // der den gespeicherten Stand (Upload/Mapping) wieder aufnimmt.
            const detailHref =
              r.status === "draft" || r.status === "mapping"
                ? `/kampagnen/${campaignId}/runs/neu?resume=${r.id}`
                : `/kampagnen/${campaignId}/runs/${r.id}`;
            const final = isFinal(r.status);
            const eligible = canSelect(r);
            const checked = selectedIds.has(r.id);
            return (
              <TableRow
                key={r.id}
                className={cn(
                  "group cursor-pointer",
                  checked ? "bg-brand-soft/40" : "",
                )}
                onClick={(e) => {
                  // Allow native clicks on inner interactive elements to
                  // proceed without our row-navigation hijacking them.
                  const target = e.target as HTMLElement;
                  if (target.closest("[data-row-action]")) return;
                  router.push(detailHref);
                }}
              >
                <TableCell
                  className="w-8"
                  data-row-action
                  onClick={(e) => e.stopPropagation()}
                >
                  {eligible ? (
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleRun(r.id, true)}
                      aria-label={`Run ${r.name} auswählen`}
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Checkbox
                            checked={false}
                            disabled
                            aria-label={`Run ${r.name} läuft gerade und kann nicht ausgewählt werden`}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Runde läuft gerade — Auswahl erst nach Abschluss
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell className="font-medium text-ink">
                  <Link
                    href={detailHref}
                    className="hover:text-brand-deep transition-colors"
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3 min-w-[220px] max-w-[320px]">
                    <Badge variant="neutral" className="font-mono">
                      {r.completedLeads} / {r.totalLeads}
                    </Badge>
                    <Progress
                      value={pct}
                      className={cn(
                        "flex-1",
                        final ? "" : "[&>div]:animate-pulse",
                      )}
                    />
                    <span className="text-xs text-ink-muted w-10 text-right tabular-nums">
                      {pct}%
                    </span>
                  </div>
                  {r.status === "generating" && r.eta
                    ? (() => {
                        const label = formatRunEta(r.eta);
                        return label ? (
                          <p className="mt-1 text-xs text-ink-muted">{label}</p>
                        ) : null;
                      })()
                    : null}
                </TableCell>
                {anyAb && (
                  <TableCell>
                    {r.ab ? (
                      <AbCell ab={r.ab} />
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell data-row-action onClick={(e) => e.stopPropagation()}>
                  <OutputIcons
                    run={r}
                    campaignId={campaignId}
                    campaignHasLetters={campaignHasLetters}
                    campaignHasEnvelopes={campaignHasEnvelopes}
                    campaignHasEmail={campaignHasEmail}
                    onDownload={(type) =>
                      setSingleRunExport({ run: r, type })
                    }
                  />
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatDate(r.createdAt)}
                </TableCell>
                <TableCell
                  className="text-right"
                  data-row-action
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Aktionen"
                        className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={detailHref}>
                          <ExternalLink className="size-4" />
                          Öffnen
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setResetTarget(r);
                        }}
                      >
                        <RotateCcw className="size-4" />
                        Tracking zurücksetzen
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        danger
                        onSelect={(e) => {
                          e.preventDefault();
                          setDeleteTarget(r);
                        }}
                      >
                        <Trash2 className="size-4" />
                        Löschen
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Sticky bulk-action bar -------------------------------------- */}
      {selectedCount > 0 && (
        <div
          className="sticky bottom-4 z-30 mt-4 flex items-center gap-3 rounded-squircle-xl bg-surface px-4 py-3 shadow-card-hover"
          role="region"
          aria-label="Auswahl-Aktionen"
        >
          <span className="text-sm font-semibold text-ink">
            {selectedCount}{" "}
            {selectedCount === 1 ? "Runde" : "Runden"} ausgewählt
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs font-semibold text-ink-muted hover:text-ink underline-offset-2 hover:underline"
            >
              Auswahl aufheben
            </button>
            <Button
              size="sm"
              variant="danger"
              iconLeft={<Trash2 className="size-4" />}
              onClick={() => setBulkDeleteOpen(true)}
            >
              Löschen ({selectedCount})
            </Button>
            {selectedExportableRuns.length > 0 ? (
              <Button
                size="sm"
                variant="brand"
                iconLeft={<Archive className="size-4" />}
                onClick={() => setBulkExportOpen(true)}
              >
                Bulk-Export ({selectedExportableRuns.length})
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="brand"
                      disabled
                      iconLeft={<Archive className="size-4" />}
                    >
                      Bulk-Export
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Keine der ausgewählten Runden hat fertige Leads zum
                  Exportieren
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      <BulkExportDialog
        open={bulkExportOpen}
        onOpenChange={setBulkExportOpen}
        runIds={exportableIdsList}
        runs={selectedRunsForDialog}
        campaignName={campaignName}
        onSuccess={clearSelection}
      />

      {/* Single-Run-Export via Icon-Klick — dedizierter Dialog, damit die
          Selektion des Users nicht überschrieben wird. */}
      <BulkExportDialog
        open={singleRunExport !== null}
        onOpenChange={(o) => {
          if (!o) setSingleRunExport(null);
        }}
        runIds={singleRunExport ? [singleRunExport.run.id] : []}
        runs={
          singleRunExport
            ? [
                {
                  id: singleRunExport.run.id,
                  name: singleRunExport.run.name,
                  completedLeads:
                    singleRunExport.type === "envelopes"
                      ? singleRunExport.run.envelopeCount
                      : singleRunExport.run.letterCount,
                },
              ]
            : []
        }
        campaignName={campaignName}
        exportType={singleRunExport?.type ?? "letters"}
      />

      {/* Bulk-Delete confirm ------------------------------------------ */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setBulkDeleteOpen(false);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {selectedCount === 1
                ? "Ausgewählte Runde löschen?"
                : `${selectedCount} ausgewählte Runden löschen?`}
            </DialogTitle>
            <DialogDescription>
              {selectedCount === 1 ? "Diese Runde wird" : "Diese Runden werden"}{" "}
              unwiderruflich gelöscht — inklusive aller Leads, Videos und
              PDFs. Die Kampagne selbst bleibt bestehen.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto list-disc pl-5 text-sm text-ink space-y-1">
            {runs
              .filter((r) => selectedIds.has(r.id))
              .map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-ink-muted">
                    ({r.completedLeads} Leads)
                  </span>
                </li>
              ))}
          </ul>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => void confirmBulkDelete()}
              loading={bulkDeleting}
              iconLeft={<Trash2 className="size-4" />}
            >
              {selectedCount === 1
                ? "Runde löschen"
                : `${selectedCount} Runden löschen`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResetTrackingDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
        runId={resetTarget?.id ?? null}
        runName={resetTarget?.name ?? null}
        onSuccess={() => {
          // Server-Daten neu laden, damit die Run-Liste die zurückgesetzten
          // Zähler aus dem Tracking spiegelt. Die Run-Pipeline-Counter (z.B.
          // completedLeads) ändern sich dadurch nicht — die werden weiterhin
          // live aus den Lead-Status berechnet.
          router.refresh();
        }}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Runde löschen?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? (
                <>
                  Die Runde{" "}
                  <span className="font-semibold text-ink">
                    {deleteTarget.name}
                  </span>{" "}
                  wird unwiderruflich gelöscht. Alle Leads, Videos und PDFs
                  werden mitgelöscht.
                </>
              ) : (
                "Die Runde wird unwiderruflich gelöscht."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => void confirmDelete()}
              loading={deleting}
              iconLeft={<Trash2 className="size-4" />}
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

/**
 * Kompakte Icon-Row in der „Ausgabe"-Spalte: Brief, Umschlag, Mail.
 * Farbig = generiert/versendet, dezent grau = für diese Kampagne konfiguriert
 * aber noch nichts da, komplett ausgeblendet = Kanal in der Kampagne
 * grundsätzlich nicht aktiv.
 *
 * Brief- und Umschlag-Icon sind Buttons — Klick öffnet den BulkExportDialog
 * mit dem passenden `exportType`. Mail springt in den E-Mail-Tab.
 */
function OutputIcons({
  run,
  campaignId,
  campaignHasLetters,
  campaignHasEnvelopes,
  campaignHasEmail,
  onDownload,
}: {
  run: RunRow;
  campaignId: string;
  campaignHasLetters: boolean;
  campaignHasEnvelopes: boolean;
  campaignHasEmail: boolean;
  onDownload: (type: BulkExportType) => void;
}) {
  const anyConfigured =
    campaignHasLetters || campaignHasEnvelopes || campaignHasEmail;
  if (!anyConfigured) {
    return <span className="text-xs text-ink-muted">—</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      {campaignHasLetters ? (
        <OutputIconButton
          icon={<FileText className="size-4" />}
          count={run.letterCount}
          activeLabel={`${run.letterCount} Briefe – als ZIP herunterladen`}
          inactiveLabel="Noch keine Briefe generiert"
          onClick={
            run.letterCount > 0 ? () => onDownload("letters") : undefined
          }
        />
      ) : null}
      {campaignHasEnvelopes ? (
        <OutputIconButton
          icon={<MailIcon className="size-4" />}
          count={run.envelopeCount}
          activeLabel={`${run.envelopeCount} Umschläge – als ZIP herunterladen`}
          inactiveLabel="Noch keine Umschläge generiert"
          onClick={
            run.envelopeCount > 0 ? () => onDownload("envelopes") : undefined
          }
        />
      ) : null}
      {campaignHasEmail ? (
        <OutputIconLink
          icon={<Send className="size-4" />}
          count={run.emailSentCount}
          activeLabel={`${run.emailSentCount} Mails versendet – zum E-Mail-Tab`}
          inactiveLabel="Noch keine Mails versendet"
          href={`/kampagnen/${campaignId}?tab=email`}
        />
      ) : null}
    </div>
  );
}

function OutputIconButton({
  icon,
  count,
  activeLabel,
  inactiveLabel,
  onClick,
}: {
  icon: React.ReactNode;
  count: number;
  activeLabel: string;
  inactiveLabel: string;
  onClick?: () => void;
}) {
  const active = count > 0;
  const disabled = !onClick;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-label={active ? activeLabel : inactiveLabel}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold tabular-nums transition-colors",
            active
              ? "bg-brand-soft text-brand-deep hover:bg-brand-soft/70"
              : "bg-ink/[0.04] text-ink-muted cursor-default",
          )}
        >
          {icon}
          {active ? count.toLocaleString("de-DE") : ""}
        </button>
      </TooltipTrigger>
      <TooltipContent>{active ? activeLabel : inactiveLabel}</TooltipContent>
    </Tooltip>
  );
}

function OutputIconLink({
  icon,
  count,
  activeLabel,
  inactiveLabel,
  href,
}: {
  icon: React.ReactNode;
  count: number;
  activeLabel: string;
  inactiveLabel: string;
  href: string;
}) {
  const active = count > 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={active ? activeLabel : inactiveLabel}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold tabular-nums transition-colors",
            active
              ? "bg-brand-soft text-brand-deep hover:bg-brand-soft/70"
              : "bg-ink/[0.04] text-ink-muted hover:text-ink",
          )}
        >
          {icon}
          {active ? count.toLocaleString("de-DE") : ""}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{active ? activeLabel : inactiveLabel}</TooltipContent>
    </Tooltip>
  );
}
