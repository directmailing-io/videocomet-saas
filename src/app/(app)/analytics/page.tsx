import Link from "next/link";
import { Eye, Play, Clock, MousePointerClick, Megaphone, Plus, ArrowRight } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listCampaignAggregates } from "@/lib/db/queries/analytics-summary";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignBarChart, type CampaignBarItem } from "./_components/campaign-bar-chart";
import { Sparkline } from "./_components/sparkline";
import {
  fmtDate,
  fmtDurationVerbose,
  fmtInt,
  fmtPercent,
} from "./_components/formatters";

export const dynamic = "force-dynamic";

export default async function AnalyticsOverviewPage() {
  const { user } = await requireUser();
  const items = await listCampaignAggregates(user.id);

  if (items.length === 0) {
    return (
      <>
        <PageHeader
          title="Analytics"
          subtitle="Vergleichen Sie Kampagnen-Performance und sehen Sie, wie Ihre personalisierten Videos wirken."
        />
        <EmptyState
          icon={<Megaphone />}
          title="Noch keine Kampagnen"
          subtitle="Erstellen Sie Ihre erste Kampagne, um Analytics zu sehen."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/kampagnen/neu">Erste Kampagne erstellen</Link>
            </Button>
          }
        />
      </>
    );
  }

  // Totals across all campaigns.
  const totals = items.reduce(
    (acc, c) => {
      acc.views += c.viewCount;
      acc.plays += c.playCount;
      acc.ctas += c.ctaClickCount;
      acc.watch += c.watchTimeSec;
      return acc;
    },
    { views: 0, plays: 0, ctas: 0, watch: 0 },
  );

  // Bar-chart series: top 12 campaigns by total events to keep the chart
  // readable on small screens. Sort by views+plays+ctas combined.
  const barItems: CampaignBarItem[] = [...items]
    .sort(
      (a, b) =>
        b.viewCount +
        b.playCount +
        b.ctaClickCount -
        (a.viewCount + a.playCount + a.ctaClickCount),
    )
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      name: c.name,
      views: c.viewCount,
      plays: c.playCount,
      ctas: c.ctaClickCount,
      runs: c.runsCount,
    }));

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Vergleichen Sie Kampagnen-Performance und sehen Sie, wie Ihre personalisierten Videos wirken."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/analytics/events">Event-Log oeffnen</Link>
          </Button>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Σ Aufrufe"
          value={fmtInt(totals.views)}
          icon={<Eye />}
        />
        <StatCard
          label="Σ Plays"
          value={fmtInt(totals.plays)}
          icon={<Play />}
        />
        <StatCard
          label="Σ Watch-Time"
          value={fmtDurationVerbose(totals.watch)}
          icon={<Clock />}
        />
        <StatCard
          label="Σ CTA-Klicks"
          value={fmtInt(totals.ctas)}
          icon={<MousePointerClick />}
        />
      </div>

      {/* Comparison chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Kampagnen-Vergleich</CardTitle>
          <p className="text-sm text-ink-muted">
            Aufrufe, Plays, CTA-Klicks und Runden je Kampagne.
          </p>
        </CardHeader>
        <CardContent>
          <CampaignBarChart items={barItems} />
        </CardContent>
      </Card>

      {/* Campaign list */}
      <Card>
        <CardHeader>
          <CardTitle>Kampagnen-Details</CardTitle>
          <p className="text-sm text-ink-muted">
            Trend der letzten 14 Tage und Conversion-Raten je Kampagne.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <ul className="divide-y divide-line-soft">
            {items.map((c) => {
              const sparkValues = c.dailyCounts.map(
                (d) => d.views + d.plays + d.ctas,
              );
              return (
                <li key={c.id} className="px-6 py-4">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
                    {/* Name + meta */}
                    <div className="lg:w-56 min-w-0">
                      <Link
                        href={`/analytics/kampagnen/${c.id}`}
                        className="block text-sm font-semibold text-ink hover:text-brand-deep truncate"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Erstellt am {fmtDate(c.createdAt)}
                      </p>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 flex-1 min-w-0">
                      <MetricCell label="Leads" value={fmtInt(c.leadsCount)} />
                      <MetricCell label="Aufrufe" value={fmtInt(c.viewCount)} />
                      <MetricCell label="Plays" value={fmtInt(c.playCount)} />
                      <MetricCell
                        label="Watch-Time"
                        value={fmtDurationVerbose(c.watchTimeSec)}
                      />
                      <MetricCell label="CTAs" value={fmtInt(c.ctaClickCount)} />
                    </div>

                    {/* Conversion */}
                    <div className="flex flex-col gap-0.5 lg:w-40 text-xs">
                      <div className="flex justify-between gap-3 text-ink-muted">
                        <span>Aufrufe → Plays</span>
                        <span className="text-ink font-semibold tabular-nums">
                          {fmtPercent(c.playCount, c.viewCount)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 text-ink-muted">
                        <span>Plays → CTA</span>
                        <span className="text-ink font-semibold tabular-nums">
                          {fmtPercent(c.ctaClickCount, c.playCount)}
                        </span>
                      </div>
                    </div>

                    {/* Sparkline + link */}
                    <div className="flex items-center gap-4 lg:w-44 lg:justify-end">
                      <Sparkline
                        values={sparkValues}
                        label={`Trend ${c.name} (14 Tage)`}
                      />
                      <Link
                        href={`/analytics/kampagnen/${c.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-deep hover:underline whitespace-nowrap"
                      >
                        Details
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="text-sm text-ink font-semibold tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}
