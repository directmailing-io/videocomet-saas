"use client";

import * as React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

/**
 * Admin-Drilldown in eine Runde: Lead-Liste mit Status, Fehlern und
 * Artefakt-Links (Video, Landingpage, Brief, Umschlag) plus Buttons zum
 * Neu-Generieren (einzelner Lead oder ganze Runde). Support-Werkzeug:
 * "User meldet Bug bei Runde XYZ, Lead ABC" → direkt nachschauen.
 */

interface AdminLeadRow {
  id: string;
  rowIndex: number;
  name: string;
  slug: string | null;
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

const LEAD_STATUS_LABELS: Record<string, string> = {
  pending: "Wartet",
  rendering: "Rendert",
  uploading: "Lädt hoch",
  completed: "Fertig",
  failed: "Fehler",
};

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
    return <span className="text-ink-muted/50">{label}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-brand-deep hover:underline"
    >
      {label}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function RunLeadsPanel({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<LeadsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

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
    void load();
  }, [load]);

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
          kind === "run"
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

  if (error) {
    return (
      <div className="px-3 py-4 text-sm text-danger">
        {error}{" "}
        <button className="underline" onClick={() => void load()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-3 py-4 text-sm text-ink-muted">Lade Leads …</div>
    );
  }

  const failedCount = data.leads.filter(
    (l) => l.status === "failed" && !l.removedAt,
  ).length;
  const runBusy = busy === runId;
  const runRunning = data.run.status === "generating";

  return (
    <div className="rounded-xl bg-surface-soft/60 border border-line/60 p-3 my-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-xs text-ink-muted">
          {data.leads.length} Leads
          {failedCount > 0 ? (
            <span className="text-danger"> · {failedCount} fehlgeschlagen</span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          {failedCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={runBusy || runRunning}
              onClick={() =>
                void regenerate(
                  "run",
                  runId,
                  { mode: "failed" },
                  `${failedCount} fehlgeschlagene Leads dieser Runde neu generieren?`,
                )
              }
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Fehlgeschlagene neu
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={runBusy || runRunning}
            onClick={() =>
              void regenerate(
                "run",
                runId,
                { mode: "all" },
                "WIRKLICH die GANZE Runde neu generieren? Alle Videos, Landingpages und Briefe werden neu erstellt.",
              )
            }
          >
            <RefreshCw className="size-3.5 mr-1.5" />
            Ganze Runde neu
          </Button>
        </div>
      </div>

      {runRunning ? (
        <p className="text-xs text-ink-muted mb-2">
          Runde läuft gerade — Neu-Generieren ist erst nach Abschluss möglich.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-muted border-b border-line">
              <th className="py-1.5 pr-3 font-semibold">#</th>
              <th className="py-1.5 pr-3 font-semibold">Lead</th>
              <th className="py-1.5 pr-3 font-semibold">Status</th>
              <th className="py-1.5 pr-3 font-semibold">Artefakte</th>
              <th className="py-1.5 pr-3 font-semibold">Fehler</th>
              <th className="py-1.5 font-semibold">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((l) => {
              const removed = Boolean(l.removedAt);
              const errText =
                l.errorMessage ??
                l.preflightErrorMessage ??
                (removed ? `Entfernt (${l.removedReason ?? "manuell"})` : null);
              return (
                <tr
                  key={l.id}
                  className={`border-b border-line/50 last:border-0 align-top ${
                    removed ? "opacity-50" : ""
                  }`}
                >
                  <td className="py-2 pr-3 text-ink-muted tabular-nums">
                    {l.rowIndex + 1}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-ink">{l.name}</span>
                    <span className="block text-[10px] text-ink-muted font-mono">
                      {l.id}
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Badge variant={leadStatusVariant(l.status)} dot>
                      {LEAD_STATUS_LABELS[l.status] ?? l.status}
                    </Badge>
                    {l.currentStage &&
                    l.status !== "completed" &&
                    l.status !== "failed" ? (
                      <span className="block text-[10px] text-ink-muted mt-0.5">
                        Stage: {l.currentStage}
                      </span>
                    ) : null}
                    {l.attempts > 1 ? (
                      <span className="block text-[10px] text-ink-muted">
                        {l.attempts} Versuche
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <ArtifactLink
                        href={l.videoMp4Url ?? l.videoUrl}
                        label="Video"
                      />
                      <ArtifactLink
                        href={l.slug ? `/v/${l.slug}` : null}
                        label="Landingpage"
                      />
                      <ArtifactLink href={l.pdfUrl} label="Brief-PDF" />
                      <ArtifactLink
                        href={l.envelopePdfUrl}
                        label="Umschlag"
                      />
                    </div>
                  </td>
                  <td className="py-2 pr-3 max-w-[260px]">
                    {errText ? (
                      <span className="text-danger break-words">{errText}</span>
                    ) : (
                      <span className="text-ink-muted/50">—</span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === l.id || runBusy || runRunning || removed}
                      onClick={() =>
                        void regenerate(
                          "lead",
                          l.id,
                          { scope: "all" },
                          `Lead "${l.name}" komplett neu generieren (Video + Landingpage + Brief)?`,
                        )
                      }
                    >
                      <RefreshCw className="size-3.5 mr-1.5" />
                      Neu
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
