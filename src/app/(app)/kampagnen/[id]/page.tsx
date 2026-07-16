import type * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3,
  Eye,
  MousePointerClick,
  Play,
  Plus,
  Timer,
  Users,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listCampaignRunsWithCounts } from "@/lib/db/queries/runs";
import {
  getCampaignDeepDive,
  listAllCampaignLeads,
} from "@/lib/db/queries/analytics-summary";
import { db } from "@/lib/db";
import { mediaItems } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

import { RunsTable, type RunRow } from "./runs-table";
import { CampaignActions } from "./campaign-actions";
import { AbTestSettings } from "./ab-test-settings";
import {
  CampaignLeadsTable,
  type CampaignLeadRowSerialized,
} from "./campaign-leads-table";
import { ActivityCenter } from "@/app/(app)/aktivitaet/activity-center";
import { CrmTab } from "./crm-tab";

function formatDate(d: Date | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(d));
  } catch {
    return "";
  }
}

function modeLabel(mode: string): string {
  if (mode === "with-presentation") return "Mit Präsentation";
  return "Nur Webcam";
}

function pipPositionLabel(pos: string | null): string {
  if (pos === "bottom-right" || pos === "right") return "Rechts";
  return "Links";
}

function pipShapeLabel(shape: string | null): string {
  if (shape === "circle") return "Rund";
  if (shape === "square") return "Eckig";
  return "Abgerundet";
}

