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
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toaster";
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

interface LeadRow {
  id: string;
  rowIndex: number;
  status: string;
  slug: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  data: Record<string, string>;
}

interface Counts {
  pending: number;
  rendering: number;
  uploading: number;
  completed: number;
  failed: number;
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
  const { toast } = useToast();

  const isTerminal =
    runStatus === "completed" ||
    runStatus === "failed" ||
    runStatus === "cancelled";

  const regenerate = React.useCallback(
    async (mode: "all" | "video" | "pdf") => {
      if (!isTerminal || regenerating) return;
      const confirmMessage =
        mode === "all"
          ? "Alle Videos und PDFs dieser Runde werden neu erzeugt. Bestehende Outputs werden überschrieben. Fortfahren?"
          : mode === "video"
            ? "Nur die Videos werden neu erzeugt — bestehende PDFs bleiben. Bestehende Outputs werden überschrieben. Fortfahren?"
            : "Nur die Briefe werden neu erzeugt — bestehende Videos bleiben. Bestehende Outputs werden überschrieben. Fortfahren?";
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
              : "Briefe werden neu generiert";
        toast({
          title: toastTitle,
          description: "Die Worker arbeiten die Leads jetzt erneut ab.",
        });
        // Run-Status springt zurueck auf 'generating' — SSE Stream kickt sich
        // beim naechsten Render-Pass von alleine neu an.
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
    [isTerminal, regenerating, runId, router, toast],
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
          setLeads(payload.leads as LeadRow[]);
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
                </DropdownMenuContent>
              </DropdownMenu>
              {pdfEnabled && (
                <BundleDialog runId={runId} runName={initialRun.name} />
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
              className="mt-3 max-h-72 overflow-y-auto rounded-squircle-sm border border-line bg-surface-muted font-mono text-xs"
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

      <div className="overflow-x-auto rounded-squircle-md border border-line bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Landingpage</TableHead>
              <TableHead>Video</TableHead>
              <TableHead>PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-ink-muted py-8">
                  Noch keine Leads.
                </TableCell>
              </TableRow>
            ) : (
              leads.map((l) => (
                <TableRow key={l.id}>
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
                  <TableCell>
                    {l.slug ? (
                      <a
                        href={`/v/${l.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-deep hover:underline text-xs"
                      >
                        <ExternalLink className="size-3.5" />
                        öffnen
                      </a>
                    ) : (
                      <span className="text-ink-muted text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
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
                  <TableCell>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Tree-shake guard for icons not always used above */}
      <span aria-hidden className="hidden">
        <FileText className="size-0" />
      </span>
    </div>
  );
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
  const updateMap = new Map(updates.map((u) => [u.id, u] as const));
  let changed = false;
  const next = prev.map((p) => {
    const u = updateMap.get(p.id);
    if (!u) return p;
    changed = true;
    return u;
  });
  return changed ? next : prev;
}
