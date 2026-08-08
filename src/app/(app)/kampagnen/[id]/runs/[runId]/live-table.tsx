"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Send,
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
  MailCheck,
  MailWarning,
  MailX,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Reply,
  Search,
  UserX,
} from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useToast } from "@/components/ui/toaster";
import { LeadAnalyticsDrawer } from "./lead-analytics-drawer";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { cn } from "@/lib/utils";
import { runStatusLabel, runStatusVariant } from "@/lib/run-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BundleDialog } from "./bundle-dialog";
import { LeadEditDialog } from "./lead-edit-dialog";
import { formatRunEta, type RunEtaEntry } from "@/lib/run-eta-format";

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

const PAGE_SIZE = 50;

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
  /**
   * Kompakter E-Mail-Outreach-Status pro Lead-ID. Leer/undefined ⇒ keine
   * Blast-Messages für diese Runde ⇒ Spalte wird nicht gerendert.
   */
  emailStatusMap?: Record<string, string>;
  /**
   * True, wenn mindestens ein Lead dieser Runde eine E-Mail-Adresse hat —
   * steuert den "E-Mails versenden"-CTA in der Erfolgskarte.
   */
  hasEmailLeads?: boolean;
}

const EMAIL_STATUS_META: Record<
  string,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  unsubscribed: { label: "Abgemeldet", className: "text-danger", Icon: UserX },
  replied: { label: "Hat geantwortet", className: "text-ok", Icon: Reply },
  bounced: { label: "Bounce", className: "text-danger", Icon: MailX },
  clicked: { label: "Geklickt", className: "text-brand-deep", Icon: MousePointerClick },
  sent: { label: "E-Mail versendet", className: "text-ok", Icon: MailCheck },
  failed: { label: "Versand fehlgeschlagen", className: "text-danger", Icon: MailWarning },
  skipped: { label: "Übersprungen", className: "text-ink-muted", Icon: MailX },
  scheduled: { label: "E-Mail geplant", className: "text-ink-muted", Icon: MailIcon },
};

