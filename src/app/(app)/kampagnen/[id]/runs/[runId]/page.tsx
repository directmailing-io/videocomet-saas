import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun, countByStatus } from "@/lib/db/queries/leads";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { LiveTable } from "./live-table";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const { user } = await requireUser();

  let campaign, run;
  try {
    campaign = await getCampaign(id, user.id);
    run = await getRun(runId, user.id);
    if (run.campaignId !== campaign.id) notFound();
  } catch {
    notFound();
  }

  const [leads, counts] = await Promise.all([
    listLeadsByRun(runId, user.id),
    countByStatus(runId, user.id),
  ]);

  const initialLeads = leads.map((l) => ({
    id: l.id,
    rowIndex: l.rowIndex,
    status: l.status,
    slug: l.slug,
    videoUrl: l.videoUrl,
    pdfUrl: l.pdfUrl,
    thumbnailUrl: l.thumbnailUrl,
    errorMessage: l.errorMessage,
    completedAt: l.completedAt ? l.completedAt.toISOString() : null,
    data: l.data as Record<string, string>,
  }));

  return (
    <>
      <PageHeader
        title={`Runde . ${run.name}`}
        subtitle={`Kampagne ${campaign.name}`}
        actions={
          <Button asChild variant="ghost" iconLeft={<ArrowLeft className="size-4" />}>
            <Link href={`/kampagnen/${campaign.id}`}>Zur Kampagne</Link>
          </Button>
        }
      />

      <LiveTable
        runId={runId}
        campaignId={campaign.id}
        pdfEnabled={campaign.pdfEnabled}
        initialRun={{
          id: run.id,
          name: run.name,
          status: run.status,
          totalLeads: run.totalLeads,
          startedAt: run.startedAt ? run.startedAt.toISOString() : null,
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        }}
        initialCounts={counts}
        initialLeads={initialLeads}
      />
    </>
  );
}
