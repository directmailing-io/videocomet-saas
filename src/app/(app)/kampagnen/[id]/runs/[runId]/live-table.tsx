"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileDown,
  Play,
  FileText,
  RotateCcw,
  Loader2,
  Mail as MailIcon,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useToast } from "@/components/ui/toaster";
import { LeadAnalyticsDrawer } from "./lead-analytics-drawer";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BundleDialog } from "./bundle-dialog";
import { LeadEditDialog } from "./lead-edit-dialog";

interface LeadRow {
  id: string;
  rowIndex: number;
  status: string;
  slug: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  envelopePdfUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  /** Brief-Variante bei A/B-Runden ("A" | "B"), sonst null. */
  abVariant?: "A" | "B" | null;
  data: Record<string, string>;
  // Tracking aggregates (denormalized on `leads`). Optional because the SSE
  // tick payload from /api/runs/:id/stream doesn't include them — we MERGE
  // them in from `initialLeads` instead of overwriting (see mergeLeads).
  viewCount?: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  playCount?: number;
  watchTimeSec?: number;
  ctaClickCount?: number;
  lastCtaAt?: string | null;
  /** Custom-Domain-Hostname (NULL = Default app.videocomet.de). */
  customHostname?: string | null;
}

type FilterKey = "all" | "opened" | "played" | "cta" | "briefA" | "briefB";

function isFilterKey(value: string | null | undefined): value is FilterKey {
  return (
    value === "all" ||
    value === "opened" ||
    value === "played" ||
    value === "cta" ||
    value === "briefA" ||
    value === "briefB"
  );
}

interface Counts {
  pending: number;
  rendering: number;
  uploading: number;
  completed: number;
  failed: number;
}

interface WorkerStats {
  workers: number;
  inFlight: number;
  active: number;
  waiting: number;
  lastSeenAt: string | null;
}

interface PipelineEventDTO {
  id: string;
  runId: string;
  leadId: string | null;
  ts: string;
  level: "info" | "warn" | "error" | string;
  stage: string;
  message: string;
  durationMs: number | null;
}

const MAX_EVENTS_IN_MEMORY = 1000;

export interface LiveTableProps {
  runId: string;
  campaignId: string;
  pdfEnabled: boolean;
  /** True wenn die Runde mit A/B-Brief-Test gestartet wurde (runs.ab_config gesetzt). */
  abActive: boolean;
  initialRun: {
    id: string;
    name: string;
    status: string;
    totalLeads: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  initialCounts: Record<string, number>;
  initialLeads: LeadRow[];
}

function statusVariant(s: string): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (s) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "rendering":
    case "uploading":
      return "brand";
    case "pending":
      return "neutral";
    default:
      return "neutral";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "pending":
      return "Wartet";
    case "rendering":
      return "Rendert";
    case "uploading":
      return "Hochladen";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    default:
      return s;
  }
}

function prettyName(d: Record<string, string>): string {
  return (
    d.firstName ||
    d.Vorname ||
    d.name ||
    d.fullName ||
    [d.firstName, d.lastName].filter(Boolean).join(" ") ||
    "—"
  );
}

function prettyLastName(d: Record<string, string>): string {
  return d.lastName || d.Nachname || "";
}

function prettyEmail(d: Record<string, string>): string {
  return d.email || d["E-Mail"] || d.mail || "";
}

