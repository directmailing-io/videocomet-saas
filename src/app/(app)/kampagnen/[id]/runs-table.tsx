"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  MoreVertical,
  ExternalLink,
  RotateCcw,
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
import { BulkExportDialog } from "./bulk-export-dialog";
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
    | "completed"
    | "failed"
    | "cancelled";
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface RunsTableProps {
  campaignId: string;
  campaignName: string;
  initialRuns: RunRow[];
}

/**
 * A run is eligible for the bulk-PDF export when it is completed AND has at
 * least one successfully generated lead. Other statuses (draft, generating,
 * failed-with-zero-leads, …) may not be selected; the checkbox renders
 * disabled with a tooltip in that case.
 */
function canBulkExport(r: RunRow): boolean {
  return r.status === "completed" && r.completedLeads > 0;
}

type FinalStatus = "completed" | "failed" | "cancelled" | "draft";

const ACTIVE_STATUSES = new Set<RunRow["status"]>([
  "mapping",
  "preflighting",
  "awaiting_approval",
  "approved",
  "generating",
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

function statusLabel(status: RunRow["status"]): string {
  switch (status) {
    case "draft":
      return "Entwurf";
    case "mapping":
      return "Mapping";
    case "preflighting":
      return "Prüft Leads ...";
    case "awaiting_approval":
      return "Freigabe ausstehend";
    case "approved":
      return "Freigegeben";
    case "generating":
      return "Wird erzeugt ...";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehlgeschlagen";
    case "cancelled":
      return "Abgebrochen";
  }
}

function statusVariant(
  status: RunRow["status"],
): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "generating":
    case "approved":
      return "brand";
    case "mapping":
    case "preflighting":
    case "awaiting_approval":
      return "warn";
    case "failed":
      return "danger";
    case "cancelled":
    case "draft":
    default:
      return "neutral";
  }
}

function StatusBadge({ status }: { status: RunRow["status"] }) {
  const variant = statusVariant(status);
  const label = statusLabel(status);
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
        if (prev.has(r.id) && canBulkExport(r)) {
          next.add(r.id);
        } else if (prev.has(r.id)) {
          changed = true;
        }
      }
      if (next.size !== prev.size) changed = true;
      return changed ? next : prev;
    });
  }, [runs]);

  const eligibleRuns = React.useMemo(
    () => runs.filter(canBulkExport),
    [runs],
  );
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

  // Memoise the array of selected ids so the dialog doesn't re-mount on every
  // poll-induced re-render of `runs`.
  const selectedIdsList = React.useMemo(
    () => Array.from(selectedIds),
    [selectedIds],
  );
  const selectedRunsForDialog = React.useMemo(
    () =>
      runs
        .filter((r) => selectedIds.has(r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          completedLeads: r.completedLeads,
        })),
    [runs, selectedIds],
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
            const detailHref = `/kampagnen/${campaignId}/runs/${r.id}`;
            const final = isFinal(r.status);
            const eligible = canBulkExport(r);
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
                            aria-label={`Run ${r.name} kann nicht exportiert werden`}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Keine fertigen Leads zum Exportieren
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
          className="sticky bottom-4 z-30 mt-4 flex items-center gap-3 rounded-squircle-xl border border-line bg-surface px-4 py-3 shadow-lift"
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
              variant="brand"
              iconLeft={<Archive className="size-4" />}
              onClick={() => setBulkExportOpen(true)}
            >
              Bulk-Export
            </Button>
          </div>
        </div>
      )}

      <BulkExportDialog
        open={bulkExportOpen}
        onOpenChange={setBulkExportOpen}
        runIds={selectedIdsList}
        runs={selectedRunsForDialog}
        campaignName={campaignName}
        onSuccess={clearSelection}
      />

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
