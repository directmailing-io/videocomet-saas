import { requireUser } from "@/lib/auth-guard";
import { listCampaignsForFilter } from "@/lib/db/queries/analytics-summary";
import { PageHeader } from "@/components/ui/page-header";
import { EventLogClient } from "../_components/event-log-client";

export const dynamic = "force-dynamic";

export default async function EventLogPage() {
  const { user } = await requireUser();
  const campaigns = await listCampaignsForFilter(user.id);

  return (
    <>
      <PageHeader
        title="Event-Log"
        subtitle="Alle Tracking-Events Ihrer Landingpages in chronologischer Reihenfolge."
      />

      <EventLogClient campaigns={campaigns} />
    </>
  );
}
