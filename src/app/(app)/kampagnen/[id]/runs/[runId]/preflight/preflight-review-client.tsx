"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Keyboard,
  Loader2,
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
} from "./_components/filter-toolbar";
import { Lightbox } from "./_components/lightbox";
import { LeadContextMenu } from "./_components/lead-context-menu";
import { BulkActionBar } from "./_components/bulk-action-bar";
import { ConfirmModal } from "./_components/confirm-modal";
import { useSelection } from "./_components/use-selection";
import { useKeyboardShortcuts } from "./_components/use-keyboard-shortcuts";
import {
  IntroPreviewSection,
  type IntroPreviewInfo,
} from "./_components/intro-preview-section";
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
  /** Personalisierte Video-Begrüßung (optional für ältere Server-Builds). */
  intro?: IntroPreviewInfo;
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
  const [view, setView] = React.useState<FilterKey>("problematic");
  // Einmalige Auto-Korrektur nach dem ersten Laden: der Default-Filter
  // "Auffällig" wäre bei 0 auffälligen Leads eine leere Sicht.
  const viewAutoAdjusted = React.useRef(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [ctxMenu, setCtxMenu] = React.useState<{
    leadId: string;
    x: number;
    y: number;
  } | null>(null);
  const [lightboxOpenLeadId, setLightboxOpenLeadId] = React.useState<
    string | null
  >(null);
  const [focusedLeadId, setFocusedLeadId] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmLoading, setConfirmLoading] = React.useState(false);
  const [bulkRemoveLoading, setBulkRemoveLoading] = React.useState(false);
  // Personalisierte Video-Begrüßung: Status-Block + Pflicht-Checkbox.
  const [intro, setIntro] = React.useState<IntroPreviewInfo | null>(null);
  const [introChecked, setIntroChecked] = React.useState(false);

  const selection = useSelection(runId);

  React.useEffect(() => {
    if (loadingState !== "ready" || viewAutoAdjusted.current) return;
    viewAutoAdjusted.current = true;
    if (counts.problematic === 0) setView("all");
  }, [loadingState, counts.problematic]);

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
      setIntro(data.intro ?? null);
    } catch {
      // Polling-Fallback fängt das spätere Refresh.
    }
  }, [runId]);

  // Initial-Load — parallel.
  React.useEffect(() => {
    void Promise.all([loadLeads(), loadStatus()]);
  }, [loadLeads, loadStatus]);

  // Wenn die Status-Aggregation sagt "kein pending, kein running" aber die
  // Lead-Liste lokal noch Karten als running/pending führt, ist das ein
  // Sync-Lag (SSE-Tick verpasst, Worker hat batch-update gefahren, …).
  // Sicherheits-Refetch — sofort + nach 1.5s nochmal, falls der erste
  // Roundtrip mit der Lead-DB noch race-läuft.
  const reconcileRef = React.useRef(0);
  React.useEffect(() => {
    if (loadingState !== "ready") return;
    if (counts.pending !== 0 || counts.running !== 0) return;
    const stuck = leads.some(
      (l) =>
        !l.removedAt &&
        (l.preflightStatus === "pending" || l.preflightStatus === "running"),
    );
    if (!stuck) return;
    if (reconcileRef.current >= 2) return;
    reconcileRef.current += 1;
    const t = window.setTimeout(() => {
      void loadLeads();
    }, reconcileRef.current === 1 ? 50 : 1500);
    return () => window.clearTimeout(t);
  }, [counts.pending, counts.running, leads, loadingState, loadLeads]);

  // Wenn der Run "awaiting_approval" / "approved" erreicht hat (also Phase 1
  // sicher fertig ist), einmal die Leads sauber nachladen — die SSE-Ticks
  // sind nicht garantiert flussdicht, aber der Server-Snapshot ist.
  const lastSyncedRunStatusRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastSyncedRunStatusRef.current === runStatus) return;
    lastSyncedRunStatusRef.current = runStatus;
    if (runStatus === "awaiting_approval" || runStatus === "approved") {
      void loadLeads();
    }
  }, [runStatus, loadLeads]);

  // Wenn der User vom Tab zurückkommt: aktuellen Snapshot holen.
  React.useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      void Promise.all([loadLeads(), loadStatus()]);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
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
              title: "Prüfung fertig",
              description:
                "Schau kurz drüber und starte dann die Videos.",
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
    () =>
      applyFilterAndSort(
        leads,
        new Set<FilterKey>([view]),
        searchQuery,
        "problems_first",
      ),
    [leads, view, searchQuery],
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
            "Diese Leads bekommen kein Video. Du kannst sie über den Filter „Entfernt“ jederzeit zurückholen.",
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
            "Das hat gerade nicht geklappt. Bitte versuch es gleich nochmal.",
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

  const handleSingleRemove = React.useCallback(
    async (leadId: string) => {
      await rejectLeads([leadId]);
    },
    [rejectLeads],
  );

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

  // Intro-Gate: Solange Beispielvideos vorliegen aber noch nicht bestätigt
  // sind, darf die Vollproduktion nicht starten.
  const introApprovalRequired = Boolean(
    intro?.enabled &&
      intro.voiceReady &&
      intro.previews.length > 0 &&
      intro.previewApprovedAt === null,
  );

  const handleApprove = React.useCallback(async (
    options?: { approveAlsoProblematic?: boolean },
  ) => {
    if (introApprovalRequired && !introChecked) {
      setConfirmOpen(false);
      toast({
        variant: "danger",
        title: "Beispielvideos noch nicht freigegeben",
        description:
          "Bitte prüfe die Beispielvideos der personalisierten Begrüßung und setze das Häkchen zur Freigabe.",
      });
      return;
    }
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/preflight/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rejectedLeadIds: [],
          approveAlsoProblematic: options?.approveAlsoProblematic ?? false,
          // Personalisierte Begrüßung: bestätigte Beispielvideos.
          introApproved:
            introChecked || Boolean(intro?.previewApprovedAt),
        }),
      });
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (body.error === "intro_preview_not_approved") {
          setConfirmOpen(false);
          toast({
            variant: "danger",
            title: "Beispielvideos noch nicht freigegeben",
            description:
              "Bitte prüfe die Beispielvideos der personalisierten Begrüßung und setze das Häkchen zur Freigabe.",
          });
          return;
        }
        throw new Error(body.error ?? "HTTP 400");
      }
      if (res.status === 409) {
        toast({
          variant: "danger",
          title: "Die Videos werden schon erstellt",
          description: "Wir bringen dich zur Übersicht.",
        });
        router.push(`/kampagnen/${campaignId}/runs/${runId}`);
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setConfirmOpen(false);
        toast({
          variant: "danger",
          title: "Keine Leads zum Produzieren",
          description:
            body.error ??
            "Alle Leads wurden abgelehnt oder aussortiert. Bitte prüfe die Liste.",
        });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({
        variant: "success",
        title: "Los geht's, die Videos werden erstellt",
        description: "Wir bringen dich zur Übersicht.",
      });
      // Lokalen Selection-Cache räumen — Run wechselt jetzt seine Phase.
      selection.clear();
      router.push(`/kampagnen/${campaignId}/runs/${runId}`);
    } catch {
      toast({
        variant: "danger",
        title: "Start fehlgeschlagen",
        description:
          "Das hat gerade nicht geklappt. Bitte versuch es in ein paar Minuten nochmal.",
      });
    } finally {
      setConfirmLoading(false);
      setConfirmOpen(false);
    }
  }, [
    runId,
    campaignId,
    router,
    selection,
    toast,
    intro,
    introChecked,
    introApprovalRequired,
  ]);

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
    ArrowLeft: () => {
      if (lightboxOpenLeadId) return; // Lightbox hat eigenes Blättern
      moveFocus(-1);
    },
    ArrowRight: () => {
      if (lightboxOpenLeadId) return;
      moveFocus(1);
    },
    ArrowUp: () => {
      if (lightboxOpenLeadId) return;
      moveFocus(-getGridColumnCount());
    },
    ArrowDown: () => {
      if (lightboxOpenLeadId) return;
      moveFocus(getGridColumnCount());
    },
  });

  /**
   * Berechnet die aktuelle Spaltenanzahl im Grid aus dem live gerenderten
   * CSS — robust gegen Viewport-Resize ohne dass wir die Breakpoints
   * hardcoden müssen.
   */
  function getGridColumnCount(): number {
    const grid = document.querySelector<HTMLDivElement>(
      '[role="grid"][aria-label="Lead-Quality-Check-Grid"]',
    );
    if (!grid) return 1;
    const cols = window
      .getComputedStyle(grid)
      .gridTemplateColumns.split(" ")
      .filter(Boolean).length;
    return Math.max(1, cols);
  }

  function moveFocus(delta: number): void {
    if (visibleIds.length === 0) return;
    const currentIndex = focusedLeadId
      ? visibleIds.indexOf(focusedLeadId)
      : -1;
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const next = Math.max(
      0,
      Math.min(visibleIds.length - 1, startIndex + delta),
    );
    const nextId = visibleIds[next];
    if (!nextId || nextId === focusedLeadId) return;
    setFocusedLeadId(nextId);
    // DOM-Focus mit umsetzen — sonst kann ein anderer Tabstop noch den
    // Browser-Fokus halten und Tasten-Events landen woanders.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLDivElement>(
        `[data-lead-id="${nextId}"]`,
      );
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

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
            "bg-surface-soft/95 backdrop-blur-sm border-b border-line-soft",
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
                  Leads prüfen
                </div>
                <h1 className="text-base sm:text-lg font-bold text-ink leading-tight truncate">
                  {runName}
                  <span className="text-ink-muted font-medium">
                    {" "}· {campaignName}
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Prüfung überspringen: Alle Leads gehen sofort in die Produktion, auch die auffälligen. Sicher?",
                        )
                      ) {
                        void handleApprove({ approveAlsoProblematic: true });
                      }
                    }}
                    disabled={
                      counts.total === 0 ||
                      runStatus === "approved" ||
                      runStatus === "generating" ||
                      runStatus === "completed" ||
                      confirmLoading
                    }
                  >
                    Prüfung überspringen
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Startet sofort mit allen Leads, auch mit den auffälligen.
                </TooltipContent>
              </Tooltip>
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
                    Videos jetzt erstellen
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Erstellt die Videos für alle behaltenen Leads. Tastatur:{" "}
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
                    Leads werden geprüft
                  </span>
                  <span className="tabular-nums">
                    {progressPercent} % fertig. Du kannst dir die Leads schon anschauen.
                  </span>
                </div>
                <Progress value={progressPercent} />
              </div>
            </div>
          )}
        </div>

        {/* "Was ist zu tun?"-Karte: adaptive Schritte je nach Zustand */}
        {hasInitialLoad &&
          counts.total > 0 &&
          runStatus !== "approved" &&
          runStatus !== "generating" &&
          runStatus !== "completed" && (
            <NextStepsCard
              phase1Running={phase1Running}
              counts={counts}
              intro={intro}
              introChecked={introChecked}
            />
          )}

        {/* Filter-Toolbar (Sticky direkt unter Topbar) */}
        <div
          className={cn(
            "sticky top-[88px] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3",
            "bg-surface-soft/95 backdrop-blur-sm border-b border-line-soft",
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
            view={view}
            searchQuery={searchQuery}
            onViewChange={setView}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Personalisierte Begrüßung: Beispielvideos prüfen / Status */}
        {intro && (
          <IntroPreviewSection
            intro={intro}
            checked={introChecked}
            onCheckedChange={setIntroChecked}
            campaignId={campaignId}
            runId={runId}
          />
        )}

        {/* All-problematic Callout */}
        {allProblematic && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-squircle-sm bg-warn-soft border border-warn/40 text-warn">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">
                Alle Leads sind auffällig.
              </p>
              <p className="text-xs mt-0.5">
                Tipp: Prüf deine CSV-Datei (stimmen die Website-Adressen?) und
                starte dann eine neue Runde. Das geht meist schneller, als
                jeden Lead einzeln anzuschauen.
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

        {/* Cookie-Banner-Hinweis für die Screenshot-Kontrolle */}
        <div className="flex items-start gap-2.5 px-4 py-2.5 rounded-squircle-sm bg-surface-soft border border-line-soft text-ink-muted">
          <Info className="size-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            Cookie- und Popup-Banner auf den Screenshots? Kein Grund zur
            Sorge: Beim fertigen Video werden sie in der Regel automatisch
            ausgeblendet. Das klappt bei fast allen Seiten, garantieren
            können wir es aber nicht.
          </p>
        </div>

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
              title="Hier ist gerade nichts"
              subtitle="Ändere den Filter oder leere das Suchfeld, dann siehst du wieder Leads."
              action={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setView("all");
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
              onSelectToggle={onSelectToggle}
              onContextMenu={(leadId, e) => {
                e.preventDefault();
                setCtxMenu({ leadId, x: e.clientX, y: e.clientY });
              }}
              onRetryScreenshot={handleRetryScreenshot}
            />
          )}
        </div>

        {/* Hint-Banner unten: Keyboard-Shortcuts */}
        <div className="text-[11px] text-ink-muted flex items-center gap-2 pb-4">
          <Keyboard className="size-3.5" />
          <span>
            <span className="font-mono font-semibold">←→</span> navigieren ·{" "}
            <span className="font-mono font-semibold">Enter</span> Details ·{" "}
            <span className="font-mono font-semibold">R</span> entfernen ·{" "}
            <span className="font-mono font-semibold">/</span> Suche
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

      {/* Context-Menu (Rechtsklick auf Card) */}
      {ctxMenu &&
        (() => {
          const lead = leads.find((l) => l.id === ctxMenu.leadId);
          if (!lead) return null;
          return (
            <LeadContextMenu
              lead={lead}
              position={{ x: ctxMenu.x, y: ctxMenu.y }}
              onClose={() => setCtxMenu(null)}
              onOpenDetails={() => setLightboxOpenLeadId(lead.id)}
              onRequestRemove={() => void handleSingleRemove(lead.id)}
              onToast={(msg, variant) =>
                toast({
                  title: msg,
                  variant: variant ?? "success",
                })
              }
            />
          );
        })()}

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
 * "Was ist zu tun?"-Karte: zeigt 2-3 adaptive Schritte, damit sofort klar
 * ist, was der User in dieser Ansicht machen soll.
 */
function NextStepsCard({
  phase1Running,
  counts,
  intro,
  introChecked,
}: {
  phase1Running: boolean;
  counts: CountsPayload;
  intro: IntroPreviewInfo | null;
  introChecked: boolean;
}) {
  type StepState = "running" | "todo" | "done" | "warn";
  interface Step {
    state: StepState;
    title: string;
    hint: string;
  }

  const steps: Step[] = [];

  // Schritt 1: Auffällige Leads aussortieren.
  if (phase1Running) {
    steps.push({
      state: "running",
      title: "Auffällige Leads aussortieren",
      hint: "Die Prüfung läuft noch. Du kannst dir die Leads aber schon anschauen.",
    });
  } else if (counts.problematic > 0) {
    steps.push({
      state: "todo",
      title: "Auffällige Leads aussortieren",
      hint: `${counts.problematic} Lead${counts.problematic === 1 ? " ist" : "s sind"} auffällig. Schau kurz drüber und entferne, was kein Video bekommen soll.`,
    });
  } else {
    steps.push({
      state: "done",
      title: "Auffällige Leads aussortieren",
      hint: "Alles sauber. Hier musst du nichts machen.",
    });
  }

  // Schritt 2 (nur mit aktiver KI-Begrüßung): Beispielvideos freigeben.
  if (intro?.enabled && intro.voiceReady) {
    if (!intro.previewsGenerated) {
      steps.push({
        state: "running",
        title: "Beispielvideos freigeben",
        hint: "Wir erstellen gerade ein paar Beispielvideos mit deiner KI-Begrüßung. Das dauert etwa 5 Minuten.",
      });
    } else if (intro.previews.length === 0) {
      steps.push({
        state: "warn",
        title: "Beispielvideos freigeben",
        hint: "Das hat leider nicht geklappt. Details stehen in der Karte unten. Deine Videos laufen sonst ohne KI-Begrüßung.",
      });
    } else if (intro.previewApprovedAt !== null || introChecked) {
      steps.push({
        state: "done",
        title: "Beispielvideos freigeben",
        hint: "Erledigt, die Beispielvideos sind freigegeben.",
      });
    } else {
      steps.push({
        state: "todo",
        title: "Beispielvideos freigeben",
        hint: "Schau dir die Beispielvideos unten an und setz das Häkchen, wenn sie gut klingen.",
      });
    }
  }

  // Letzter Schritt: Videos erstellen.
  steps.push({
    state: "todo",
    title: "Auf „Videos jetzt erstellen“ klicken",
    hint: "Der Knopf ist oben rechts. Danach erstellen wir die Videos für alle behaltenen Leads.",
  });

  return (
    <div className="bg-surface rounded-squircle-md shadow-card p-5">
      <h2 className="text-base font-semibold text-ink mb-3">
        {phase1Running
          ? "Wir prüfen gerade deine Leads"
          : "Prüfung fertig. So geht es weiter:"}
      </h2>
      <ol className="flex flex-col sm:flex-row gap-4 sm:gap-6">
        {steps.map((step, idx) => (
          <li key={step.title} className="flex items-start gap-3 sm:flex-1 min-w-0">
            {step.state === "done" ? (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
                <CheckCircle2 className="size-4" />
              </span>
            ) : step.state === "running" ? (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                <Loader2 className="size-4 animate-spin" />
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  step.state === "warn"
                    ? "bg-warn-soft text-warn"
                    : "bg-brand-soft text-brand",
                )}
              >
                {idx + 1}
              </span>
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold leading-tight",
                  step.state === "done" ? "text-ink-muted" : "text-ink",
                )}
              >
                {step.title}
              </p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                {step.hint}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
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
          className="flex flex-col bg-surface rounded-squircle-sm shadow-card overflow-hidden"
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
