import { notFound } from "next/navigation";
import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listCampaignRuns } from "@/lib/db/queries/runs";
import { EmailBlastWizard, type WizardRunOption } from "./email-blast-wizard";

/**
 * Server-Entry für den Blast-Wizard (6 Schritte, Kontrakt Kapitel „UI").
 * Lädt Kampagne + Runden und einen Beispiel-Lead (bevorzugt mit E-Mail
 * und Video), der im Client für GIF-Editor, Platzhalter-Check und die
 * gerenderte Beispiel-Mail dient.
 */
export default async function NewEmailBlastPage({
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

  const runs = await listCampaignRuns(campaign.id, user.id);
  const runOptions: WizardRunOption[] = runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    totalLeads: r.totalLeads ?? 0,
  }));

  // Beispiel-Lead: mit E-Mail + Video bevorzugt, sonst irgendeiner mit
  // E-Mail — Reihenfolge stabil nach rowIndex.
  const pick = async (requireVideo: boolean) => {
    const conditions = [
      eq(leads.campaignId, campaign.id),
      isNull(leads.removedAt),
      isNotNull(leads.normalizedEmail),
    ];
    if (requireVideo) {
      conditions.push(or(isNotNull(leads.videoMp4Url), isNotNull(leads.videoUrl))!);
    }
    const [row] = await db
      .select({
        data: leads.data,
        videoMp4Url: leads.videoMp4Url,
        videoUrl: leads.videoUrl,
      })
      .from(leads)
      .where(and(...conditions))
      .orderBy(asc(leads.rowIndex))
      .limit(1);
    return row ?? null;
  };
  const example = (await pick(true)) ?? (await pick(false));

  return (
    <EmailBlastWizard
      campaignId={campaign.id}
      campaignName={campaign.name}
      runs={runOptions}
      exampleLeadData={(example?.data as Record<string, string> | null) ?? null}
      exampleVideoUrl={example?.videoMp4Url ?? example?.videoUrl ?? null}
      initialGifConfig={campaign.emailGifConfig ?? null}
    />
  );
}
