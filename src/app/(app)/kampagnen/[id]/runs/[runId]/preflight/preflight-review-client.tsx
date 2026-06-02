"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Keyboard,
  Play,
  RefreshCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { PreflightGrid } from "./_components/preflight-grid";
import {
  applyFilterAndSort,
  FilterToolbar,
  pickProblematicIds,
  type FilterKey,
  type SortKey,
} from "./_components/filter-toolbar";
import { Lightbox } from "./_components/lightbox";
import { BulkActionBar } from "./_components/bulk-action-bar";
import { ConfirmModal } from "./_components/confirm-modal";
import { useSelection } from "./_components/use-selection";
import { useKeyboardShortcuts } from "./_components/use-keyboard-shortcuts";
import type { PreflightLead, PreflightStatus } from "./_components/lead-card";

/**
 * Counts-Vertrag, identisch zur Status-Endpoint-Antwort.
 */
interface CountsPayload {
  pending: number;
  running: number;
  ok: number;
  problematic: number;
  removed: number;
  total: number;
}

interface StatusPayload {
  runStatus: string;
  counts: CountsPayload;
  startedAt: string;
  completedAt: string | null;
  progressPercent: number;
}

interface LeadsResponse {
  leads: PreflightLead[];
}

/**
 * Diff-Tick-Payload aus SSE — minimaler als der volle Lead-Datensatz.
 */
interface LeadUpdateTick {
  leadId: string;
  preflightStatus: PreflightStatus;
  preflightScreenshotUrl?: string | null;
  preflightHttpStatus?: number | null;
  preflightErrorMessage?: string | null;
  preflightFinalUrl?: string | null;
  preflightDurationMs?: number | null;
}

export interface PreflightReviewClientProps {
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
}

const DEFAULT_FILTERS: ReadonlySet<FilterKey> = new Set<FilterKey>([
  "problematic",
]);