export function LiveTable({
  runId,
  campaignId: _campaignId,
  pdfEnabled,
  abActive,
  initialRun,
  initialCounts,
  initialLeads,
}: LiveTableProps) {
  const [runStatus, setRunStatus] = React.useState(initialRun.status);
  const [startedAt, setStartedAt] = React.useState<string | null>(
    initialRun.startedAt,
  );
  const [completedAt, setCompletedAt] = React.useState<string | null>(
    initialRun.completedAt,
  );
  const [counts, setCounts] = React.useState<Counts>({
    pending: initialCounts.pending ?? 0,
    rendering: initialCounts.rendering ?? 0,
    uploading: initialCounts.uploading ?? 0,
    completed: initialCounts.completed ?? 0,
    failed: initialCounts.failed ?? 0,
  });
  const [leads, setLeads] = React.useState<LeadRow[]>(initialLeads);
  const [regenerating, setRegenerating] = React.useState(false);

  // Live-Log state
  const [events, setEvents] = React.useState<PipelineEventDTO[]>([]);
  const [logOpen, setLogOpen] = React.useState(true);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [onlyErrors, setOnlyErrors] = React.useState(false);
  const logScrollRef = React.useRef<HTMLDivElement | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // Tracking-Filter (Alle / Geöffnet / Video gesehen / CTA geklickt).
  // State sync'd to `?filter=` so a refresh / shared link reopens the same
  // view. Client-side only — no server round-trip on switch.
  const filterFromUrl: FilterKey = (() => {
    const raw = searchParams?.get("filter") ?? null;
    return isFilterKey(raw) ? raw : "all";
  })();
  const [filter, setFilter] = React.useState<FilterKey>(filterFromUrl);
  React.useEffect(() => {
    // Pull URL → state when query changes via back/forward navigation.
    setFilter(filterFromUrl);
  }, [filterFromUrl]);

  const updateFilter = React.useCallback(
    (next: FilterKey) => {
      setFilter(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "all") params.delete("filter");
      else params.set("filter", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Drawer state for per-lead analytics.
  const [drawerLead, setDrawerLead] = React.useState<LeadRow | null>(null);
  const [editLead, setEditLead] = React.useState<LeadRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const openLeadDrawer = React.useCallback((lead: LeadRow) => {
    setDrawerLead(lead);
    setDrawerOpen(true);
  }, []);

  const isTerminal =
    runStatus === "completed" ||
    runStatus === "failed" ||
    runStatus === "cancelled";

  const regenerate = React.useCallback(
    async (mode: "all" | "video" | "pdf" | "failed") => {
      if (!isTerminal || regenerating) return;
      const failedCount = counts.failed;
      const confirmMessage =
        mode === "all"
          ? "Alle Videos und PDFs dieser Runde werden neu erzeugt. Bestehende Outputs werden überschrieben. Fortfahren?"
          : mode === "video"
            ? "Nur die Videos werden neu erzeugt — bestehende PDFs bleiben. Bestehende Outputs werden überschrieben. Fortfahren?"
            : mode === "pdf"
              ? "Nur die Briefe werden neu erzeugt — bestehende Videos bleiben. Bestehende Outputs werden überschrieben. Fortfahren?"
              : `${failedCount} fehlgeschlagene Leads werden neu versucht. Bestehende erfolgreiche Outputs bleiben.`;
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) return;
      setRegenerating(true);
      try {
        const res = await fetch(`/api/runs/${runId}/regenerate`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* ignore */
          }
          toast({
            title: "Neu generieren fehlgeschlagen",
            description: msg,
            variant: "danger",
          });
          return;
        }
        const toastTitle =
          mode === "all"
            ? "Runde wird neu generiert"
            : mode === "video"
              ? "Videos werden neu generiert"
              : mode === "pdf"
                ? "Briefe werden neu generiert"
                : "Fehlgeschlagene Leads werden neu versucht";
        toast({
          title: toastTitle,
          description: "Die Worker arbeiten die Leads jetzt erneut ab.",
        });
        // Run-Status springt zurück auf 'generating' — SSE Stream kickt sich
        // beim nächsten Render-Pass von alleine neu an.
        setRunStatus("generating");
        router.refresh();
      } catch (err) {
        toast({
          title: "Neu generieren fehlgeschlagen",
          description: err instanceof Error ? err.message : "Netzwerkfehler.",
          variant: "danger",
        });
      } finally {
        setRegenerating(false);
      }
    },
    [isTerminal, regenerating, runId, router, toast, counts.failed],
  );

  React.useEffect(() => {
    // Skip SSE if the run is already in a terminal state.
    if (
      runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "cancelled"
    ) {
      return;
    }
    const url = `/api/runs/${runId}/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("snapshot", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.counts) setCounts(payload.counts as Counts);
        if (payload.run) {
          setRunStatus(payload.run.status);
          if (typeof payload.run.startedAt === "string") {
            setStartedAt(payload.run.startedAt);
          } else if (payload.run.startedAt === null) {
            setStartedAt(null);
          }
          if (typeof payload.run.completedAt === "string") {
            setCompletedAt(payload.run.completedAt);
          } else if (payload.run.completedAt === null) {
            setCompletedAt(null);
          }
        }
        if (Array.isArray(payload.leads)) {
          // SSE snapshot doesn't carry the denormalized tracking fields
          // (viewCount, watchTimeSec, ...). Merge them in from the current
          // row so a reconnect doesn't wipe the column UI.
          setLeads((prev) =>
            replaceLeadsPreservingTracking(prev, payload.leads as LeadRow[]),
          );
        }
        if (Array.isArray(payload.pipelineEvents)) {
          // Snapshot replaces the log so a reconnect doesn't keep stale events
          // from a previous run-cycle of the same component.
          setEvents(
            (payload.pipelineEvents as PipelineEventDTO[]).slice(
              -MAX_EVENTS_IN_MEMORY,
            ),
          );
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("tick", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.counts) setCounts(payload.counts as Counts);
        if (payload.runStatus) {
          const next = payload.runStatus as string;
          setRunStatus(next);
          if (
            (next === "completed" || next === "failed" || next === "cancelled") &&
            !completedAt
          ) {
            // Server doesn't push completedAt on tick; lock the "Dauer:" label
            // to the moment the run terminated client-side.
            setCompletedAt(new Date().toISOString());
          }
        }
        if (Array.isArray(payload.recentEvents)) {
          setLeads((prev) => mergeLeads(prev, payload.recentEvents as LeadRow[]));
        }
        if (Array.isArray(payload.pipelineEvents) && payload.pipelineEvents.length > 0) {
          setEvents((prev) =>
            mergePipelineEvents(prev, payload.pipelineEvents as PipelineEventDTO[]),
          );
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("error", () => {
      // Browser auto-reconnects via the SSE retry frame.
    });

    return () => es.close();
  }, [runId, runStatus]);

  const total =
    counts.pending + counts.rendering + counts.uploading + counts.completed + counts.failed;
  const done = counts.completed + counts.failed;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // 1s ticker so the "Läuft seit:" label updates live while the run is running.
  // Stopped once the run terminates so we don't keep React waking up needlessly.
  const [nowTick, setNowTick] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (isTerminal) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isTerminal]);

  const filteredEvents = React.useMemo(
    () => (onlyErrors ? events.filter((e) => e.level === "error") : events),
    [events, onlyErrors],
  );

  // Auto-scroll: jump to bottom whenever new events arrive AND user wants it.
  React.useEffect(() => {
    if (!autoScroll || !logOpen) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredEvents.length, autoScroll, logOpen]);

  const runDurationLabel = formatRunDurationLabel({
    startedAt,
    completedAt,
    isTerminal,
    nowMs: nowTick,
  });
  const startedAtLabel = startedAt ? formatClock(startedAt) : null;

  // ETA: gewichtetes "noch ~X min" basierend auf bisher fertigen Leads pro ms.
  // Erst sichtbar, wenn der Run läuft, mindestens 30 s alt ist und schon
  // mindestens einen Completion-Event hatte (sonst Division durch 0).
  const etaLabel = React.useMemo(() => {
    if (isTerminal) return null;
    if (!startedAt) return null;
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) return null;
    const elapsedMs = nowTick - startMs;
    if (elapsedMs <= 30_000) return null;
    if (counts.completed <= 0) return null;
    const completedRate = counts.completed / elapsedMs; // leads pro ms
    if (completedRate <= 0) return null;
    const remaining = counts.pending + counts.rendering + counts.uploading;
    if (remaining <= 0) return null;
    const etaMs = remaining / completedRate;
    return formatEta(etaMs);
  }, [
    isTerminal,
    startedAt,
    nowTick,
    counts.completed,
    counts.pending,
    counts.rendering,
    counts.uploading,
  ]);

  // Worker-Stats Mini-Anzeige: alle 5 s pollen, solange der Run läuft.
  // Cache-Header der Route deckelt das auf ein realistisches Maß ab.
  const [workerStats, setWorkerStats] = React.useState<WorkerStats | null>(null);
  React.useEffect(() => {
    if (isTerminal) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/worker/stats", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as WorkerStats;
        if (!cancelled) setWorkerStats(j);
      } catch {
        // Netzwerkfehler ignorieren — nächste Tick versucht es erneut.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isTerminal]);

  // Tracking-Filter Aggregate + gefilterte Lead-Liste. Cheap to recompute on
  // every render — `leads` is typically <200 rows.
  const trackingCounts = React.useMemo(() => {
    let opened = 0,
      played = 0,
      clicked = 0,
      briefA = 0,
      briefB = 0;
    for (const l of leads) {
      if ((l.viewCount ?? 0) > 0) opened++;
      if ((l.playCount ?? 0) > 0) played++;
      if ((l.ctaClickCount ?? 0) > 0) clicked++;
      if (l.abVariant === "A") briefA++;
      if (l.abVariant === "B") briefB++;
    }
    return { opened, played, clicked, briefA, briefB };
  }, [leads]);

  const filteredLeads = React.useMemo(() => {
    switch (filter) {
      case "opened":
        return leads.filter((l) => (l.viewCount ?? 0) > 0);
      case "played":
        return leads.filter((l) => (l.playCount ?? 0) > 0);
      case "cta":
        return leads.filter((l) => (l.ctaClickCount ?? 0) > 0);
      case "briefA":
        return leads.filter((l) => l.abVariant === "A");
      case "briefB":
        return leads.filter((l) => l.abVariant === "B");
      default:
        return leads;
    }
  }, [leads, filter]);

  const workerStatsLabel = (() => {
    if (!workerStats) return null;
    const w = workerStats.workers;
    const a = workerStats.active;
    if (w === 0 && a === 0 && workerStats.waiting === 0) {
      return "Worker: offline";
    }
    // Bevorzugt die DB-Sicht; fällt auf BullMQ-active zurück, falls noch
    // kein Heartbeat geschrieben wurde.
    const workerCount = w > 0 ? w : a > 0 ? 1 : 0;
    return `Worker: ${workerCount} aktiv · ${a} laufen`;
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={statusVariant(runStatus)} dot>
                {statusLabel(runStatus)}
              </Badge>
              <span className="text-sm text-ink-muted">
                {done} / {total || initialRun.totalLeads} fertig
              </span>
              <Badge variant="neutral">Rendert: {counts.rendering}</Badge>
              <Badge variant="neutral">Wartet: {counts.pending}</Badge>
              {counts.failed > 0 && (
                <Badge variant="danger">Fehler: {counts.failed}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isTerminal && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      disabled={regenerating}
                      iconLeft={
                        regenerating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )
                      }
                    >
                      {regenerating ? "Wird gestartet…" : "Neu generieren"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void regenerate("all")}>
                      Alles neu generieren
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void regenerate("video")}>
                      Nur Video neu generieren
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void regenerate("pdf")}>
                      Nur Brief neu generieren
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={counts.failed === 0}
                      onSelect={() => {
                        if (counts.failed === 0) return;
                        void regenerate("failed");
                      }}
                    >
                      Nur Fehlgeschlagene neu versuchen
                      {counts.failed > 0 ? ` (${counts.failed})` : ""}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" iconLeft={<Download className="size-4" />}>
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`/api/runs/${runId}/export?format=xlsx`} download>
                      XLSX herunterladen
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/runs/${runId}/export?format=csv`} download>
                      CSV herunterladen
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/runs/${runId}/lead-export`} download>
                      Lead-Liste mit Begründungen (XLSX)
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {pdfEnabled && (
                <BundleDialog
                  runId={runId}
                  runName={initialRun.name}
                  abActive={abActive}
                />
              )}
            </div>
          </div>
          <div className="mt-4">
            <Progress value={pct} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setLogOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-brand-deep"
                aria-expanded={logOpen}
                aria-controls="live-log-body"
              >
                {logOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Live-Log
                <span className="ml-1 text-xs text-ink-muted">
                  ({filteredEvents.length}
                  {onlyErrors && events.length !== filteredEvents.length
                    ? ` von ${events.length}`
                    : ""}
                  )
                </span>
              </button>
              {workerStatsLabel && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-ink-muted"
                  title={
                    workerStats
                      ? `BullMQ active: ${workerStats.active} · waiting: ${workerStats.waiting} · in-flight: ${workerStats.inFlight}`
                      : undefined
                  }
                >
                  <span className="size-1.5 rounded-full bg-brand-deep/70" aria-hidden />
                  {workerStatsLabel}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              {startedAtLabel && (
                <span>
                  <span className="font-medium text-ink">Gestartet:</span>{" "}
                  {startedAtLabel}
                </span>
              )}
              {runDurationLabel && (
                <span>
                  <span className="font-medium text-ink">
                    {isTerminal ? "Dauer:" : "Läuft seit:"}
                  </span>{" "}
                  {runDurationLabel}
                </span>
              )}
              {etaLabel && (
                <span>
                  <span className="font-medium text-ink">ETA:</span>{" "}
                  {etaLabel}
                </span>
              )}
              <label className="inline-flex items-center gap-1.5">
                <Checkbox
                  checked={autoScroll}
                  onCheckedChange={(v) => setAutoScroll(v === true)}
                  aria-label="Auto-Scroll"
                />
                <span>Auto-Scroll</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <Checkbox
                  checked={onlyErrors}
                  onCheckedChange={(v) => setOnlyErrors(v === true)}
                  aria-label="Nur Fehler"
                />
                <span>{onlyErrors ? "Nur Fehler" : "Alle Events"}</span>
              </label>
            </div>
          </div>
          {logOpen && (
            <div
              id="live-log-body"
              ref={logScrollRef}
              className="mt-3 max-h-72 overflow-y-auto rounded-squircle-sm bg-surface-muted font-mono text-xs"
            >
              {filteredEvents.length === 0 ? (
                <div className="px-3 py-6 text-center text-ink-muted">
                  {onlyErrors
                    ? "Keine Fehler im Log."
                    : "Noch keine Events. Sobald der Worker arbeitet, erscheinen hier Live-Updates."}
                </div>
              ) : (
                <ul className="divide-y divide-line/60">
                  {filteredEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-start gap-3 px-3 py-1.5"
                    >
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {formatClock(ev.ts)}
                      </span>
                      <span
                        className={`shrink-0 w-12 text-center font-semibold uppercase ${eventLevelClass(
                          ev.level,
                        )}`}
                      >
                        {ev.level}
                      </span>
                      <span className="shrink-0 w-24 truncate text-ink-muted">
                        [{ev.stage}]
                      </span>
                      <span className="min-w-0 grow break-words text-ink">
                        {ev.message}
                        {typeof ev.durationMs === "number" && ev.durationMs > 0 ? (
                          <span className="ml-2 text-ink-muted">
                            ({formatDurationMs(ev.durationMs)})
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tracking-Filter (clientseitig, URL-sync'd) */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          active={filter === "all"}
          onClick={() => updateFilter("all")}
        >
          Alle <FilterPillCount>{leads.length}</FilterPillCount>
        </FilterPill>
        <FilterPill
          active={filter === "opened"}
          onClick={() => updateFilter("opened")}
        >
          Geöffnet <FilterPillCount>{trackingCounts.opened}</FilterPillCount>
        </FilterPill>
        <FilterPill
          active={filter === "played"}
          onClick={() => updateFilter("played")}
        >
          Video gesehen <FilterPillCount>{trackingCounts.played}</FilterPillCount>
        </FilterPill>
        <FilterPill
          active={filter === "cta"}
          onClick={() => updateFilter("cta")}
        >
          CTA geklickt <FilterPillCount>{trackingCounts.clicked}</FilterPillCount>
        </FilterPill>
        {abActive && (
          <>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            <FilterPill
              active={filter === "briefA"}
              onClick={() => updateFilter("briefA")}
            >
              Brief A <FilterPillCount>{trackingCounts.briefA}</FilterPillCount>
            </FilterPill>
            <FilterPill
              active={filter === "briefB"}
              onClick={() => updateFilter("briefB")}
            >
              Brief B <FilterPillCount>{trackingCounts.briefB}</FilterPillCount>
            </FilterPill>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-squircle-md bg-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Status</TableHead>
              {abActive && <TableHead>Brief</TableHead>}
              <TableHead>Aufrufe</TableHead>
              <TableHead>Wiedergabe</TableHead>
              <TableHead>Klicks</TableHead>
              <TableHead>Landingpage</TableHead>
              <TableHead>Video</TableHead>
              <TableHead>PDF</TableHead>
              <TableHead>Umschlag</TableHead>
              <TableHead className="w-14 text-right">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLeads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={abActive ? 13 : 12}
                  className="text-center text-ink-muted py-8"
                >
                  {leads.length === 0
                    ? "Noch keine Leads."
                    : "Keine Leads im aktiven Filter."}
                </TableCell>
              </TableRow>
            ) : (
              filteredLeads.map((l) => (
                <TableRow
                  key={l.id}
                  onClick={() => openLeadDrawer(l)}
                  className="cursor-pointer hover:bg-surface-muted/60 transition-colors"
                >
                  <TableCell className="text-xs text-ink-muted">
                    {l.rowIndex + 1}
                  </TableCell>
                  <TableCell className="font-medium text-ink">
                    {[prettyName(l.data), prettyLastName(l.data)]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-ink-muted text-xs">
                    {prettyEmail(l.data)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(l.status)} dot>
                      {statusLabel(l.status)}
                    </Badge>
                  </TableCell>
                  {abActive && (
                    <TableCell>
                      {l.abVariant ? (
                        <Badge variant={l.abVariant === "A" ? "brand" : "warn"}>
                          {l.abVariant}
                        </Badge>
                      ) : (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-xs">
                    {(l.viewCount ?? 0) > 0 ? (
                      <span className="inline-flex flex-col">
                        <span className="text-ink font-medium">
                          <span aria-hidden>👁</span> {l.viewCount}
                        </span>
                        <span className="text-ink-muted text-[11px]">
                          {formatRel(l.lastViewedAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(l.playCount ?? 0) > 0 ? (
                      <span className="inline-flex flex-col">
                        <span className="text-ink font-medium">
                          <span aria-hidden>▶</span> {l.playCount}
                        </span>
                        <span className="text-ink-muted text-[11px] tabular-nums">
                          {formatWatchTime(l.watchTimeSec ?? 0)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {(l.ctaClickCount ?? 0) > 0 ? (
                      <span className="inline-flex flex-col">
                        <span className="text-ink font-medium">
                          <span aria-hidden>✱</span> {l.ctaClickCount}
                        </span>
                        <span className="text-ink-muted text-[11px]">
                          {formatRel(l.lastCtaAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={stopRowClick}>
                    {l.slug ? (
                      <a
                        href={
                          buildLeadPublicUrl(
                            {
                              slug: l.slug,
                              customHostname: l.customHostname ?? null,
                            },
                            { preview: true },
                          ) ?? `/v/${l.slug}?preview=1`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                        title={
                          l.customHostname
                            ? `Auf ${l.customHostname} im Vorschau-Modus öffnen`
                            : "Im Vorschau-Modus öffnen (kein Tracking)"
                        }
                      >
                        <ExternalLink className="size-3.5" />
                        Vorschau
                      </a>
                    ) : (
                      <span className="text-ink-muted text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={stopRowClick}>
                    {l.videoUrl ? (
                      <a
                        href={l.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                      >
                        <Play className="size-3.5" />
                        abspielen
                      </a>
                    ) : (
                      <span className="text-ink-muted text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={stopRowClick}>
                    {l.pdfUrl ? (
                      <a
                        href={`/api/leads/${l.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                      >
                        <FileDown className="size-3.5" />
                        Download
                      </a>
                    ) : pdfEnabled ? (
                      <span className="text-ink-muted text-xs">—</span>
                    ) : (
                      <span className="text-ink-muted text-xs">aus</span>
                    )}
                  </TableCell>
                  <TableCell onClick={stopRowClick}>
                    {l.envelopePdfUrl ? (
                      <a
                        href={`/api/leads/${l.id}/envelope-pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                      >
                        <MailIcon className="size-3.5" />
                        Download
                      </a>
                    ) : (
                      <span className="text-ink-muted text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell onClick={stopRowClick} className="text-right">
                    <LeadRowActions
                      lead={l}
                      onEdit={() => setEditLead(l)}
                      onLeadUpdated={(nl) => setLeads((prev) =>
                        prev.map((x) => (x.id === nl.id ? { ...x, ...nl } : x)),
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LeadAnalyticsDrawer
        lead={drawerLead}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      <LeadEditDialog
        lead={editLead}
        onOpenChange={(open) => {
          if (!open) setEditLead(null);
        }}
        onSaved={(updated) => {
          setLeads((prev) =>
            prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)),
          );
        }}
      />

      {/* Tree-shake guard for icons not always used above */}
      <span aria-hidden className="hidden">
        <FileText className="size-0" />
      </span>
    </div>
  );
}

/** Overflow-Menue pro Lead-Zeile: Bearbeiten + Neu-Generieren. */
function LeadRowActions({
  lead,
  onEdit,
  onLeadUpdated,
}: {
  lead: LeadRow;
  onEdit: () => void;
  onLeadUpdated: (patch: Partial<LeadRow> & { id: string }) => void;
}): React.JSX.Element {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<null | "all" | "pdf" | "envelope" | "video">(null);

  async function regenerate(scope: "all" | "pdf" | "envelope" | "video") {
    setBusy(scope);
    try {
      const res = await fetch(`/api/leads/${lead.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? "Fehler");
      }
      // Lokale Row auf "pending" flippen, damit die UI sofort reagiert.
      const patch: Partial<LeadRow> & { id: string } = {
        id: lead.id,
        status: "pending",
      };
      if (scope === "all" || scope === "pdf") patch.pdfUrl = null;
      if (scope === "all" || scope === "envelope") patch.envelopePdfUrl = null;
      if (scope === "all" || scope === "video") patch.videoUrl = null;
      onLeadUpdated(patch);
      toast({
        variant: "success",
        title:
          scope === "all"
            ? "Lead wird neu generiert …"
            : scope === "pdf"
              ? "PDF wird neu generiert …"
              : scope === "envelope"
                ? "Umschlag wird neu generiert …"
                : "Video wird neu generiert …",
      });
    } catch (err) {
      toast({
        variant: "danger",
        title: "Regenerieren fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-line-soft"
          aria-label="Aktionen"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin text-ink-muted" />
          ) : (
            <MoreHorizontal className="size-4 text-ink-muted" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="size-3.5 text-ink-muted" />
          Lead-Daten bearbeiten
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void regenerate("all")}>
          <RotateCcw className="size-3.5 text-ink-muted" />
          Alles neu erstellen
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void regenerate("video")}>
          <Play className="size-3.5 text-ink-muted" />
          Nur Video neu
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void regenerate("pdf")}>
          <FileDown className="size-3.5 text-ink-muted" />
          Nur PDF-Brief neu
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void regenerate("envelope")}>
          <MailIcon className="size-3.5 text-ink-muted" />
          Nur Umschlag neu
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-brand text-white shadow-brand"
          : "bg-surface text-ink-muted shadow-card hover:bg-surface-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FilterPillCount({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums">
      {children}
    </span>
  );
}

