import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun, countByStatus } from "@/lib/db/queries/leads";
import { getUserDomain } from "@/lib/db/queries/user-domains";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LiveTable } from "./live-table";
import { ActivityCenter } from "@/app/(app)/aktivitaet/activity-center";

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

  // Pre-Flight-Phase: wenn der Run noch im Quality-Check ist (Phase 1 läuft
  // oder wartet auf Freigabe), gehört der User auf die Preflight-Review-
  // Seite. Sonst sieht er hier nur "Wartet"-Status für alle Leads und denkt
  // das System hängt — der Worker wartet aber auf seine Approval-Entscheidung.
  if (run.status === "preflighting" || run.status === "awaiting_approval") {
    redirect(`/kampagnen/${id}/runs/${runId}/preflight`);
  }

  // Unfertige Runden: zurück in den Wizard, der über ?resume= den
  // gespeicherten Stand (Upload-Preview + Mapping) wieder aufnimmt.
  if (run.status === "draft" || run.status === "mapping") {
    redirect(`/kampagnen/${id}/runs/neu?resume=${runId}`);
  }

  const [leads, counts] = await Promise.all([
    listLeadsByRun(runId, user.id),
    countByStatus(runId, user.id),
  ]);

  // Custom-Domain-Hostname holen (alle Leads in einer Runde erben dieselbe
  // Domain über die Kampagne — wir machen einen Lookup statt eines JOINs).
  // Bei nicht-aktiver Domain (verifying/failed/etc.) lassen wir das Feld
  // null, damit das UI auf die Default-app.videocomet.de-URL faellt.
  let customHostname: string | null = null;
  if (campaign.domainId) {
    const d = await getUserDomain(campaign.domainId, user.id).catch(() => null);
    if (d && d.status === "active") customHostname = d.hostname;
  }

  const initialLeads = leads.map((l) => ({
    id: l.id,
    rowIndex: l.rowIndex,
    status: l.status,
    slug: l.slug,
    videoUrl: l.videoUrl,
    pdfUrl: l.pdfUrl,
    envelopePdfUrl: l.envelopePdfUrl,
    thumbnailUrl: l.thumbnailUrl,
    errorMessage: l.errorMessage,
    completedAt: l.completedAt ? l.completedAt.toISOString() : null,
    data: l.data as Record<string, string>,
    // Per-lead override: falls leads.domain_id explizit gesetzt ist (also
    // der Lead wurde mit der aktiven Custom-Domain generiert) und die
    // Campaign-Domain noch dieselbe ist, gilt customHostname. Sonst null.
    customHostname: l.domainId === campaign.domainId ? customHostname : null,
    // Tracking aggregates (denormalized on `leads`). Serialised to ISO so the
    // server payload stays JSON-clean.
    viewCount: l.viewCount ?? 0,
    firstViewedAt: l.firstViewedAt ? l.firstViewedAt.toISOString() : null,
    lastViewedAt: l.lastViewedAt ? l.lastViewedAt.toISOString() : null,
    playCount: l.playCount ?? 0,
    watchTimeSec: l.watchTimeSec ? l.watchTimeSec : 0,
    ctaClickCount: l.ctaClickCount ?? 0,
    lastCtaAt: l.lastCtaAt ? l.lastCtaAt.toISOString() : null,
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

      <Tabs defaultValue="übersicht">
        <TabsList>
          <TabsTrigger value="übersicht">Übersicht</TabsTrigger>
          <TabsTrigger value="aktivität">Aktivität</TabsTrigger>
        </TabsList>

        <TabsContent value="übersicht">
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
        </TabsContent>

        <TabsContent value="aktivität">
          <ActivityCenter
            scope="run"
            campaignId={campaign.id}
            campaignName={campaign.name}
            runId={run.id}
            runName={run.name}
            embedded
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