function EmailStatusCell({ status }: { status: string | undefined }) {
  if (!status) return <span className="text-ink-muted text-xs">—</span>;
  const meta = EMAIL_STATUS_META[status];
  if (!meta) return <span className="text-ink-muted text-xs">—</span>;
  const { Icon } = meta;
  return (
    <span title={meta.label} className={cn("inline-flex", meta.className)}>
      <Icon className="size-4" />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
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
  campaignId,
  pdfEnabled,
  abActive,
  initialRun,
  initialCounts,
  initialLeads,
  emailStatusMap,
  hasEmailLeads,
}: LiveTableProps) {
  const emailColumnActive =
    !!emailStatusMap && Object.keys(emailStatusMap).length > 0;
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
  const [resuming, setResuming] = React.useState(false);

  // Live-Log state
  const [events, setEvents] = React.useState<PipelineEventDTO[]>([]);
  const [logOpen, setLogOpen] = React.useState(false);
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

  // Namens-/E-Mail-Suche + Client-Pagination (50/Seite).
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  React.useEffect(() => {
    setPage(0);
  }, [filter, search]);

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

  // Fortsetzen nach Intro-Notbremse: der Server hat den Run pausiert, weil zu
  // viele personalisierte Begrüßungen fehlgeschlagen sind. POST /resume setzt
  // paused → generating und reiht die hängenden Leads wieder ein.
  const resumeRun = React.useCallback(async () => {
    if (runStatus !== "paused" || resuming) return;
    setResuming(true);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, {
        method: "POST",
        credentials: "same-origin",
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
          title: "Fortsetzen fehlgeschlagen",
          description: msg,
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Lauf fortgesetzt",
        description: "Die verbleibenden Leads werden jetzt weiterverarbeitet.",
      });
      setRunStatus("generating");
      router.refresh();
    } catch (err) {
      toast({
        title: "Fortsetzen fehlgeschlagen",
        description: err instanceof Error ? err.message : "Netzwerkfehler.",
        variant: "danger",
      });
    } finally {
      setResuming(false);
    }
  }, [runStatus, resuming, runId, router, toast]);

  // Server-berechnete ETA (W3, Worker → Redis → SSE). Hat Vorrang vor der
  // naiven Rate-Schätzung; formatRunEta liefert null, sobald der Eintrag
  // veraltet ist, dann greift der Fallback.
  const [serverEta, setServerEta] = React.useState<RunEtaEntry | null>(null);

  // True while we were live-streaming — the terminal transition then owes the
  // table one final snapshot, because the live EventSource gets closed by the
  // effect cleanup before the last lead-status patches arrive.
  const needFinalSyncRef = React.useRef(false);

  React.useEffect(() => {
    if (
      runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "cancelled"
    ) {
      // Snapshot IMMER holen — sowohl bei Terminal-Transition mitten im
      // Live-Streaming (needFinalSyncRef=true) als auch bei First-Load eines
      // bereits abgeschlossenen Runs (needFinalSyncRef=false). Ohne diesen
      // First-Load-Pfad bleibt „Technisches Log (0)" leer obwohl in der DB
      // 30+ Events stehen.
      needFinalSyncRef.current = false;
      // One-shot final sync: snapshot anwenden, sofort wieder schließen.
      const finalEs = new EventSource(`/api/runs/${runId}/stream`, {
        withCredentials: true,
      });
      finalEs.addEventListener("snapshot", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data);
          if (payload.counts) setCounts(payload.counts as Counts);
          if (Array.isArray(payload.leads)) {
            setLeads((prev) =>
              replaceLeadsPreservingTracking(prev, payload.leads as LeadRow[]),
            );
          }
          if (Array.isArray(payload.pipelineEvents)) {
            setEvents(
              (payload.pipelineEvents as PipelineEventDTO[]).slice(
                -MAX_EVENTS_IN_MEMORY,
              ),
            );
          }
        } catch {
          // ignore
        }
        finalEs.close();
      });
      finalEs.addEventListener("error", () => finalEs.close());
      return () => finalEs.close();
    }
    needFinalSyncRef.current = true;
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
        setServerEta((payload.eta as RunEtaEntry | null) ?? null);
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
        setServerEta((payload.eta as RunEtaEntry | null) ?? null);
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

  // ETA: bevorzugt die Server-ETA (Worker berechnet lastbewusst, W3) —
  // formatRunEta liefert bereits "Noch ~X Min. · fertig ca. …" und wird
  // null, sobald der Cache-Eintrag >3 min alt ist. Fallback: naive
  // Rate-Schätzung (fertige Leads pro ms), erst nach 30 s + 1 Completion.
  const etaLabel = React.useMemo(() => {
    if (isTerminal) return null;
    const remaining = counts.pending + counts.rendering + counts.uploading;
    if (remaining <= 0) return null;
    if (serverEta) {
      const label = formatRunEta(serverEta, nowTick);
      if (label) return label;
    }
    if (!startedAt) return null;
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) return null;
    const elapsedMs = nowTick - startMs;
    if (elapsedMs <= 30_000) return null;
    if (counts.completed <= 0) return null;
    const completedRate = counts.completed / elapsedMs; // leads pro ms
    if (completedRate <= 0) return null;
    const etaMs = remaining / completedRate;
    return `Noch ${formatEta(etaMs)}`;
  }, [
    isTerminal,
    serverEta,
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
    let base: LeadRow[];
    switch (filter) {
      case "opened":
        base = leads.filter((l) => (l.viewCount ?? 0) > 0);
        break;
      case "played":
        base = leads.filter((l) => (l.playCount ?? 0) > 0);
        break;
      case "cta":
        base = leads.filter((l) => (l.ctaClickCount ?? 0) > 0);
        break;
      case "briefA":
        base = leads.filter((l) => l.abVariant === "A");
        break;
      case "briefB":
        base = leads.filter((l) => l.abVariant === "B");
        break;
      default:
        base = leads;
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((l) => {
      const haystack = [
        prettyName(l.data),
        prettyLastName(l.data),
        prettyEmail(l.data),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [leads, filter, search]);

  // Client-Pagination — hält die Tabelle auch bei tausenden Leads flüssig.
  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedLeads = React.useMemo(
    () =>
      filteredLeads.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredLeads, safePage],
  );

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

  // Lead-Namen für den freundlichen Event-Ticker (leadId → "Vorname Nachname").
  const leadNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) {
      const n = [prettyName(l.data), prettyLastName(l.data)]
        .filter((part) => part && part !== "—")
        .join(" ");
      if (n) m.set(l.id, n);
    }
    return m;
  }, [leads]);

  // Die 3 neuesten Events, neuestes zuerst — der "Erlebnis"-Ticker im Hero.
  const tickerEvents = React.useMemo(() => events.slice(-3).reverse(), [events]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-squircle-lg bg-surface shadow-card">
        {!isTerminal && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-24 -top-24 size-72 rounded-full bg-brand-soft opacity-70 blur-3xl animate-glow-drift" />
            <div className="absolute -bottom-32 -left-16 size-80 rounded-full bg-brand-100 opacity-60 blur-3xl animate-glow-drift [animation-delay:2s]" />
          </div>
        )}
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant={
                  runStatus === "completed" && counts.failed > 0
                    ? counts.completed === 0
                      ? "danger"
                      : "warn"
                    : runStatusVariant(runStatus)
                }
                dot
              >
                {runStatus === "completed" && counts.failed > 0
                  ? counts.completed === 0
                    ? "Fehlgeschlagen"
                    : "Fertig mit Fehlern"
                  : runStatusLabel(runStatus)}
              </Badge>
              <span className="text-xs text-ink-muted">
                {startedAtLabel ? `Gestartet ${startedAtLabel}` : null}
                {runDurationLabel
                  ? `${startedAtLabel ? " · " : ""}${isTerminal ? "Dauer" : "Läuft seit"} ${runDurationLabel}`
                  : null}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {runStatus === "paused" && (
                <Button
                  onClick={() => void resumeRun()}
                  disabled={resuming}
                  iconLeft={
                    resuming ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )
                  }
                >
                  {resuming ? "Wird fortgesetzt…" : "Fortsetzen"}
                </Button>
              )}
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

          {runStatus === "paused" && (
            <div className="mt-4 rounded-squircle bg-warn-soft p-4 text-sm text-ink">
              <p className="font-semibold">
                Lauf angehalten — zu viele personalisierte Begrüßungen
                fehlgeschlagen.
              </p>
              <p className="mt-1 text-ink-muted">
                Die Notbremse hat den Lauf pausiert, damit nicht massenhaft
                Videos ohne persönliche Begrüßung erzeugt werden. Prüfe das
                technische Log (z.&nbsp;B. Stimmprofil oder Webcam-Video) und
                setze den Lauf anschließend fort. Bereits fehlgeschlagene
                Begrüßungen nutzen den Fallback ohne Personalisierung.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <div className="flex items-center gap-5">
              {runStatus === "completed" && counts.failed === 0 ? (
                <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-ok-soft animate-pop">
                  <CheckCircle2 className="size-8 text-ok" />
                </span>
              ) : (
                <span className="text-5xl font-bold tabular-nums tracking-tight text-ink">
                  {pct}
                  <span className="text-2xl font-semibold text-ink-muted">%</span>
                </span>
              )}
              <div>
                <p className="text-sm font-semibold text-ink">
                  {runStatus === "completed" && counts.failed === 0
                    ? `Alle ${counts.completed} Leads fertig`
                    : `${counts.completed} von ${total || initialRun.totalLeads} Leads fertig`}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {isTerminal
                    ? counts.failed > 0
                      ? `${counts.failed} fehlgeschlagen — über „Neu generieren" erneut versuchen.`
                      : "Videos, Landingpages und Briefe sind bereit."
                    : etaLabel
                      ? `${etaLabel} — Deine persönlichen Videos und Briefe entstehen gerade.`
                      : "Deine persönlichen Videos und Briefe entstehen gerade."}
                </p>
                {runStatus === "completed" &&
                  counts.failed === 0 &&
                  hasEmailLeads && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        asChild
                        size="sm"
                        iconLeft={<Send className="size-4" />}
                      >
                        <Link href={`/kampagnen/${campaignId}/email/neu`}>
                          E-Mails versenden
                        </Link>
                      </Button>
                      <Link
                        href={`/kampagnen/${campaignId}?tab=email`}
                        className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      >
                        Zum E-Mail-Tab
                      </Link>
                    </div>
                  )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatPill tone="ok" label="Fertig" value={counts.completed} />
              <StatPill
                tone="brand"
                label="Rendert"
                value={counts.rendering + counts.uploading}
                pulse={!isTerminal && counts.rendering + counts.uploading > 0}
              />
              <StatPill tone="neutral" label="Wartet" value={counts.pending} />
              {counts.failed > 0 && (
                <StatPill tone="danger" label="Fehler" value={counts.failed} />
              )}
              {!isTerminal && workerStatsLabel && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-xs text-ink-muted"
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
          </div>

          <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-canvas-deep">
            <div
              className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-brand to-brand-deep transition-all duration-500 ease-spring"
              style={{ width: `${isTerminal ? pct : Math.max(pct, 2)}%` }}
            >
              {!isTerminal && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent"
                />
              )}
            </div>
          </div>

          {!isTerminal && (
            <div className="mt-5 space-y-1.5" aria-live="polite">
              {tickerEvents.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  Warte auf den ersten Worker — gleich geht&apos;s los.
                </p>
              ) : (
                tickerEvents.map((ev, i) => {
                  const leadName = ev.leadId
                    ? leadNameById.get(ev.leadId)
                    : null;
                  return (
                    <div
                      key={ev.id}
                      className={cn(
                        "flex items-center gap-2 text-xs",
                        i === 0 ? "text-ink animate-slide-up" : "text-ink-muted",
                        i === 2 && "opacity-60",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          ev.level === "error"
                            ? "bg-danger"
                            : ev.level === "warn"
                              ? "bg-warn"
                              : "bg-brand",
                        )}
                      />
                      {leadName && (
                        <span className="shrink-0 font-medium">{leadName}:</span>
                      )}
                      <span className="min-w-0 truncate">{ev.message}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted/70">
                        {formatClock(ev.ts)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-squircle-md bg-surface shadow-card">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
              Technisches Log
              <span className="ml-1 text-xs text-ink-muted">
                ({filteredEvents.length}
                {onlyErrors && events.length !== filteredEvents.length
                  ? ` von ${events.length}`
                  : ""}
                )
              </span>
            </button>
            {logOpen && (
              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
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
            )}
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
        </div>
      </section>

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
        <div className="relative ml-auto w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder E-Mail suchen…"
            aria-label="Leads nach Name oder E-Mail durchsuchen"
            className="pl-9 h-9"
          />
        </div>
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
              {emailColumnActive && <TableHead>E-Mail-Status</TableHead>}
              <TableHead>Landingpage</TableHead>
              <TableHead>PDF</TableHead>
              <TableHead>Umschlag</TableHead>
              <TableHead className="w-14 text-right">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLeads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8 + (abActive ? 1 : 0) + (emailColumnActive ? 1 : 0)}
                  className="text-center text-ink-muted py-8"
                >
                  {leads.length === 0
                    ? "Noch keine Leads."
                    : search.trim()
                      ? "Keine Leads passen zur Suche."
                      : "Keine Leads im aktiven Filter."}
                </TableCell>
              </TableRow>
            ) : (
              pagedLeads.map((l) => (
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
                  {emailColumnActive && (
                    <TableCell>
                      <EmailStatusCell status={emailStatusMap?.[l.id]} />
                    </TableCell>
                  )}
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
        {filteredLeads.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
            <span className="text-xs text-ink-muted tabular-nums">
              Zeige {safePage * PAGE_SIZE + 1}–
              {Math.min((safePage + 1) * PAGE_SIZE, filteredLeads.length)} von{" "}
              {filteredLeads.length.toLocaleString("de-DE")} Leads
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Zurück
              </Button>
              <span className="text-xs text-ink-muted tabular-nums">
                Seite {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Weiter
              </Button>
            </div>
          </div>
        )}
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

function StatPill({
  tone,
  label,
  value,
  pulse,
}: {
  tone: "ok" | "brand" | "neutral" | "danger";
  label: string;
  value: number;
  pulse?: boolean;
}): React.JSX.Element {
  const toneClass = {
    ok: "bg-ok-soft text-ok",
    brand: "bg-brand-soft text-brand-deep",
    neutral: "bg-surface-muted text-ink-muted",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums",
        toneClass,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse")}
      />
      {label} {value}
    </span>
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