/**
 * Helper to stop a cell's own clickable target (link, button) from bubbling
 * up to the row click. Without this, the analytics drawer would open every
 * time a user clicks the landingpage / video / PDF link.
 */
function stopRowClick(e: React.MouseEvent): void {
  e.stopPropagation();
}

function formatWatchTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Compact German relative-time formatting for inline use in the table. No
 * external dep; precision rolls up at boundaries that match what users
 * actually want to see (just-now / minutes / hours / days).
 */
function formatRel(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "gerade eben";
  if (ms < 3_600_000) return `vor ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `vor ${Math.floor(ms / 3_600_000)} Std`;
  if (ms < 30 * 86_400_000) return `vor ${Math.floor(ms / 86_400_000)} Tg.`;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

function mergePipelineEvents(
  prev: PipelineEventDTO[],
  incoming: PipelineEventDTO[],
): PipelineEventDTO[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((e) => [e.id, e] as const));
  for (const e of incoming) byId.set(e.id, e);
  const merged = Array.from(byId.values()).sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );
  // Cap at last MAX_EVENTS_IN_MEMORY so a long run doesn't blow up the tab.
  return merged.length > MAX_EVENTS_IN_MEMORY
    ? merged.slice(-MAX_EVENTS_IN_MEMORY)
    : merged;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventLevelClass(level: string): string {
  if (level === "error") return "text-danger";
  if (level === "warn") return "text-warn";
  return "text-ink-muted";
}

function formatEta(ms: number): string {
  if (ms < 60_000) return "<1 min";
  if (ms < 3_600_000) return `~${Math.round(ms / 60_000)} min`;
  return `~${(ms / 3_600_000).toFixed(1)} Std`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${mins} min ${rest} s`;
}

