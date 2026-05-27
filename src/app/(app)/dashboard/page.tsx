import Link from "next/link";
import { Megaphone, Film, Library, Loader2, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { runs, leads, mediaItems, campaigns } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listUserCampaigns } from "@/lib/db/queries/campaigns";

function runStatusBadgeVariant(
  status: string,
): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "generating":
    case "mapping":
      return "brand";
    case "failed":
      return "danger";
    case "cancelled":
      return "warn";
    default:
      return "neutral";
  }
}

function runStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Entwurf";
    case "mapping":
      return "Mapping";
    case "generating":
      return "Generierung";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    case "cancelled":
      return "Abgebrochen";
    default:
      return status;
  }
}

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

  const firstName = user.firstName?.trim() || user.email;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Willkommen zurück, ${firstName}!`}
      />

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
                {recentRuns.map((r) => (
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
                      </p>
                    </div>
                    <Badge variant={runStatusBadgeVariant(r.status)} dot>
                      {runStatusLabel(r.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
