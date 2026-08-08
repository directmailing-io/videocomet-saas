import Link from "next/link";
import { Megaphone, Film, Library, Loader2, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { runs, leads, mediaItems, campaigns } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listUserCampaigns } from "@/lib/db/queries/campaigns";
import { runStatusLabel, runStatusVariant } from "@/lib/run-status";
import { getRunEtas } from "@/lib/run-eta-read";
import { formatRunEta } from "@/lib/run-eta-format";

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

  const [activeCampaigns] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(eq(campaigns.userId, userId));

  const [generatedVideos] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(runs.userId, userId), eq(leads.status, "completed")));

  const [mediaCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mediaItems)
    .where(eq(mediaItems.userId, userId));

  const [openRuns] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.status, "generating")));

  const recentRuns = await db
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
    .limit(5);

  // Server-ETA (W3) für laufende Runden — reiner Redis-Read, Momentaufnahme
  // beim Seitenaufbau (kein Live-Countdown nötig auf dem Dashboard).
  const etaMap = await getRunEtas(
    recentRuns.filter((r) => r.status === "generating").map((r) => r.id),
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Aktive Kampagnen"
          value={activeCampaigns?.count ?? 0}
          icon={<Megaphone />}
        />
        <StatCard
          label="Generierte Videos"
          value={generatedVideos?.count ?? 0}
          icon={<Film />}
        />
        <StatCard
          label="Mediathek-Items"
          value={mediaCount?.count ?? 0}
          icon={<Library />}
        />
        <StatCard
          label="Offene Runs"
          value={openRuns?.count ?? 0}
          icon={<Loader2 />}
        />
      </div>

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
        <Card>
          <CardHeader>
            <CardTitle>Aktuelle Runden</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Noch keine Runden gestartet. Starte eine Runde in einer deiner Kampagnen.
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
      )}
    </>
  );
}