function formatRunDurationLabel(input: {
  startedAt: string | null;
  completedAt: string | null;
  isTerminal: boolean;
  nowMs: number;
}): string | null {
  const { startedAt, completedAt, isTerminal, nowMs } = input;
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const endMs = (() => {
    if (completedAt) {
      const t = new Date(completedAt).getTime();
      return Number.isNaN(t) ? null : t;
    }
    return isTerminal ? null : nowMs;
  })();
  if (endMs == null) return null;
  const diff = Math.max(0, endMs - startMs);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
}

function mergeLeads(prev: LeadRow[], updates: LeadRow[]): LeadRow[] {
  if (updates.length === 0) return prev;
  // Idempotent in-place replace: the initial snapshot already carries every
  // lead, so a tick only ever PATCHES existing rows — never adds. Mapping by
  // id and falling through to the previous row when no update arrived keeps
  // the ordering stable and guarantees status / asset URL changes overwrite
  // the previous row instead of being shallow-merged into stale fields.
  //
  // Tracking fields (viewCount, watchTimeSec, ...) come from a separate code
  // path (initial server-render) and aren't part of the SSE tick payload.
  // We keep them sticky across ticks by re-overlaying the previous row's
  // tracking aggregates onto the incoming patch.
  const updateMap = new Map(updates.map((u) => [u.id, u] as const));
  let changed = false;
  const next = prev.map((p) => {
    const u = updateMap.get(p.id);
    if (!u) return p;
    changed = true;
    return mergeTrackingFields(u, p);
  });
  return changed ? next : prev;
}

