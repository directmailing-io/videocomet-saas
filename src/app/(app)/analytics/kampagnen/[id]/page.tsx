import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Eye,
  Flame,
  MousePointerClick,
  Radio,
} from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaignDeepDive } from "@/lib/db/queries/analytics-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getFunnelData,
  getHeroStats,
  getTimeSeries,
  getTopLeads,
  listRunsForCampaign,
  resolveRange,
} from "../../_components/analytics-data";
import { RangePicker } from "../../_components/range-picker";
import { ExportButton } from "../../_components/export-dialog";
import { ShortcutsHelp } from "../../_components/shortcuts-help";
import { HeroStat } from "../../_components/hero-stat";
import { FunnelOverview } from "../../_components/funnel-overview";
import { ActivityTimeSeries } from "../../_components/activity-timeseries";
import { TopLeadsList } from "../../_components/top-leads-list";
import {
  fmtDateTime,
  fmtDurationVerbose,
  fmtInt,
  fmtPercent,
  runStatusLabel,
  runStatusVariant,
} from "../../_components/formatters";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Campaign-Detail. Same dashboard chrome as the overview, scoped to one
 * campaign. The runs table + lead-list live at the bottom to keep the top
 * focused on "how is this campaign doing right now".
 */
export default async function CampaignAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { user } = await requireUser();

  let deepDive;
  try {
    deepDive = await getCampaignDeepDive(id, user.id);
  } catch {
    notFound();
  }
  const { campaign } = deepDive;

  const range = resolveRange({
    key: pickStr(sp, "range"),
    from: pickStr(sp, "from"),
    to: pickStr(sp, "to"),
    bucket: pickStr(sp, "bucket"),
  });
  const compare = pickStr(sp, "compare") !== "0";

  const [hero, funnel, timeseries, topLeads, runRows] = await Promise.all([
    getHeroStats(user.id, range, campaign.id),
    getFunnelData(user.id, range, campaign.id),
    getTimeSeries(user.id, range, campaign.id),
    getTopLeads(user.id, range, campaign.id, 10),
    listRunsForCampaign(user.id, campaign.id, range),
  ]);

  const sparkValues = timeseries.map(
    (b) => b.pageViews + b.videoPlays + b.ctaClicks,
  );
  const sparkPV = timeseries.map((b) => b.pageViews);
  const sparkCTA = timeseries.map((b) => b.ctaClicks);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-4 mb-4 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <Link
              href="/analytics"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted hover:text-brand-deep w-fit"
            >
              <ArrowLeft className="size-3" />
              Zurück zur Übersicht
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-ink leading-tight truncate">
              {campaign.name}
            </h1>
            <p className="text-xs text-ink-muted leading-relaxed">
              Kampagnen-Detail · {range.label}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              size="sm"
              iconLeft={<Radio className="size-3.5" />}
            >
              <Link
                href={`/aktivitaet?scope=campaign&campaignId=${campaign.id}`}
                title="Echtzeit-Aktivität dieser Kampagne öffnen"
              >
                Aktivität ansehen
              </Link>
            </Button>
            <RangePicker />
            <ExportButton campaignId={campaign.id} />
            <ShortcutsHelp />
          </div>
        </div>
      </div>

      <section
        aria-label="Kennzahlen"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"
      >
        <HeroStat
          label="Page-Views"
          value={fmtInt(hero.pageViews)}
          prevValue={hero.prev.pageViews}
          curValue={hero.pageViews}
          spark={sparkPV}
          showDelta={compare}
          icon={<Eye />}
          hint={`Vorperiode: ${fmtInt(hero.prev.pageViews)}`}
        />
        <HeroStat
          label="Video-Watch-Time"
          value={fmtDurationVerbose(hero.watchTimeSec)}
          prevValue={hero.prev.watchTimeSec}
          curValue={hero.watchTimeSec}
          spark={sparkValues}
          showDelta={compare}
          icon={<Clock />}
          hint={`Vorperiode: ${fmtDurationVerbose(hero.prev.watchTimeSec)}`}
        />
        <HeroStat
          label="CTA-Rate"
          value={`${hero.ctaRatePct.toFixed(1).replace(".", ",")}`}
          unit="%"
          prevValue={hero.prev.ctaRatePct}
          curValue={hero.ctaRatePct}
          spark={sparkCTA}
          showDelta={compare}
          icon={<MousePointerClick />}
          hint={`Vorperiode: ${hero.prev.ctaRatePct.toFixed(1).replace(".", ",")} %`}
        />
        <HeroStat
          label="Heiße Leads"
          value={fmtInt(hero.hotLeads)}
          prevValue={hero.prev.hotLeads}
          curValue={hero.hotLeads}
          spark={sparkValues}
          showDelta={compare}
          icon={<Flame />}
          hint={`Vorperiode: ${fmtInt(hero.prev.hotLeads)}`}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 bg-surface rounded-squircle-md shadow-card flex flex-col">
          <SectionHeader
            title="Aktivität über Zeit"
            subtitle={`Page-Views, Video-Plays und CTA-Klicks im Verlauf. Bucket: ${range.bucket === "hour" ? "stündlich" : "täglich"}.`}
          />
          <ActivityTimeSeries
            data={timeseries}
            defaultBucket={range.bucket}
            showBucketToggle={range.key !== "today"}
          />
        </div>
        <div className="lg:col-span-2 bg-surface rounded-squircle-md shadow-card flex flex-col">
          <SectionHeader
            title="Funnel"
            subtitle="Wo verlieren Sie Empfänger zwischen den Stufen?"
          />
          <FunnelOverview data={funnel} />
        </div>
      </section>

      <section
        aria-label="Top-Leads"
        className="bg-surface rounded-squircle-md shadow-card mb-6"
      >
        <SectionHeader
          title="Top-Leads dieser Kampagne"
          subtitle="Klick öffnet die Lead-Detail-Ansicht im Aktivitäts-Center."
        />
        <TopLeadsList leads={topLeads} />
      </section>

      <section
        aria-label="Runden"
        className="bg-surface rounded-squircle-md shadow-card mb-10"
      >
        <SectionHeader
          title="Runden"
          subtitle="Eine Zeile pro Runde dieser Kampagne mit Performance im Zeitraum."
        />
        {runRows.length === 0 ? (
          <div className="px-6 pb-6 pt-2">
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
                <TableHead className="text-right">CTA-Klicks</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead aria-label="Aktionen" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runRows.map((r) => (
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
                    {fmtInt(r.pageViews)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInt(r.videoPlays)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInt(r.ctaClicks)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-muted">
                    {fmtPercent(r.ctaClicks, r.pageViews)}
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
      </section>
    </>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="px-5 pt-5 pb-3 border-b border-line-soft">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      {subtitle && (
        <p className="text-xs text-ink-muted leading-relaxed mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}
