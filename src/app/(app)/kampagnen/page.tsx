import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserCampaigns } from "@/lib/db/queries/campaigns";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { sql, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KampagnenList, type KampagnenListItem } from "./kampagnen-list";

export default async function KampagnenPage() {
  const { user } = await requireUser();
  const items = await listUserCampaigns(user.id);

  // Count runs per campaign in one query
  let runsByCampaign: Map<string, number> = new Map();
  if (items.length > 0) {
    const ids = items.map((c) => c.id);
    const rows = await db
      .select({
        campaignId: runs.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(runs)
      .where(inArray(runs.campaignId, ids))
      .groupBy(runs.campaignId);
    runsByCampaign = new Map(rows.map((r) => [r.campaignId, r.count ?? 0]));
  }

  const listItems: KampagnenListItem[] = items.map((c) => ({
    id: c.id,
    name: c.name,
    mode: c.mode,
    createdAt: c.createdAt,
    runCount: runsByCampaign.get(c.id) ?? 0,
  }));

  return (
    <>
      <PageHeader
        title="Kampagnen"
        subtitle="Verwalte deine Outreach-Kampagnen und starte neue Runden."
        actions={
          <Button asChild iconLeft={<Plus className="size-4" />}>
            <Link href="/kampagnen/neu">Neue Kampagne</Link>
          </Button>
        }
      />

      {listItems.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="Noch keine Kampagnen"
          subtitle="Lege deine erste Kampagne an, um personalisierte Videos zu erzeugen."
          action={
            <Button asChild iconLeft={<Plus className="size-4" />}>
              <Link href="/kampagnen/neu">Erste Kampagne erstellen</Link>
            </Button>
          }
        />
      ) : (
        <KampagnenList items={listItems} />
      )}
    </>
  );
}
