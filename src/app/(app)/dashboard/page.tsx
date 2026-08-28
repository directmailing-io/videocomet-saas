import Link from "next/link";
import {
  Megaphone,
  Film,
  Eye,
  Loader2,
  Plus,
  PencilLine,
  ChevronRight,
  Send,
} from "lucide-react";
import { db } from "@/lib/db";
import { runs, leads } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listUserCampaigns } from "@/lib/db/queries/campaigns";
import { listVersandRuns } from "@/lib/db/queries/versand";
import { getActivityFeed } from "@/lib/db/queries/activity";
import { runStatusLabel, runStatusVariant } from "@/lib/run-status";
import { getRunEtas } from "@/lib/run-eta-read";
import { formatRunEta } from "@/lib/run-eta-format";
import {
  DashboardActivityList,
  type DashboardActivityItem,
} from "./activity-card";

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

export default async function DashboardPage() {
  const { user } = await requireUser();
  const userId = user.id;

  const userCampaigns = await listUserCampaigns(userId);
  const activeCampaignCount = userCampaigns.filter(
    (c) => c.status === "active",
  ).length;
  const drafts = userCampaigns.filter((c) => c.status === "draft");

  const [
    [generatedVideos],
    [videoViews],
    [openRuns],
    recentRuns,
    activityFeed,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(and(eq(runs.userId, userId), eq(leads.status, "completed"))),
    db
      .select({
        total: sql<number>`coalesce(sum(${leads.viewCount}), 0)::int`,
      })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(eq(runs.userId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.status, "generating"))),
    db
      .select({
        id: runs.id,
        name: runs.name,
        status: runs.status,
        campaignId: runs.campaignId,
        totalLeads: runs.totalLeads,
        completedLeads: runs.completedLeads,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .where(eq(runs.userId, userId))
      .orderBy(desc(runs.createdAt))
      .limit(5),
    getActivityFeed(userId, { scope: { kind: "global" }, limit: 6 }),
  ]);

  // Versand-Mini-Cockpit (Etappe C): Versand hat keinen eigenen Nav-Punkt
  // mehr — Runden mit offenen Briefen tauchen hier auf.
  const versandRuns = await listVersandRuns(userId).catch(() => []);
  const pendingVersand = versandRuns
    .filter((r) => r.withPdf > r.letterSent)
    .slice(0, 4);

  // Server-ETA (W3) für laufende Runden — reiner Redis-Read, Momentaufnahme
  // beim Seitenaufbau (kein Live-Countdown nötig auf dem Dashboard).
  const etaMap = await getRunEtas(
    recentRuns.filter((r) => r.status === "generating").map((r) => r.id),
  );

  const activityItems: DashboardActivityItem[] = activityFeed.rows.map(
    (r) => ({
      eventId: r.eventId,
      ts: r.ts,
      kind: r.kind,
      payload: r.payload,
      leadName: r.lead.name,
      campaignName: r.campaign.name,
      temperature: r.lead.temperature,
    }),
  );

  const firstName = user.firstName?.trim() || user.email;
  const runningCount = openRuns?.count ?? 0;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">
            Hallo {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {runningCount > 0
              ? `${runningCount} ${runningCount === 1 ? "Runde läuft" : "Runden laufen"} gerade`
              : "Alles ruhig — keine laufenden Runden"}
          </p>
        </div>
        {userCampaigns.length > 0 && (
          <Button asChild iconLeft={<Plus className="size-4" />}>
            <Link href="/kampagnen/neu">Neue Kampagne</Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Aktive Kampagnen"
          value={activeCampaignCount}
          icon={<Megaphone />}
        />
        <StatCard
          label="Generierte Videos"
          value={generatedVideos?.count ?? 0}
          icon={<Film />}
        />
        <StatCard
          label="Video-Aufrufe"
          value={videoViews?.total ?? 0}
          icon={<Eye />}
        />
        <StatCard
          label="Laufende Runden"
          value={runningCount}
          icon={<Loader2 />}
        />
      </div>

      {drafts.length > 0 && (
        <Link
          href={
            drafts.length === 1
              ? `/kampagnen/neu?draft=${drafts[0].id}`
              : "/kampagnen"
          }
          className="group mb-6 flex items-center gap-3 rounded-squircle-md bg-surface px-5 py-3.5 shadow-card transition-all duration-200 hover:shadow-card-hover"
        >
          <span className="size-2 shrink-0 rounded-full bg-amber-400 ring-4 ring-amber-400/20" />
          <p className="min-w-0 flex-1 truncate text-sm text-ink">
            {drafts.length === 1 ? (
              <>
                Dein Entwurf{" "}
                <span className="font-semibold">
                  {drafts[0].name?.trim() || "Unbenannter Entwurf"}
                </span>{" "}
                wartet auf Fertigstellung
              </>
            ) : (
              <>
                <span className="font-semibold">{drafts.length} Entwürfe</span>{" "}
                warten auf Fertigstellung
              </>
            )}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-deep">
            <PencilLine className="size-4" />
            Weiter bearbeiten
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      {versandRuns.length > 0 && (
        <div className="mb-6 rounded-squircle-md bg-surface px-5 py-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Send className="size-4 text-brand-deep" />
              Versand
              {pendingVersand.length > 0 && (
                <span className="text-ink-muted font-normal">
                  · {pendingVersand.length}{" "}
                  {pendingVersand.length === 1 ? "Runde wartet" : "Runden warten"}
                </span>
              )}
            </h2>
            <Link
              href="/versand"
              className="text-sm font-semibold text-brand-deep hover:underline"
            >
              Versandzentrale
            </Link>
          </div>
          {pendingVersand.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              Alles versendet — gerade nichts zu tun.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {pendingVersand.map((r) => (
                <li key={r.runId}>
                  <Link
                    href={`/versand/${r.runId}`}
                    className="group flex items-center gap-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink group-hover:text-brand-deep">
                        {r.runName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {r.campaignName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                      {r.letterSent} von {r.withPdf} Briefen versendet
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {userCampaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="Noch keine Kampagnen"
          subtitle="Lege jetzt deine erste Kampagne an und nimm deine personalisierten Outreach-Videos in Serie auf."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/kampagnen/neu">Erste Kampagne erstellen</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Aktuelle Runden</CardTitle>
            </CardHeader>
            <CardContent>
              {recentRuns.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Noch keine Runden gestartet. Starte eine Runde in einer
                  deiner Kampagnen.
                </p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {recentRuns.map((r) => {
                    const etaEntry =
                      r.status === "generating" ? etaMap.get(r.id) : undefined;
                    const etaLabel = etaEntry ? formatRunEta(etaEntry) : null;
                    return (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/kampagnen/${r.campaignId}`}
                            className="block text-sm font-semibold text-ink hover:text-brand-deep truncate"
                          >
                            {r.name}
                          </Link>
                          <p className="text-xs text-ink-muted mt-0.5">
                            {r.completedLeads} / {r.totalLeads} Leads &middot;{" "}
                            {formatDate(r.createdAt)}
                            {etaLabel ? <> &middot; {etaLabel}</> : null}
                          </p>
                        </div>
                        <Badge variant={runStatusVariant(r.status)} dot>
                          {runStatusLabel(r.status)}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Letzte Aktivität</CardTitle>
              {activityItems.length > 0 && (
                <Link
                  href="/aktivitaet"
                  className="text-sm font-semibold text-brand-deep hover:underline"
                >
                  Alle ansehen
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {activityItems.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Noch keine Aktivität. Sobald Empfänger deine Videos öffnen,
                  siehst du es hier zuerst.
                </p>
              ) : (
                <DashboardActivityList
                  items={activityItems}
                  now={Date.now()}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
