import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, MousePointerClick, PlayCircle, Timer } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { getRunAnalytics } from "@/lib/db/queries/analytics";
import {
  getCtaBreakdown,
  getProgressDistribution,
  getTimeOfDayHistogram,
} from "@/lib/analytics-aggregate";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartsRow } from "./charts-row";
import { Heatmap } from "./heatmap";
import { LeadsTable } from "./leads-table";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return (n * 100).toFixed(1).replace(/\.0$/, "");
}

export default async function RunAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const { user } = await requireUser();

  let campaign;
  let run;
  try {
    campaign = await getCampaign(id, user.id);
    run = await getRun(runId, user.id);
  } catch {
    notFound();
  }

  // Defensive: ensure the run belongs to this campaign.
  if (run.campaignId !== campaign.id) notFound();

  const [analytics, progressDistribution, ctaBreakdown, timeOfDay] =
    await Promise.all([
      getRunAnalytics(runId, user.id),
      getProgressDistribution(runId, user.id),
      getCtaBreakdown(runId, user.id),
      getTimeOfDayHistogram(runId, user.id),
    ]);

  // CTA-rate: distinct cta clicks per total leads, clamped to 100%.
  const ctaRate =
    analytics.totalLeads > 0
      ? Math.min(1, analytics.ctaClicks / analytics.totalLeads)
      : 0;

  // Average watch-tiefe: completedRate is already 0..100 avg progress across
  // video_progress events. Show as % of started videos for intuitive framing.
  const watchDepth = analytics.completedRate; // 0..100

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/kampagnen/${campaign.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Zurück zu {campaign.name}
          </Link>
        }
        title={`Analytics: ${run.name}`}
        subtitle={`Auswertung der Runde mit ${analytics.totalLeads} Leads.`}
        actions={
          <Button asChild variant="ghost">
            <Link href={`/kampagnen/${campaign.id}`}>Zur Runden-Übersicht</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Öffnungsrate"
          value={pct(analytics.openRate)}
          unit="%"
          icon={<Eye />}
        />
        <StatCard
          label="Video-Abspielrate"
          value={pct(analytics.videoStartRate)}
          unit="%"
          icon={<PlayCircle />}
        />
        <StatCard
          label="Durchschn. Watch-Tiefe"
          value={Math.round(watchDepth)}
          unit="%"
          icon={<Timer />}
        />
        <StatCard
          label="CTA-Klick-Rate"
          value={pct(ctaRate)}
          unit="%"
          icon={<MousePointerClick />}
        />
      </div>

      <ChartsRow
        opened={analytics.opened}
        notOpened={Math.max(0, analytics.totalLeads - analytics.opened)}
        progressDistribution={progressDistribution}
        ctaBreakdown={ctaBreakdown.slice(0, 5)}
      />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Aktivitaet nach Tageszeit</CardTitle>
        </CardHeader>
        <CardContent>
          <Heatmap buckets={timeOfDay} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Leads</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadsTable runId={runId} />
        </CardContent>
      </Card>
    </>
  );
}
