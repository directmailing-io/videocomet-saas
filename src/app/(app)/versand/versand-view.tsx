"use client";

/**
 * Versandzentrale — Tabs „Briefe" + „E-Mails".
 *
 * Briefe: alle Runden mit fertigen PDFs als Karten mit Versand-Fortschritt.
 * Klick auf eine Karte → Detailansicht mit Lead-Tabelle (Auswahl, Export,
 * Versendet-Markierung). E-Mails: bestehende Blast-Übersicht.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Mail,
  Mailbox,
  Undo2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  EmailBlastsPanel,
  type EmailVersandBlastRow,
  type EmailVersandCampaignOption,
} from "./email-blasts-panel";

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
  planned: number;
  earliestPlannedAt: string | null;
  returned: number;
  lastSentAt: string | null;
  emailTotal: number;
  emailSent: number;
  emailScheduled: number;
  emailReplied: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function ChannelProgress({
  icon,
  label,
  sent,
  total,
  barClass,
  info,
}: {
  icon: React.ReactNode;
  label: string;
  sent: number;
  total: number;
  barClass: string;
  info?: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          {icon}
          {label}
        </span>
        <span className="tabular-nums text-xs text-ink-muted">
          {sent} von {total} versendet
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {info && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {info}
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: VersandRunItem }) {
  return (
    <Link
      href={`/versand/${run.runId}`}
      className="group block rounded-squircle-lg bg-surface p-5 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted line-clamp-1">
            {run.campaignName}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-ink line-clamp-1">
            {run.runName}
          </h3>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink" />
      </div>

      <div className="mt-4 space-y-4">
        {run.withPdf > 0 && (
          <ChannelProgress
            icon={<Mailbox className="size-3.5 text-ink-muted" />}
            label="Per Post"
            sent={run.letterSent}
            total={run.withPdf}
            barClass="bg-emerald-500"
            info={
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-ink-muted/50" />
                  {run.letterOpen} offen
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {run.letterInProgress} in Bearbeitung
                </span>
                {run.letterSent > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-brand">
                    {run.reacted} Reaktion{run.reacted === 1 ? "" : "en"}
                  </span>
                )}
              </>
            }
          />
        )}

        {run.emailTotal > 0 ? (
          <ChannelProgress
            icon={<Mail className="size-3.5 text-ink-muted" />}
            label="Per E-Mail"
            sent={run.emailSent}
            total={run.emailTotal}
            barClass="bg-brand"
            info={
              <>
                {run.emailScheduled > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    {run.emailScheduled} in Warteschlange
                  </span>
                )}
                {run.emailReplied > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-brand">
                    {run.emailReplied} Antwort{run.emailReplied === 1 ? "" : "en"}
                  </span>
                )}
              </>
            }
          />
        ) : (
          <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <Mail className="size-3.5" />
            Per E-Mail — noch nichts versendet
          </p>
        )}
      </div>

      {(run.stuckInProgress > 0 || run.planned > 0 || run.returned > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {run.stuckInProgress > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="size-3" />
              {run.stuckInProgress} seit über 7 Tagen in Bearbeitung — schon
              versendet?
            </span>
          )}
          {run.planned > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              <CalendarClock className="size-3" />
              {run.planned} geplant
              {run.earliestPlannedAt
                ? ` · ab ${formatDate(run.earliestPlannedAt)}`
                : ""}
            </span>
          )}
          {run.returned > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">
              <Undo2 className="size-3" />
              {run.returned} Rückläufer
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

export function VersandView({
  initialTab,
  runs,
  blasts,
  campaigns,
}: {
  initialTab: "briefe" | "emails";
  runs: VersandRunItem[];
  blasts: EmailVersandBlastRow[];
  campaigns: EmailVersandCampaignOption[];
}) {
  const [tab, setTab] = React.useState<string>(initialTab);

  function handleTabChange(next: string) {
    setTab(next);
    // URL synchron halten (Bookmark/Reload), ohne Server-Roundtrip.
    const url = next === "emails" ? "/versand?tab=emails" : "/versand";
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      <PageHeader
        title="Versand"
        subtitle="Briefe exportieren, als versendet markieren und E-Mails steuern — alles an einem Ort"
      />

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="briefe">Briefe</TabsTrigger>
          <TabsTrigger value="emails">E-Mails</TabsTrigger>
        </TabsList>

        <TabsContent value="briefe">
          {runs.length === 0 ? (
            <div className="bg-surface rounded-squircle-lg shadow-card">
              <EmptyState
                icon={<Mailbox />}
                title="Noch keine versandfertigen Briefe"
                subtitle="Sobald eine Runde fertig generiert ist, steuerst du hier den kompletten Brief-Versand: exportieren, als versendet markieren, nachverfolgen."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {runs.map((r) => (
                <RunCard key={r.runId} run={r} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="emails">
          <EmailBlastsPanel blasts={blasts} campaigns={campaigns} />
        </TabsContent>
      </Tabs>
    </>
  );
}
