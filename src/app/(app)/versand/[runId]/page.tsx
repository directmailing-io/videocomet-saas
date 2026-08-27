import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { getCampaign } from "@/lib/db/queries/campaigns";
import {
  listLeadsByRun,
  getLeadDataColumns,
} from "@/lib/db/queries/leads";
import {
  getLeadEmailStatusMapForRun,
  getLeadEmailHistoryForRun,
  type LeadEmailHistoryEntry,
} from "@/lib/db/queries/email-blasts";
import { VersandRunView } from "./versand-run-view";

export const dynamic = "force-dynamic";

/**
 * Versandzentrale — Detailansicht einer Runde: Lead-Tabelle mit Auswahl,
 * Sortierung nach beliebiger CSV-Spalte, Teilexport (Briefe + Umschläge
 * 1:1 sortiert), Versendet-Markierung mit Datum und E-Mail-Status.
 */
export default async function VersandRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { user } = await requireUser();

  let run;
  try {
    run = await getRun(runId, user.id);
  } catch {
    notFound();
  }

  const [campaign, allLeads, columns, emailStatusMap, emailHistory] =
    await Promise.all([
      getCampaign(run.campaignId, user.id).catch(() => null),
      listLeadsByRun(runId, user.id),
      getLeadDataColumns([runId], user.id).catch(() => [] as string[]),
      getLeadEmailStatusMapForRun(runId, user.id).catch(
        () => ({}) as Record<string, string>,
      ),
      getLeadEmailHistoryForRun(runId, user.id).catch(
        () => ({}) as Record<string, LeadEmailHistoryEntry[]>,
      ),
    ]);
  if (!campaign) notFound();

  // Nur fertige Leads sind versandfähig — der Rest wird gezählt und als
  // Hinweis angezeigt statt still zu verschwinden.
  const completed = allLeads.filter((l) => l.status === "completed");
  const notCompletedCount = allLeads.length - completed.length;

  return (
    <VersandRunView
      runId={run.id}
      runName={run.name}
      runStatus={run.status}
      campaignId={campaign.id}
      campaignName={campaign.name}
      abActive={run.abConfig != null}
      columns={columns}
      notCompletedCount={notCompletedCount}
      leads={completed.map((l) => ({
        id: l.id,
        rowIndex: l.rowIndex,
        contactId: l.contactId ?? null,
        email: l.normalizedEmail ?? null,
        data: l.data as Record<string, string>,
        abVariant: l.abVariant ?? null,
        hasPdf: !!l.pdfUrl,
        hasEnvelope: !!l.envelopePdfUrl,
        letterStatus: l.letterStatus,
        letterSentAt: l.letterSentAt ? l.letterSentAt.toISOString() : null,
        letterExportedAt: l.letterExportedAt
          ? l.letterExportedAt.toISOString()
          : null,
        letterPlannedAt: l.letterPlannedAt
          ? l.letterPlannedAt.toISOString()
          : null,
        letterReturnedAt: l.letterReturnedAt
          ? l.letterReturnedAt.toISOString()
          : null,
        viewCount: l.viewCount ?? 0,
        lastViewedAt: l.lastViewedAt ? l.lastViewedAt.toISOString() : null,
        ctaClickCount: l.ctaClickCount ?? 0,
        lastCtaAt: l.lastCtaAt ? l.lastCtaAt.toISOString() : null,
        emailStatus: emailStatusMap[l.id] ?? null,
        emailHistory: (emailHistory[l.id] ?? []).map((m) => ({
          sentAt: m.sentAt ? m.sentAt.toISOString() : null,
          status: m.status as string,
          repliedAt: m.repliedAt ? m.repliedAt.toISOString() : null,
          subject: m.subject,
        })),
      }))}
    />
  );
}
