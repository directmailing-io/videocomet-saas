import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import {
  listLeadsByRun,
  countByStatus,
  getLeadDataColumns,
} from "@/lib/db/queries/leads";
import {
  getLeadEmailStatusMapForRun,
  getLeadEmailHistoryForRun,
  type LeadEmailHistoryEntry,
} from "@/lib/db/queries/email-blasts";
import { getUserDomain } from "@/lib/db/queries/user-domains";
import { RunPageShell, type RunTab } from "./run-page-shell";

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const [leads, counts, columns, emailStatusMap, emailHistory] =
    await Promise.all([
      listLeadsByRun(runId, user.id),
      countByStatus(runId, user.id),
      getLeadDataColumns([runId], user.id).catch(() => [] as string[]),
      getLeadEmailStatusMapForRun(runId, user.id).catch(
        () => ({}) as Record<string, string>,
      ),
      getLeadEmailHistoryForRun(runId, user.id).catch(
        () => ({}) as Record<string, LeadEmailHistoryEntry[]>,
      ),
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
    abVariant: l.abVariant ?? null,
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

  // Nur fertige Leads sind versandfähig — der Rest wird im Versand-Tab
  // gezählt und als Hinweis angezeigt statt still zu verschwinden.
  const completed = leads.filter((l) => l.status === "completed");
  const notCompletedCount = leads.length - completed.length;

  const versandLeads = completed.map((l) => ({
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
      fromAddress: m.fromAddress || null,
    })),
  }));

  // Status-Zeile + genau EIN Phasen-Primary für den Seitenkopf.
  const generating = run.status === "generating";
  const withPdf = versandLeads.filter((l) => l.hasPdf).length;
  const letterSent = versandLeads.filter(
    (l) => l.letterStatus === "sent",
  ).length;
  const emailSent = versandLeads.filter((l) =>
    ["sent", "clicked", "replied"].includes(l.emailStatus ?? ""),
  ).length;

  const statusParts = [`Kampagne ${campaign.name}`];
  if (generating) {
    statusParts.push(`${completed.length} von ${leads.length} Videos fertig`);
  } else if (withPdf > 0) {
    statusParts.push(`${letterSent} von ${withPdf} Briefen versendet`);
  }
  if (emailSent > 0) {
    statusParts.push(`${emailSent} E-Mails versendet`);
  }
  const statusLine = statusParts.join(" · ");

  let primaryLabel: string | null = null;
  if (!generating && completed.length > 0) {
    const readyLetters = withPdf - letterSent;
    if (withPdf > 0 && readyLetters === 0) {
      primaryLabel = "Follow-up starten";
    } else if (letterSent > 0) {
      primaryLabel = `Weiter versenden (${readyLetters} offen)`;
    } else {
      primaryLabel = `Jetzt versenden (${withPdf > 0 ? readyLetters : completed.length} bereit)`;
    }
  }

  const sp = await searchParams;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "";
  const defaultTab: RunTab =
    tabParam === "versand" || tabParam === "aktivitaet"
      ? tabParam
      : "videos";

  return (
    <RunPageShell
      runName={run.name}
      campaignId={campaign.id}
      campaignName={campaign.name}
      defaultTab={defaultTab}
      statusLine={statusLine}
      primaryLabel={primaryLabel}
      liveTable={{
        runId,
        campaignId: campaign.id,
        abActive: run.abConfig != null,
        initialRun: {
          id: run.id,
          name: run.name,
          status: run.status,
          totalLeads: run.totalLeads,
          startedAt: run.startedAt ? run.startedAt.toISOString() : null,
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        },
        initialCounts: counts,
        initialLeads,
        emailStatusMap,
      }}
      versand={{
        runId: run.id,
        runName: run.name,
        runStatus: run.status,
        campaignId: campaign.id,
        campaignName: campaign.name,
        abActive: run.abConfig != null,
        columns,
        notCompletedCount,
        leads: versandLeads,
      }}
    />
  );
}