function fmtPercent(num: number, denom: number): string {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom <= 0) {
    return "0 %";
  }
  const pct = (num / denom) * 100;
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: pct < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(pct)} %`;
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let campaign;
  try {
    campaign = await getCampaign(id, user.id);
  } catch {
    notFound();
  }

  // Parallel: Runden-Liste, Aggregate, Lead-Flat-Liste, Webcam-Media
  const [runsWithCounts, deepDive, allLeads, webcamMedia] = await Promise.all([
    listCampaignRunsWithCounts(campaign.id, user.id),
    getCampaignDeepDive(campaign.id, user.id).catch(() => null),
    listAllCampaignLeads(campaign.id, user.id),
    campaign.webcamMediaId
      ? db
          .select({
            publicUrl: mediaItems.publicUrl,
            name: mediaItems.name,
            durationSec: mediaItems.durationSec,
            width: mediaItems.width,
            height: mediaItems.height,
          })
          .from(mediaItems)
          .where(eq(mediaItems.id, campaign.webcamMediaId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const initialRuns: RunRow[] = runsWithCounts.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    totalLeads: r.totalLeads,
    completedLeads: r.completedLeads,
    failedLeads: r.failedLeads,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    ab: r.abConfig
      ? {
          mode: r.abConfig.mode,
          weightA: r.abConfig.weightA,
          leadsA: r.abLeadsA,
          leadsB: r.abLeadsB,
          viewedA: r.abViewedA,
          viewedB: r.abViewedB,
        }
      : null,
  }));

  // Aggregates aus getCampaignDeepDive ODER aus allLeads als Fallback
  const summary = deepDive?.summary ?? {
    leadsCount: allLeads.length,
    viewCount: allLeads.reduce((s, l) => s + l.viewCount, 0),
    playCount: allLeads.reduce((s, l) => s + l.playCount, 0),
    watchTimeSec: allLeads.reduce((s, l) => s + l.watchTimeSec, 0),
    ctaClickCount: allLeads.reduce((s, l) => s + l.ctaClickCount, 0),
  };
  const leadsCount = summary.leadsCount;
  const uniqueViewedCount = allLeads.filter((l) => l.viewCount > 0).length;
  const uniquePlayedCount = allLeads.filter((l) => l.playCount > 0).length;
  const uniqueCtaCount = allLeads.filter((l) => l.ctaClickCount > 0).length;

  const initialLeadRows: CampaignLeadRowSerialized[] = allLeads.map((l) => ({
    id: l.id,
    rowIndex: l.rowIndex,
    runId: l.runId,
    runName: l.runName,
    data: l.data,
    slug: l.slug,
    status: l.status,
    videoUrl: l.videoUrl,
    pdfUrl: l.pdfUrl,
    viewCount: l.viewCount,
    firstViewedAt: l.firstViewedAt ? l.firstViewedAt.toISOString() : null,
    lastViewedAt: l.lastViewedAt ? l.lastViewedAt.toISOString() : null,
    playCount: l.playCount,
    watchTimeSec: l.watchTimeSec,
    ctaClickCount: l.ctaClickCount,
    lastCtaAt: l.lastCtaAt ? l.lastCtaAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  }));

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // ── A/B-Test: Varianten-Aggregate über alle Runden ──────────────────────
  // Zuteilung steht denormalisiert an jedem Lead (ab_variant) — die Karte
  // erscheint, sobald der Test aktiv ist ODER historische A/B-Leads
  // existieren (Test kann inzwischen beendet sein).
  const abLeadsA = allLeads.filter((l) => l.abVariant === "A");
  const abLeadsB = allLeads.filter((l) => l.abVariant === "B");
  const showAbComparison =
    campaign.abTestingEnabled || abLeadsA.length + abLeadsB.length > 0;

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`Modus: ${modeLabel(campaign.mode)} · Erstellt am ${formatDate(campaign.createdAt)}`}
        actions={
          <>
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                Neue Runde
              </Link>
            </Button>
            <CampaignActions
              campaignId={campaign.id}
              campaignName={campaign.name}
              appUrl={appUrl}
            />
          </>
        }
      />

      <Tabs defaultValue="übersicht">
        <TabsList>
          <TabsTrigger value="übersicht">Übersicht</TabsTrigger>
          <TabsTrigger value="leads">
            Leads {leadsCount > 0 && `(${leadsCount})`}
          </TabsTrigger>
          <TabsTrigger value="runden">
            Runden {initialRuns.length > 0 && `(${initialRuns.length})`}
          </TabsTrigger>
          <TabsTrigger value="aktivität">Aktivität</TabsTrigger>
          <TabsTrigger value="crm">CRM</TabsTrigger>
          <TabsTrigger value="einstellungen">Einstellungen</TabsTrigger>
        </TabsList>

        {/* ── Übersicht ───────────────────────────────────────────── */}
        <TabsContent value="übersicht">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <StatCard
              label="Gesamt-Leads"
              value={leadsCount.toLocaleString("de-DE")}
              icon={<Users />}
              hint={`über ${initialRuns.length} ${initialRuns.length === 1 ? "Runde" : "Runden"}`}
            />
            <StatCard
              label="Öffnungsrate"
              value={fmtPercent(uniqueViewedCount, leadsCount)}
              icon={<Eye />}
              hint={`${uniqueViewedCount.toLocaleString("de-DE")} Leads geöffnet`}
            />
            <StatCard
              label="Play-Rate"
              value={fmtPercent(uniquePlayedCount, leadsCount)}
              icon={<Play />}
              hint={`${uniquePlayedCount.toLocaleString("de-DE")} Leads abgespielt`}
            />
            <StatCard
              label="Watch-Time gesamt"
              value={fmtDuration(summary.watchTimeSec)}
              icon={<Timer />}
              hint={
                summary.playCount > 0
                  ? `∅ ${fmtDuration(Math.round(summary.watchTimeSec / summary.playCount))} pro Play`
                  : "noch keine Plays"
              }
            />
            <StatCard
              label="CTA-Rate"
              value={fmtPercent(uniqueCtaCount, leadsCount)}
              icon={<MousePointerClick />}
              hint={`${uniqueCtaCount.toLocaleString("de-DE")} Leads geklickt`}
            />
          </div>

          {showAbComparison && (
            <div className="mb-6">
              <AbVariantComparison
                leadsA={abLeadsA}
                leadsB={abLeadsB}
                testActive={campaign.abTestingEnabled}
              />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
            {/* Webcam-Vorschau: Video links, Metadaten rechts daneben —
                kein zentriertes Portrait-Video in leerer Riesen-Card */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Webcam-Aufnahme</CardTitle>
              </CardHeader>
              <CardContent>
                <WebcamPreview
                  media={webcamMedia}
                  meta={[
                    { label: "Modus", value: modeLabel(campaign.mode) },
                    {
                      label: "Erstellt am",
                      value: formatDate(campaign.createdAt),
                    },
                    {
                      label: "Runden",
                      value: initialRuns.length.toLocaleString("de-DE"),
                    },
                    {
                      label: "Leads",
                      value: leadsCount.toLocaleString("de-DE"),
                    },
                  ]}
                />
              </CardContent>
            </Card>

            {/* Analytics-Quick-Link */}
            <Card>
              <CardHeader>
                <CardTitle>Analytics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-ink-muted leading-relaxed">
                  Tiefgehende Analyse mit Zeitverlauf, Top-Leads und
                  Event-Log finden Sie im Analytics-Bereich.
                </p>
                <Button
                  asChild
                  variant="subtle"
                  className="w-full justify-center"
                  iconLeft={<BarChart3 className="size-4" />}
                >
                  <Link href={`/analytics/kampagnen/${campaign.id}`}>
                    Kampagnen-Analytics öffnen
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Leads ───────────────────────────────────────────────── */}
        <TabsContent value="leads">
          {initialLeadRows.length === 0 ? (
            <EmptyState
              title="Noch keine Leads"
              subtitle="Sobald Sie eine Runde mit einer Lead-Liste starten, erscheinen die Empfänger hier."
              action={
                <Button asChild iconLeft={<Plus className="size-4" />}>
                  <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                    Neue Runde
                  </Link>
                </Button>
              }
            />
          ) : (
            <CampaignLeadsTable
              campaignId={campaign.id}
              initial={initialLeadRows}
            />
          )}
        </TabsContent>

        {/* ── Runden ─────────────────────────────────────────────── */}
        <TabsContent value="runden">
          <div className="flex justify-end mb-4">
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                Neue Runde
              </Link>
            </Button>
          </div>
          {initialRuns.length === 0 ? (
            <EmptyState
              title="Noch keine Runden"
              subtitle="Starten Sie eine Runde, um diese Kampagne an Ihre Lead-Liste zu schicken."
              action={
                <Button asChild iconLeft={<Plus className="size-4" />}>
                  <Link href={`/kampagnen/${campaign.id}/runs/neu`}>
                    Neue Runde
                  </Link>
                </Button>
              }
            />
          ) : (
            <RunsTable
              campaignId={campaign.id}
              campaignName={campaign.name}
              initialRuns={initialRuns}
            />
          )}
        </TabsContent>

        {/* ── Aktivität ──────────────────────────────────────────── */}
        <TabsContent value="aktivität">
          <ActivityCenter
            scope="campaign"
            campaignId={campaign.id}
            campaignName={campaign.name}
            embedded
          />
        </TabsContent>

        {/* ── CRM ────────────────────────────────────────────────── */}
        <TabsContent value="crm">
          <CrmTab
            campaignId={campaign.id}
            campaignName={campaign.name}
          />
        </TabsContent>

        {/* ── Einstellungen ──────────────────────────────────────── */}
        <TabsContent value="einstellungen" className="space-y-5">
          <AbTestSettings
            campaignId={campaign.id}
            pdfEnabled={campaign.pdfEnabled}
            urlA={campaign.pdfGoogleDocsUrl}
            urlB={campaign.pdfGoogleDocsUrlB}
            enabled={campaign.abTestingEnabled}
          />
          <Card>
            <CardHeader>
              <CardTitle>Konfiguration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Modus
                  </dt>
                  <dd className="text-ink">{modeLabel(campaign.mode)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    PiP-Position
                  </dt>
                  <dd className="text-ink">
                    {pipPositionLabel(campaign.pipPosition)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    PiP-Form
                  </dt>
                  <dd className="text-ink">{pipShapeLabel(campaign.pipShape)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Landingpage-Vorlage
                  </dt>
                  <dd className="text-ink">
                    {campaign.landingPageTemplateId ? (
                      <Link
                        href={`/landingpages/${campaign.landingPageTemplateId}`}
                        className="text-brand-deep hover:underline"
                      >
                        Vorlage öffnen
                      </Link>
                    ) : (
                      <span className="text-ink-muted">Keine</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 pt-6 border-t border-line">
                <h4 className="text-sm font-semibold text-ink mb-3">
                  PDF-Brief
                </h4>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Status
                    </dt>
                    <dd>
                      <Badge
                        variant={campaign.pdfEnabled ? "success" : "neutral"}
                        dot
                      >
                        {campaign.pdfEnabled ? "Aktiv" : "Deaktiviert"}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      QR-Code
                    </dt>
                    <dd className="text-ink">
                      {campaign.pdfQrEnabled ? "Ja" : "Nein"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Thumbnail
                    </dt>
                    <dd className="text-ink">
                      {campaign.pdfThumbnailEnabled ? "Ja" : "Nein"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
                      Google-Docs-URL
                    </dt>
                    <dd className="text-ink truncate">
                      {campaign.pdfGoogleDocsUrl || (
                        <span className="text-ink-muted">Keine</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * A/B-Varianten-Vergleich für den Übersicht-Tab. Aggregiert die
 * denormalisierten Tracking-Zähler der Leads je Variante und markiert den
 * Gewinner nach Öffnungsrate. Bei kleinen Stichproben (<30 Leads pro
 * Variante) warnen wir vor voreiligen Schlüssen statt einen Gewinner
 * auszurufen.
 */
function AbVariantComparison({
  leadsA,
  leadsB,
  testActive,
}: {
  leadsA: Array<{
    viewCount: number;
    playCount: number;
    watchTimeSec: number;
    ctaClickCount: number;
  }>;
  leadsB: Array<{
    viewCount: number;
    playCount: number;
    watchTimeSec: number;
    ctaClickCount: number;
  }>;
  testActive: boolean;
}) {
  function stats(
    rows: Array<{
      viewCount: number;
      playCount: number;
      watchTimeSec: number;
      ctaClickCount: number;
    }>,
  ) {
    const n = rows.length;
    const viewed = rows.filter((l) => l.viewCount > 0).length;
    const played = rows.filter((l) => l.playCount > 0).length;
    const cta = rows.filter((l) => l.ctaClickCount > 0).length;
    const plays = rows.reduce((s, l) => s + l.playCount, 0);
    const watchTime = rows.reduce((s, l) => s + l.watchTimeSec, 0);
    return { n, viewed, played, cta, plays, watchTime };
  }

  const a = stats(leadsA);
  const b = stats(leadsB);
  const smallSample = Math.min(a.n, b.n) < 30;
  const openRateA = a.n > 0 ? a.viewed / a.n : 0;
  const openRateB = b.n > 0 ? b.viewed / b.n : 0;
  const winner: "A" | "B" | null =
    a.n === 0 || b.n === 0 || openRateA === openRateB
      ? null
      : openRateA > openRateB
        ? "A"
        : "B";

  const metricRows: Array<{
    label: string;
    a: string;
    b: string;
  }> = [
    {
      label: "Leads",
      a: a.n.toLocaleString("de-DE"),
      b: b.n.toLocaleString("de-DE"),
    },
    {
      label: "Öffnungsrate",
      a: fmtPercent(a.viewed, a.n),
      b: fmtPercent(b.viewed, b.n),
    },
    {
      label: "Play-Rate",
      a: fmtPercent(a.played, a.n),
      b: fmtPercent(b.played, b.n),
    },
    {
      label: "Ø Watch-Time pro Play",
      a: a.plays > 0 ? fmtDuration(Math.round(a.watchTime / a.plays)) : "–",
      b: b.plays > 0 ? fmtDuration(Math.round(b.watchTime / b.plays)) : "–",
    },
    {
      label: "CTA-Rate",
      a: fmtPercent(a.cta, a.n),
      b: fmtPercent(b.cta, b.n),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          A/B-Test — Brief-Vergleich
          {testActive ? (
            <Badge variant="brand" dot>
              Test läuft
            </Badge>
          ) : (
            <Badge variant="neutral" dot>
              Test beendet
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Kennzahl
                </th>
                <th className="py-2 pr-4 font-semibold text-ink">
                  <span className="inline-flex items-center gap-2">
                    Brief A
                    {winner === "A" && !smallSample && (
                      <Badge variant="success">Vorne</Badge>
                    )}
                  </span>
                </th>
                <th className="py-2 font-semibold text-ink">
                  <span className="inline-flex items-center gap-2">
                    Brief B
                    {winner === "B" && !smallSample && (
                      <Badge variant="success">Vorne</Badge>
                    )}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map((row) => (
                <tr key={row.label} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-4 text-ink-muted">{row.label}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-ink">{row.a}</td>
                  <td className="py-2.5 tabular-nums text-ink">{row.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          {smallSample
            ? "Noch wenig Daten (unter 30 Leads pro Variante) — die Raten können stark schwanken. Warten Sie mit der Gewinner-Entscheidung, bis mehr Briefe geöffnet wurden."
            : "Der Gewinner wird nach Öffnungsrate markiert. Den Test beenden und den Gewinner übernehmen können Sie im Tab „Einstellungen“."}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Webcam-Vorschau: Video links, Metadaten-Panel rechts daneben — so füllt
 * auch ein 9:16-Portrait-Video die Card sinnvoll aus, statt zentriert in
 * leerer Fläche zu schweben. Fällt zurück auf eine informative
 * Empty-State-Meldung statt einer leeren grauen Fläche.
 */
function WebcamPreview({
  media,
  meta,
}: {
  media: {
    publicUrl: string;
    name: string;
    durationSec: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
  meta: Array<{ label: string; value: string }>;
}) {
  if (!media || !media.publicUrl) {
    return (
      <div className="aspect-video w-full rounded-squircle-md border border-dashed border-line bg-surface-soft flex flex-col items-center justify-center gap-2 text-center px-6">
        <p className="text-sm font-semibold text-ink">Keine Webcam ausgewählt</p>
        <p className="text-xs text-ink-muted max-w-sm">
          Wählen Sie in den Kampagnen-Einstellungen eine Webcam-Aufnahme aus
          oder nehmen Sie in der Mediathek eine neue auf.
        </p>
      </div>
    );
  }

  // Portrait-Source (z. B. 720×1280 Selfie) bekommt ein 9:16-Fenster mit
  // begrenzter Höhe, sonst klassisches 16:9. Bei NULL-Dimensionen (Altbestand
  // vor Migration 0011) fallen wir auf 16:9 zurück.
  const isPortrait =
    typeof media.width === "number" &&
    typeof media.height === "number" &&
    media.height > media.width;

  // Bunny Stream-URLs (vz-*.b-cdn.net/<guid>/playlist.m3u8) haben Token-Auth
  // und Hotlink-Protection. Direkt-Fetch via <video> klappt nicht. Wir
  // rendern stattdessen den Bunny-iframe-Player — der hat eigene Auth und
  // braucht weder Token noch Referer-Tricks. Bunny-Storage-URLs (Webcam-
  // Recordings) bleiben als <video>-Element.
  const streamMatch = media.publicUrl.match(
    /^https?:\/\/[^/]+\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i,
  );
  const aspectClass = isPortrait
    ? "aspect-[9/16] w-[200px] sm:w-[220px] shrink-0"
    : "aspect-video w-full sm:max-w-[380px] sm:shrink-0";

  const player = streamMatch ? (
    // autoplay=false: Kampagnen-Seite zeigt evtl. mehrere Videos auf
    // einmal — niemand will Auto-Play-Chaos.
    <iframe
      src={`https://iframe.mediadelivery.net/embed/670919/${streamMatch[1]}?autoplay=false&preload=false`}
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className={`${aspectClass} rounded-squircle-md bg-ink border-0`}
      title={media.name}
    />
  ) : (
    <video
      src={media.publicUrl}
      controls
      preload="metadata"
      className={`${aspectClass} rounded-squircle-md bg-ink border border-line object-contain`}
    />
  );

  const rows: Array<{ label: string; value: string }> = [
    { label: "Datei", value: media.name },
    ...(media.durationSec
      ? [{ label: "Dauer", value: fmtDuration(media.durationSec) }]
      : []),
    ...meta,
  ];

  return (
    <div className="flex flex-col sm:flex-row gap-6">
      <div className="mx-auto sm:mx-0">{player}</div>
      <dl className="flex-1 min-w-0 grid grid-cols-2 gap-x-6 gap-y-4 content-start">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
              {row.label}
            </dt>
            <dd className="text-sm text-ink truncate" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
