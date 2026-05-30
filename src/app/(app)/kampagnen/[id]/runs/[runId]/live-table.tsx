"use client";

import * as React from "react";
import {
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

export interface LiveTableProps {
  runId: string;
  campaignId: string;
  pdfEnabled: boolean;
  initialRun: {
    id: string;
    name: string;
    status: string;
    totalLeads: number;
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
  const [counts, setCounts] = React.useState<Counts>({
    pending: initialCounts.pending ?? 0,
    rendering: initialCounts.rendering ?? 0,
    uploading: initialCounts.uploading ?? 0,
    completed: initialCounts.completed ?? 0,
    failed: initialCounts.failed ?? 0,
  });
  const [leads, setLeads] = React.useState<LeadRow[]>(initialLeads);
  const [regenerating, setRegenerating] = React.useState(false);
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
        if (payload.run) setRunStatus(payload.run.status);
        if (Array.isArray(payload.leads)) {
          setLeads(payload.leads as LeadRow[]);
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("tick", (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload.counts) setCounts(payload.counts as Counts);
        if (payload.runStatus) setRunStatus(payload.runStatus as string);
        if (Array.isArray(payload.recentEvents)) {
          setLeads((prev) => mergeLeads(prev, payload.recentEvents as LeadRow[]));
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

function mergeLeads(prev: LeadRow[], updates: LeadRow[]): LeadRow[] {
  if (updates.length === 0) return prev;
  const byId = new Map(prev.map((l) => [l.id, l] as const));
  for (const u of updates) {
    byId.set(u.id, { ...byId.get(u.id), ...u });
  }
  // Preserve original row-order from `prev` (so a tick doesn't reorder rows
  // every 2s); append any newly seen leads at the end.
  const ordered = prev.map((l) => byId.get(l.id) ?? l);
  for (const u of updates) {
    if (!prev.some((p) => p.id === u.id)) ordered.push(u);
  }
  return ordered.sort((a, b) => a.rowIndex - b.rowIndex);
}
