"use client";

/**
 * Versandzentrale — EINE Runden-Tabelle: pro Runde Brief- und E-Mail-
 * Fortschritt. Klick auf eine Zeile → Detailansicht mit Lead-Tabelle
 * (Auswahl, PDF-Export, E-Mail-Versand).
 * Einziger weiterer Einstieg: „E-Mail-Versand starten" im Kopf.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  Mailbox,
  Send,
  Undo2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  StartBlastDialog,
  type EmailVersandCampaignOption,
} from "./start-blast-dialog";

export interface VersandRunItem {
  runId: string;
  runName: string;
  campaignId: string;
  campaignName: string;
  createdAt: string;
  completedTotal: number;
  withPdf: number;
  letterOpen: number;
  letterInProgress: number;
  letterSent: number;
  reacted: number;
  stuckInProgress: number;
  returned: number;
  lastSentAt: string | null;
  emailTotal: number;
  emailSent: number;
  emailScheduled: number;
  emailReplied: number;
}

function ProgressCell({
  sent,
  total,
  barClass,
  extra,
}: {
  sent: number;
  total: number;
  barClass: string;
  extra?: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  return (
    <div className="min-w-36">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums font-medium text-ink">
          {sent} von {total}
        </span>
        <span className="tabular-nums text-ink-muted">{pct} %</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {extra && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
          {extra}
        </div>
      )}
    </div>
  );
}

export function VersandView({
  runs,
  campaigns,
}: {
  runs: VersandRunItem[];
  campaigns: EmailVersandCampaignOption[];
}) {
  const router = useRouter();
  const [startDialogOpen, setStartDialogOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Versand"
        subtitle="Briefe und E-Mails pro Runde verschicken und nachverfolgen — alles an einem Ort"
        actions={
          <Button
            iconLeft={<Send className="size-4" />}
            onClick={() => setStartDialogOpen(true)}
          >
            E-Mail-Versand starten
          </Button>
        }
      />

      {runs.length === 0 ? (
        <div className="bg-surface rounded-squircle-lg shadow-card">
          <EmptyState
            icon={<Mailbox />}
            title="Noch nichts zu versenden"
            subtitle="Sobald eine Runde fertig generiert ist, steuerst du hier den kompletten Versand: Briefe exportieren, E-Mails verschicken, alles nachverfolgen."
          />
        </div>
      ) : (
        <div className="bg-surface rounded-squircle-lg shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-6 py-2.5 font-semibold">Runde</th>
                <th className="px-4 py-2.5 font-semibold">Briefe per Post</th>
                <th className="px-4 py-2.5 font-semibold">E-Mails</th>
                <th className="px-6 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                return (
                  <tr
                    key={r.runId}
                    onClick={() => router.push(`/versand/${r.runId}`)}
                    className="cursor-pointer border-b border-line-soft last:border-0 transition-colors hover:bg-surface-soft"
                  >
                    <td className="px-6 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted line-clamp-1">
                        {r.campaignName}
                      </p>
                      <p className="font-medium text-ink line-clamp-1">
                        {r.runName}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      {r.withPdf > 0 ? (
                        <ProgressCell
                          sent={r.letterSent}
                          total={r.withPdf}
                          barClass="bg-emerald-500"
                          extra={
                            <>
                              {r.stuckInProgress > 0 && (
                                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                  <AlertTriangle className="size-3" />
                                  {r.stuckInProgress} schon versendet?
                                </span>
                              )}
                              {r.returned > 0 && (
                                <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                  <Undo2 className="size-3" />
                                  {r.returned} Rückläufer
                                </span>
                              )}
                            </>
                          }
                        />
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {r.emailTotal > 0 ? (
                        <ProgressCell
                          sent={r.emailSent}
                          total={r.emailTotal}
                          barClass="bg-brand"
                          extra={
                            r.emailScheduled > 0 ? (
                              <span>{r.emailScheduled} in Warteschlange</span>
                            ) : undefined
                          }
                        />
                      ) : (
                        <span className="text-xs text-ink-muted">
                          Noch keine versendet
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <ChevronRight className="inline size-4 text-ink-muted" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <StartBlastDialog
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        campaigns={campaigns}
      />
    </>
  );
}
