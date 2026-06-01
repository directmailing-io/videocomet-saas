import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Eye,
  MousePointerClick,
  Play,
  Timer,
} from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaignDeepDive } from "@/lib/db/queries/analytics-summary";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeSeriesChart } from "../../_components/time-series-chart";
import { CampaignLeadExport } from "../../_components/campaign-lead-export";
import {
  fmtDate,
  fmtDateTime,
  fmtDurationVerbose,
  fmtInt,
  fmtPercent,
  runStatusLabel,
  runStatusVariant,
} from "../../_components/formatters";

export const dynamic = "force-dynamic";

export default async function CampaignAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let data;
  try {
    data = await getCampaignDeepDive(id, user.id);
  } catch {
    notFound();
  }

  const { campaign, summary, timeSeries, runs, topLeads } = data;

  // Avg watch-time per play. Guard against div-by-zero — 0 plays → "—".
  const avgWatchPerPlay =
    summary.playCount > 0
      ? Math.round(summary.watchTimeSec / summary.playCount)
      : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-brand-deep"
          >
            <ArrowLeft className="size-3.5" />
            Zurück zur Übersicht
          </Link>
        }
        title={campaign.name}
        subtitle={`Erstellt am ${fmtDate(campaign.createdAt)} · Analytics-Detailansicht`}
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          label="Σ Aufrufe"
          value={fmtInt(summary.viewCount)}
          icon={<Eye />}
        />
        <StatCard
          label="Σ Plays"
          value={fmtInt(summary.playCount)}
          icon={<Play />}
        />
        <StatCard
          label="Σ Watch-Time"
          value={fmtDurationVerbose(summary.watchTimeSec)}
          icon={<Clock />}
        />
        <StatCard
          label="Σ CTA-Klicks"
          value={fmtInt(summary.ctaClickCount)}
          icon={<MousePointerClick />}
        />
        <StatCard
          label="Ø Watch / Play"
          value={
            avgWatchPerPlay != null
              ? fmtDurationVerbose(avgWatchPerPlay)
              : "—"
          }
          icon={<Timer />}
        />
      </div>

      {/* Time-series */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Events über Zeit</CardTitle>
          <p className="text-sm text-ink-muted">
            Letzte 30 Tage · Aufrufe, Plays und CTA-Klicks.
          </p>
        </CardHeader>
        <CardContent>
          <TimeSeriesChart data={timeSeries} />
        </CardContent>
      </Card>

      {/* Lead-Export */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Leads exportieren</CardTitle>
          <p className="text-sm text-ink-muted">
            Liste aller Leads dieser Kampagne nach Aktivitaet gefiltert, als
            CSV oder Excel.
          </p>
        </CardHeader>
        <CardContent>
          <CampaignLeadExport campaignId={campaign.id} />
        </CardContent>
      </Card>

      {/* Runs table */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Runden</CardTitle>
          <p className="text-sm text-ink-muted">
            Eine Zeile pro Runde dieser Kampagne mit Performance-Werten.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {runs.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="Noch keine Runden"
                subtitle="Starten Sie eine Runde, um Daten zu sammeln."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runde</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Aufrufe</TableHead>
                  <TableHead className="text-right">Plays</TableHead>
                  <TableHead className="text-right">CTAs</TableHead>
                  <TableHead className="text-right">Aufrufe → Plays</TableHead>
                  <TableHead className="text-right">Plays → CTA</TableHead>
                  <TableHead aria-label="Aktionen" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium text-ink truncate max-w-[260px]">
                        {r.name}
                      </div>
                      <div className="text-xs text-ink-muted tabular-nums whitespace-nowrap">
                        {fmtDateTime(r.startedAt ?? r.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={runStatusVariant(r.status)} dot>
                        {runStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtInt(r.leadsCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtInt(r.viewCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtInt(r.playCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtInt(r.ctaClickCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-muted">
                      {fmtPercent(r.playCount, r.viewCount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-muted">
                      {fmtPercent(r.ctaClickCount, r.playCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/kampagnen/${campaign.id}/runs/${r.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-deep hover:underline whitespace-nowrap"
                      >
                        Öffnen
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top performers */}
      <Card>
        <CardHeader>
          <CardTitle>Top-Performer</CardTitle>
          <p className="text-sm text-ink-muted">
            Die 5 Leads mit der laengsten Watch-Time in dieser Kampagne.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {topLeads.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="Noch keine Watch-Time-Daten"
                subtitle="Sobald Empfaenger Videos abspielen, erscheinen hier die Top-Performer."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Firma</TableHead>
                  <TableHead className="text-right">Watch-Time</TableHead>
                  <TableHead className="text-right">Aufrufe</TableHead>
                  <TableHead className="text-right">CTA-Klicks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topLeads.map((l) => {
                  const name = [l.firstName, l.lastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        {name || "(unbenannt)"}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {l.companyName || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtDurationVerbose(l.watchTimeSec)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(l.viewCount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(l.ctaClickCount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