export function PreflightReviewClient({
  campaignId,
  campaignName,
  runId,
  runName,
}: PreflightReviewClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  // ── State ────────────────────────────────────────────────────────
  const [leads, setLeads] = React.useState<PreflightLead[]>([]);
  const [counts, setCounts] = React.useState<CountsPayload>({
    pending: 0,
    running: 0,
    ok: 0,
    problematic: 0,
    removed: 0,
    total: 0,
  });
  const [runStatus, setRunStatus] = React.useState<string>("preflighting");
  const [progressPercent, setProgressPercent] = React.useState<number>(0);
  const [loadingState, setLoadingState] = React.useState<
    "initial" | "ready" | "error"
  >("initial");
  const [activeFilters, setActiveFilters] = React.useState<Set<FilterKey>>(
    () => new Set<FilterKey>(DEFAULT_FILTERS),
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sort, setSort] = React.useState<SortKey>("problems_first");
  const [lightboxOpenLeadId, setLightboxOpenLeadId] = React.useState<
    string | null
  >(null);
  const [focusedLeadId, setFocusedLeadId] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmLoading, setConfirmLoading] = React.useState(false);
  const [bulkRemoveLoading, setBulkRemoveLoading] = React.useState(false);

  const selection = useSelection(runId);

  // ── Data fetching ────────────────────────────────────────────────
  const loadLeads = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/preflight/leads`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LeadsResponse;
      setLeads(data.leads);
      setLoadingState("ready");
    } catch {
      setLoadingState("error");
    }
  }, [runId]);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/preflight/status`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as StatusPayload;
      setCounts(data.counts);
      setRunStatus(data.runStatus);
      setProgressPercent(data.progressPercent);
    } catch {
      // Polling-Fallback fängt das spätere Refresh.
    }
  }, [runId]);

  // Initial-Load — parallel.
  React.useEffect(() => {
    void Promise.all([loadLeads(), loadStatus()]);
  }, [loadLeads, loadStatus]);

  // ── SSE: Live-Updates ────────────────────────────────────────────
  const phase1AwaitingToastShownRef = React.useRef(false);

  React.useEffect(() => {
    // Wenn Run schon weiter ist als preflighting, brauchen wir keinen Stream.
    if (
      runStatus !== "preflighting" &&
      runStatus !== "awaiting_approval" &&
      runStatus !== "pending" &&
      runStatus !== "created"
    ) {
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let pollHandle: number | null = null;

    try {
      es = new EventSource(`/api/runs/${runId}/preflight/stream`, {
        withCredentials: true,
      });

      es.addEventListener("lead-update", (ev) => {
        try {
          const tick = JSON.parse((ev as MessageEvent).data) as LeadUpdateTick;
          setLeads((prev) =>
            prev.map((l) =>
              l.id === tick.leadId
                ? {
                    ...l,
                    preflightStatus: tick.preflightStatus,
                    preflightScreenshotUrl:
                      tick.preflightScreenshotUrl ?? l.preflightScreenshotUrl,
                    preflightHttpStatus:
                      tick.preflightHttpStatus !== undefined
                        ? tick.preflightHttpStatus
                        : l.preflightHttpStatus,
                    preflightErrorMessage:
                      tick.preflightErrorMessage !== undefined
                        ? tick.preflightErrorMessage
                        : l.preflightErrorMessage,
                    preflightFinalUrl:
                      tick.preflightFinalUrl !== undefined
                        ? tick.preflightFinalUrl
                        : l.preflightFinalUrl,
                    preflightDurationMs:
                      tick.preflightDurationMs !== undefined
                        ? tick.preflightDurationMs
                        : l.preflightDurationMs,
                  }
                : l,
            ),
          );
        } catch {
          // payload corrupt → ignore, polling holt das ein
        }
      });

      es.addEventListener("counts", (ev) => {
        try {
          const c = JSON.parse((ev as MessageEvent).data) as CountsPayload;
          setCounts(c);
          if (c.total > 0) {
            const checked = c.total - c.pending - c.running;
            setProgressPercent(Math.round((checked / c.total) * 100));
          }
          // Wenn alle abgearbeitet sind → Phase 1 fertig
          if (
            !phase1AwaitingToastShownRef.current &&
            c.pending === 0 &&
            c.running === 0 &&
            c.total > 0
          ) {
            phase1AwaitingToastShownRef.current = true;
            setRunStatus("awaiting_approval");
            toast({
              variant: "success",
              title: "Phase 1 abgeschlossen",
              description:
                "Sie können jetzt entscheiden, welche Leads in die Vollproduktion gehen.",
            });
            es?.close();
          }
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("error", () => {
        // Browser reconnected automatisch; falls dauerhaft tot, fällt
        // der Polling-Fallback unten ein.
      });
    } catch {
      // SSE nicht verfügbar → reines Polling
      es = null;
    }

    // Polling-Fallback alle 3s als Safety-Net (idempotent — wenn SSE läuft,
    // ist es nur ein bisschen Mehrarbeit).
    pollHandle = window.setInterval(() => {
      if (cancelled) return;
      void loadStatus();
    }, 3000);

    return () => {
      cancelled = true;
      es?.close();
      if (pollHandle !== null) window.clearInterval(pollHandle);
    };
  }, [runId, runStatus, loadStatus, toast]);

  // ── Derived: gefilterte & sortierte Liste ───────────────────────
  const visibleLeads = React.useMemo(
    () => applyFilterAndSort(leads, activeFilters, searchQuery, sort),
    [leads, activeFilters, searchQuery, sort],
  );
  const visibleIds = React.useMemo(
    () => visibleLeads.map((l) => l.id),
    [visibleLeads],
  );

  // Focus-Lead nachjustieren, sobald die Filter sich ändern.
  React.useEffect(() => {
    if (focusedLeadId && visibleIds.includes(focusedLeadId)) return;
    setFocusedLeadId(visibleIds[0] ?? null);
  }, [visibleIds, focusedLeadId]);

  // ── Actions ──────────────────────────────────────────────────────
  const rejectLeads = React.useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      // Optimistic: lokal sofort als removed markieren.
      const nowIso = new Date().toISOString();
      setLeads((prev) =>
        prev.map((l) =>
          ids.includes(l.id) && !l.removedAt
            ? { ...l, removedAt: nowIso }
            : l,
        ),
      );
      selection.remove(ids);
      try {
        const res = await fetch(`/api/runs/${runId}/preflight/reject`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: ids }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          ok: boolean;
          rejectedCount: number;
        };
        toast({
          variant: "success",
          title: `${data.rejectedCount} Lead${data.rejectedCount === 1 ? "" : "s"} entfernt`,
          description:
            "Die Leads wandern nicht in die Vollproduktion. Sie können den Schritt rückgängig machen, indem Sie den Lead erneut auswählen.",
        });
      } catch {
        // Rollback bei Fehler.
        setLeads((prev) =>
          prev.map((l) =>
            ids.includes(l.id) ? { ...l, removedAt: null } : l,
          ),
        );
        toast({
          variant: "danger",
          title: "Entfernen fehlgeschlagen",
          description:
            "Die Aktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
        });
      }
    },
    [runId, selection, toast],
  );

  const handleBulkRemove = React.useCallback(async () => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    setBulkRemoveLoading(true);
    await rejectLeads(ids);
    setBulkRemoveLoading(false);
  }, [selection, rejectLeads]);

  const handleRetryScreenshot = React.useCallback(
    async (leadId: string) => {
      try {
        // Optimistic: Status auf `running` setzen, damit der Spinner aktiv ist.
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? { ...l, preflightStatus: "running", preflightErrorMessage: null }
              : l,
          ),
        );
        const res = await fetch(
          `/api/runs/${runId}/preflight/retry-screenshot`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadId }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        toast({
          variant: "danger",
          title: "Neuer Versuch fehlgeschlagen",
          description:
            "Der Screenshot konnte nicht neu erzeugt werden. Bitte etwas warten und erneut versuchen.",
        });
      }
    },
    [runId, toast],
  );

  const handleApprove = React.useCallback(async () => {
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/preflight/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rejectedLeadIds: [] }),
      });
      if (res.status === 409) {
        toast({
          variant: "danger",
          title: "Run ist bereits in Produktion",
          description: "Wir leiten Sie zur Run-Übersicht weiter.",
        });
        router.push(`/kampagnen/${campaignId}/runs/${runId}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        variant: "success",
        title: "Vollproduktion gestartet",
        description: "Sie werden zur Run-Übersicht weitergeleitet.",
      });
      // Lokalen Selection-Cache räumen — Run wechselt jetzt seine Phase.
      selection.clear();
      router.push(`/kampagnen/${campaignId}/runs/${runId}`);
    } catch {
      toast({
        variant: "danger",
        title: "Start fehlgeschlagen",
        description:
          "Die Vollproduktion konnte nicht gestartet werden. Bitte später erneut versuchen.",
      });
    } finally {
      setConfirmLoading(false);
      setConfirmOpen(false);
    }
  }, [runId, campaignId, router, selection, toast]);

  // ── Filter-Handling ─────────────────────────────────────────────
  const toggleFilter = React.useCallback((key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set<FilterKey>(prev);
      // "all" und gezielte Filter schließen sich aus
      if (key === "all") {
        return next.has("all")
          ? new Set<FilterKey>()
          : new Set<FilterKey>(["all"]);
      }
      next.delete("all");
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) next.add("all");
      return next;
    });
  }, []);

  // ── Card-Selection-Layer ───────────────────────────────────────
  const onSelectToggle = React.useCallback(
    (leadId: string, e: React.MouseEvent | React.KeyboardEvent) => {
      const shift =
        "shiftKey" in e ? e.shiftKey : (e as KeyboardEvent).shiftKey;
      if (shift) {
        selection.selectRange(leadId, visibleIds);
        return;
      }
      selection.toggle(leadId);
      setFocusedLeadId(leadId);
    },
    [selection, visibleIds],
  );

  const onLeadOpen = React.useCallback((leadId: string) => {
    setLightboxOpenLeadId(leadId);
    setFocusedLeadId(leadId);
  }, []);

  const onLightboxClose = React.useCallback(() => {
    setLightboxOpenLeadId(null);
  }, []);

  const onLightboxChangeActive = React.useCallback((leadId: string) => {
    setLightboxOpenLeadId(leadId);
    setFocusedLeadId(leadId);
  }, []);

  const onLightboxKeep = React.useCallback(
    (leadId: string) => {
      selection.remove([leadId]);
      // Auto-Advance: nächste Karte öffnen (Triage-Muster).
      const idx = visibleIds.indexOf(leadId);
      const next = idx >= 0 && idx + 1 < visibleIds.length
        ? visibleIds[idx + 1]
        : null;
      if (next) setLightboxOpenLeadId(next);
      else setLightboxOpenLeadId(null);
    },
    [selection, visibleIds],
  );

  const onLightboxReject = React.useCallback(
    async (leadId: string) => {
      const idx = visibleIds.indexOf(leadId);
      await rejectLeads([leadId]);
      const next = idx >= 0 && idx + 1 < visibleIds.length
        ? visibleIds[idx + 1]
        : null;
      if (next) setLightboxOpenLeadId(next);
      else setLightboxOpenLeadId(null);
    },
    [visibleIds, rejectLeads],
  );

  // ── Keyboard-Shortcuts ──────────────────────────────────────────
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  useKeyboardShortcuts({
    Space: () => {
      if (lightboxOpenLeadId) {
        selection.toggle(lightboxOpenLeadId);
        return;
      }
      if (focusedLeadId) selection.toggle(focusedLeadId);
    },
    r: () => {
      const ids =
        selection.selected.size > 0
          ? Array.from(selection.selected)
          : lightboxOpenLeadId
            ? [lightboxOpenLeadId]
            : focusedLeadId
              ? [focusedLeadId]
              : [];
      if (ids.length > 0) void rejectLeads(ids);
    },
    k: () => {
      // "Behalten": markierte Leads als safe abhaken → Auswahl aufheben.
      if (selection.selected.size > 0) selection.clear();
    },
    "Mod+a": () => {
      selection.replace(visibleIds);
    },
    f: () => {
      const ids = pickProblematicIds(leads);
      selection.replace(ids);
    },
    "/": () => {
      // Focus auf das Suchfeld werfen.
      const el =
        searchInputRef.current ??
        document.querySelector<HTMLInputElement>(
          'input[type="search"][placeholder*="Name"]',
        );
      el?.focus();
      el?.select();
    },
    Escape: () => {
      if (lightboxOpenLeadId) {
        setLightboxOpenLeadId(null);
        return;
      }
      if (selection.selected.size > 0) selection.clear();
    },
    Enter: () => {
      if (lightboxOpenLeadId) return;
      if (focusedLeadId) setLightboxOpenLeadId(focusedLeadId);
    },
  });

  // ── Render ──────────────────────────────────────────────────────
  const phase1Running =
    runStatus === "preflighting" ||
    runStatus === "pending" ||
    runStatus === "created" ||
    counts.pending > 0 ||
    counts.running > 0;

  const hasInitialLoad = loadingState !== "initial";
  const allProblematic =
    counts.total > 0 &&
    counts.ok === 0 &&
    counts.pending === 0 &&
    counts.running === 0 &&
    counts.problematic > 0;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex flex-col gap-4 -mt-2">
        {/* Sticky Topbar */}
        <div
          className={cn(
            "sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3",
            "bg-surface-soft/95 backdrop-blur-sm border-b border-line",
          )}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Button
                asChild
                variant="ghost"
                size="sm"
                iconLeft={<ArrowLeft className="size-4" />}
                className="shrink-0"
              >
                <Link
                  href={`/kampagnen/${campaignId}/runs/${runId}`}
                  aria-label="Zur Run-Übersicht"
                >
                  Zurück
                </Link>
              </Button>
              <div className="flex flex-col min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted leading-tight">
                  Pre-Flight Review
                </div>
                <h1 className="text-base sm:text-lg font-bold text-ink leading-tight truncate">
                  Run · {runName}
                  <span className="text-ink-muted font-medium">
                    {" "}— {campaignName}
                  </span>
                </h1>
                <p className="text-xs text-ink-muted tabular-nums mt-0.5">
                  {counts.total - counts.pending - counts.running} /{" "}
                  {counts.total} geprüft
                  {counts.problematic > 0 && (
                    <>
                      {" · "}
                      <span className="text-warn font-semibold">
                        {counts.problematic} problematisch
                      </span>
                    </>
                  )}
                  {counts.removed > 0 && (
                    <>
                      {" · "}
                      <span className="text-ink-muted">
                        {counts.removed} entfernt
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {loadingState === "error" && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<RefreshCcw className="size-4" />}
                  onClick={() => void loadLeads()}
                >
                  Erneut laden
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="brand"
                    size="md"
                    iconLeft={<Play className="size-4" />}
                    onClick={() => setConfirmOpen(true)}
                    disabled={
                      counts.total === 0 ||
                      runStatus === "approved" ||
                      runStatus === "generating" ||
                      runStatus === "completed"
                    }
                  >
                    Vollproduktion starten
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Phase 2 starten. Tastatur:{" "}
                  <span className="font-mono">R</span> entfernt,{" "}
                  <span className="font-mono">/</span> sucht.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Phase-1-Progress-Banner */}
          {phase1Running && counts.total > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[11px] text-ink-muted mb-1.5">
                  <span className="font-semibold uppercase tracking-wider">
                    Phase 1 läuft
                  </span>
                  <span className="tabular-nums">
                    {progressPercent}% geprüft — Sie können bereits prüfen
                  </span>
                </div>
                <Progress value={progressPercent} />
              </div>
            </div>
          )}
        </div>

        {/* Filter-Toolbar (Sticky direkt unter Topbar) */}
        <div
          className={cn(
            "sticky top-[88px] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3",
            "bg-surface-soft/95 backdrop-blur-sm border-b border-line",
          )}
          ref={(el) => {
            // Such-Input-Fokus per Shortcut.
            if (el) {
              searchInputRef.current = el.querySelector<HTMLInputElement>(
                'input[type="search"]',
              );
            }
          }}
        >
          <FilterToolbar
            leads={leads}
            activeFilters={activeFilters}
            searchQuery={searchQuery}
            sort={sort}
            onToggleFilter={toggleFilter}
            onSearchChange={setSearchQuery}
            onSortChange={setSort}
          />
        </div>

        {/* All-problematic Callout */}
        {allProblematic && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-squircle-sm bg-warn-soft border border-warn/40 text-warn">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">
                Hohe Fehlerquote — alle Leads sind problematisch.
              </p>
              <p className="text-xs mt-0.5">
                Tipp: Statt einzeln zu reviewen, bereinigen Sie die CSV und
                starten eine neue Runde.
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0"
            >
              <Link href={`/kampagnen/${campaignId}/runs/${runId}`}>
                Zur Run-Übersicht
              </Link>
            </Button>
          </div>
        )}

        {/* Grid */}
        <div className="min-h-[400px] pb-24">
          {!hasInitialLoad ? (
            <SkeletonGrid />
          ) : loadingState === "error" ? (
            <EmptyState
              icon={<TriangleAlert />}
              title="Leads konnten nicht geladen werden"
              subtitle="Die Verbindung zur API war nicht erfolgreich. Bitte erneut versuchen."
              action={
                <Button
                  variant="brand"
                  iconLeft={<RefreshCcw className="size-4" />}
                  onClick={() => void loadLeads()}
                >
                  Erneut versuchen
                </Button>
              }
            />
          ) : visibleLeads.length === 0 ? (
            <EmptyState
              title="Keine Leads in dieser Sicht"
              subtitle="Passen Sie Ihre Filter an oder löschen Sie das Suchfeld, um andere Leads zu sehen."
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setActiveFilters(new Set<FilterKey>(["all"]));
                    setSearchQuery("");
                  }}
                >
                  Filter zurücksetzen
                </Button>
              }
            />
          ) : (
            <PreflightGrid
              leads={visibleLeads}
              selected={selection.selected}
              focusedLeadId={focusedLeadId}
              onLeadOpen={onLeadOpen}
              onSelectToggle={onSelectToggle}
              onRetryScreenshot={handleRetryScreenshot}
            />
          )}
        </div>

        {/* Hint-Banner unten: Keyboard-Shortcuts */}
        <div className="text-[11px] text-ink-muted flex items-center gap-2 pb-4">
          <Keyboard className="size-3.5" />
          <span>
            <span className="font-mono font-semibold">R</span> entfernen ·{" "}
            <span className="font-mono font-semibold">K</span> behalten ·{" "}
            <span className="font-mono font-semibold">Space</span> markieren ·{" "}
            <span className="font-mono font-semibold">⌘A</span> alles ·{" "}
            <span className="font-mono font-semibold">F</span> Problematische ·{" "}
            <span className="font-mono font-semibold">/</span> Suche ·{" "}
            <span className="font-mono font-semibold">←/→</span> in Lightbox
            blättern
          </span>
        </div>
      </div>

      {/* Floating Bulk-Action-Bar */}
      <BulkActionBar
        selectedCount={selection.selectedCount}
        loading={bulkRemoveLoading}
        onRemove={handleBulkRemove}
        onClear={selection.clear}
      />

      {/* Lightbox */}
      <Lightbox
        open={lightboxOpenLeadId !== null}
        leads={visibleLeads}
        activeLeadId={lightboxOpenLeadId}
        onChangeActive={onLightboxChangeActive}
        onClose={onLightboxClose}
        onKeep={onLightboxKeep}
        onReject={onLightboxReject}
        onRetryScreenshot={handleRetryScreenshot}
      />

      {/* Confirm-Modal */}
      <ConfirmModal
        open={confirmOpen}
        loading={confirmLoading}
        leads={leads}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleApprove()}
      />
    </TooltipProvider>
  );
}

/**
 * Skeleton-Grid: 12 graue Card-Placeholder mit pulse-Animation.
 */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col bg-surface border border-line rounded-squircle-sm overflow-hidden"
        >
          <div className="aspect-video bg-gradient-to-br from-surface-muted via-line-soft to-surface-muted animate-pulse" />
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="h-3.5 w-2/3 bg-surface-muted animate-pulse rounded" />
            <div className="h-3 w-1/2 bg-surface-muted animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
