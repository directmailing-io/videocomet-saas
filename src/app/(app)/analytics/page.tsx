import Link from "next/link";
import {
  Eye,
  Play,
  Clock,
  Flame,
  MousePointerClick,
  Megaphone,
  Plus,
} from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listCampaignAggregates } from "@/lib/db/queries/analytics-summary";
import {
  getFunnelData,
  getHeroStats,
  getTimeSeries,
  getTopLeads,
  listCampaignPerformance,
  resolveRange,
} from "./_components/analytics-data";
import { RangePicker } from "./_components/range-picker";
import { ExportButton } from "./_components/export-dialog";
import { ShortcutsHelp } from "./_components/shortcuts-help";
import { AnalyticsSectionNav } from "../_components/analytics-section-nav";
import { HeroStat } from "./_components/hero-stat";
import { CampaignPerformanceList } from "./_components/campaign-performance-list";
import { FunnelOverview } from "./_components/funnel-overview";
import { ActivityTimeSeries } from "./_components/activity-timeseries";
import { TopLeadsList } from "./_components/top-leads-list";
import {
  fmtDurationVerbose,
  fmtInt,
  fmtPercent,
} from "./_components/formatters";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Analytics-Dashboard.
 *
 * Goal: in 5 seconds the operator sees how campaigns perform, which leads
 * are hot, where the funnel leaks and when to follow up — all without a
 * single tutorial. Strategic view; the real-time feed lives under
 * `/aktivitaet`.
 *
 * Layout:
 *   1. Sticky topbar  (range-picker + export)
 *   2. 4 Hero-Stats   (Page-Views · Watch-Time · CTA-Rate · Hot Leads + Δ)
 *   3. Two columns    (Kampagnen-Performance · Funnel + Drop-Off-Insight)
 *   4. Time-Series    (Tag/Stunde-Toggle, 3 Serien)
 *   5. Top-Leads      (Heat-List → click jumps into /aktivitaet drawer)
 */
export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { user } = await requireUser();

  const range = resolveRange({
    key: pickStr(sp, "range"),
    from: pickStr(sp, "from"),
    to: pickStr(sp, "to"),
    bucket: pickStr(sp, "bucket"),
  });
  const compare = pickStr(sp, "compare") !== "0";

  const items = await listCampaignAggregates(user.id);

  if (items.length === 0) {
    return (
      <>
        <Topbar />
        <EmptyState
          icon={<Megaphone />}
          title="Noch keine Kampagnen"
          subtitle="Erstellen Sie Ihre erste Kampagne, um Performance-Daten zu sehen."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/kampagnen/neu">Erste Kampagne erstellen</Link>
            </Button>
          }
        />
      </>
    );
  }

  const [hero, performance, funnel, timeseries, topLeads] = await Promise.all([
    getHeroStats(user.id, range),
    listCampaignPerformance(user.id, range),
    getFunnelData(user.id, range),
    getTimeSeries(user.id, range),
    getTopLeads(user.id, range, null, 10),
  ]);

  const sparkValues = timeseries.map(
    (b) => b.pageViews + b.videoPlays + b.ctaClicks,
  );
  const sparkPV = timeseries.map((b) => b.pageViews);
  const sparkCTA = timeseries.map((b) => b.ctaClicks);

  // CTA-Rate as Pp delta — % minus % = absolute pp.
  const ctaRateDeltaHint = compare
    ? `Vorperiode: ${hero.prev.ctaRatePct.toFixed(1).replace(".", ",")} %`
    : `Im Zeitraum: ${range.label}`;

  return (
    <>
      <Topbar />

      <div className="mb-4 flex items-center justify-between gap-3 text-xs text-ink-muted">
        <span className="tabular-nums">
          Zeitraum: <span className="font-semibold text-ink">{range.label}</span>
          {compare && (
            <>
              {" "}
              · Vergleich aktiv
            </>
          )}
        </span>
        <span>Drücken Sie <kbd className="px-1 py-0.5 rounded-sm border border-line text-[10px] font-semibold">?</kbd> für Shortcuts</span>
      </div>

      {/* Hero stats */}
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
          hint={ctaRateDeltaHint}
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

      {/* Two-column: campaign performance + funnel */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 bg-surface rounded-squircle-md shadow-card">
          <SectionHeader
            title="Kampagnen-Performance"
            subtitle="Sortiert nach CTR im gewählten Zeitraum. Klick öffnet das Detail."
          />
          <CampaignPerformanceList items={performance} />
        </div>
        <div className="lg:col-span-2 bg-surface rounded-squircle-md shadow-card flex flex-col">
          <SectionHeader
            title="Global-Funnel"
            subtitle="Aggregiert über alle Kampagnen. Hervorhebung: größte Drop-Off-Stelle."
          />
          <FunnelOverview data={funnel} />
        </div>
      </section>

      {/* Time-series */}
      <section
        aria-label="Aktivität über Zeit"
        className="bg-surface rounded-squircle-md shadow-card mb-6"
      >
        <SectionHeader
          title="Aktivität über Zeit"
          subtitle={`Page-Views, Video-Plays und CTA-Klicks im Verlauf. Bucket: ${range.bucket === "hour" ? "stündlich" : "täglich"}.`}
        />
        <ActivityTimeSeries
          data={timeseries}
          defaultBucket={range.bucket}
          showBucketToggle={range.key !== "today"}
        />
      </section>

      {/* Top-Leads */}
      <section
        aria-label="Aktivste Leads"
        className="bg-surface rounded-squircle-md shadow-card mb-10"
      >
        <SectionHeader
          title="Top-Leads im Zeitraum"
          subtitle="Klick öffnet die Lead-Detail-Ansicht im Aktivitäts-Center."
          right={
            topLeads.length > 0 && (
              <span className="text-xs text-ink-muted tabular-nums">
                Σ {fmtInt(topLeads.reduce((acc, l) => acc + l.pageViews + l.videoPlays + l.ctaClicks, 0))} Aktionen
              </span>
            )
          }
        />
        <TopLeadsList leads={topLeads} />
      </section>

      {/* Quiet footer summary so the totals are still discoverable. */}
      <p className="text-xs text-ink-muted text-center mb-2">
        {items.length} Kampagne{items.length === 1 ? "" : "n"} ·{" "}
        {fmtInt(hero.videoPlays)} Plays · {fmtInt(hero.ctaClicks)} CTA-Klicks ·{" "}
        Conv. {fmtPercent(hero.ctaClicks, hero.videoPlays)}
      </p>
    </>
  );
}

function Topbar() {
  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-4 mb-4 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div className="mb-3">
        <AnalyticsSectionNav />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-3xl font-bold tracking-tight text-ink leading-tight">
            Analytics
          </h1>
          <p className="text-xs text-ink-muted leading-relaxed">
            Strategischer Überblick. Der Live-Feed liegt im Tab daneben.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker />
          <ExportButton />
          <ShortcutsHelp />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-line-soft">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-ink-muted leading-relaxed mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