/**
 * Apply incoming SSE `next` lead-row but keep the tracking aggregates from
 * the older `existing` row. Used for both snapshot-replace and tick-merge.
 */
function mergeTrackingFields(next: LeadRow, existing: LeadRow | undefined): LeadRow {
  if (!existing) return next;
  return {
    ...next,
    viewCount: next.viewCount ?? existing.viewCount,
    firstViewedAt: next.firstViewedAt ?? existing.firstViewedAt,
    lastViewedAt: next.lastViewedAt ?? existing.lastViewedAt,
    playCount: next.playCount ?? existing.playCount,
    watchTimeSec: next.watchTimeSec ?? existing.watchTimeSec,
    ctaClickCount: next.ctaClickCount ?? existing.ctaClickCount,
    lastCtaAt: next.lastCtaAt ?? existing.lastCtaAt,
    customHostname: next.customHostname ?? existing.customHostname,
  };
}

/**
 * Snapshot-style replace: the SSE snapshot resends every lead. We honour the
 * server's ordering and field set, but overlay the previous tracking
 * aggregates so a reconnect doesn't blank the new columns.
 */
function replaceLeadsPreservingTracking(
  prev: LeadRow[],
  incoming: LeadRow[],
): LeadRow[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((l) => [l.id, l] as const));
  return incoming.map((n) => mergeTrackingFields(n, prevMap.get(n.id)));
}
