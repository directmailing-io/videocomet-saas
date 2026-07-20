"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Export-Dialog. Two formats:
 *  - "campaigns"  → CSV of campaign-aggregates in the current window.
 *  - "leads"     → re-uses `/api/activity/export` with the current scope and
 *                  range, so the export matches the dashboard the user sees.
 *
 * Exposed as a controlled component so the parent topbar can also wire the
 * `E` keyboard shortcut.
 */
export function ExportDialog({
  open,
  onOpenChange,
  campaignId,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  campaignId?: string;
}) {
  const sp = useSearchParams();
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const buildLeadsHref = () => {
    const params = new URLSearchParams();
    if (campaignId) {
      params.set("scope", "campaign");
      params.set("campaignId", campaignId);
    } else {
      params.set("scope", "global");
    }
    const range = sp.get("range") || "30d";
    const from = sp.get("from");
    const to = sp.get("to");
    const now = new Date();
    let fromIso: string | null = null;
    let toIso: string | null = null;
    if (range === "custom" && from && to) {
      fromIso = new Date(from).toISOString();
      toIso = new Date(to).toISOString();
    } else {
      const dayMs = 24 * 3600 * 1000;
      const map: Record<string, number> = {
        today: 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
      };
      const d = map[range] ?? 30;
      fromIso = new Date(now.getTime() - d * dayMs).toISOString();
      toIso = now.toISOString();
    }
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    return `/api/activity/export?${params.toString()}`;
  };

  const downloadCampaigns = async () => {
    setDownloading("campaigns");
    try {
      const res = await fetch("/api/analytics/campaigns");
      if (!res.ok) throw new Error("Fehler beim Laden");
      const { campaigns } = (await res.json()) as {
        campaigns: Array<{
          id: string;
          name: string;
          runsCount: number;
          leadsCount: number;
          viewCount: number;
          playCount: number;
          ctaClickCount: number;
          watchTimeSec: number;
        }>;
      };
      const header = [
        "Kampagne",
        "Runden",
        "Leads",
        "Aufrufe",
        "Plays",
        "CTA-Klicks",
        "Watch-Time (s)",
      ];
      const rows = campaigns.map((c) => [
        c.name,
        c.runsCount,
        c.leadsCount,
        c.viewCount,
        c.playCount,
        c.ctaClickCount,
        c.watchTimeSec,
      ]);
      const csv =
        [header, ...rows]
          .map((row) =>
            row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"),
          )
          .join("\r\n") + "\r\n";
      const blob = new Blob([`﻿${csv}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-kampagnen-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Daten exportieren</DialogTitle>
          <DialogDescription>
            Aktiver Zeitraum und Filter werden übernommen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={downloadCampaigns}
            className="flex items-start gap-3 rounded-squircle-md bg-surface-soft p-4 text-left hover:bg-surface-muted transition-colors"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
              <FileSpreadsheet className="size-4" />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-ink">
                Kampagnen-Aggregate (CSV)
              </span>
              <span className="text-xs text-ink-muted">
                Pro Kampagne: Runden, Leads, Aufrufe, Plays, CTA-Klicks und
                Watch-Time.
              </span>
              {downloading === "campaigns" && (
                <span className="text-[11px] text-brand-deep">
                  Wird heruntergeladen …
                </span>
              )}
            </span>
          </button>
          <a
            href={buildLeadsHref()}
            className="flex items-start gap-3 rounded-squircle-md bg-surface-soft p-4 hover:bg-surface-muted transition-colors"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
              <FileText className="size-4" />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-ink">
                Lead-Liste mit Aktivität (CSV)
              </span>
              <span className="text-xs text-ink-muted">
                Alle Leads im gewählten Zeitraum inkl. Temperatur, Watch-Time
                und letzter Aktion.
              </span>
            </span>
          </a>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Companion: small icon-button used in the topbar that also handles the
 * `E` keyboard shortcut.
 */
export function ExportButton({ campaignId }: { campaignId?: string }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<Download className="size-3.5" />}
        onClick={() => setOpen(true)}
        title="Exportieren (E)"
      >
        Export
      </Button>
      <ExportDialog open={open} onOpenChange={setOpen} campaignId={campaignId} />
    </>
  );
}
