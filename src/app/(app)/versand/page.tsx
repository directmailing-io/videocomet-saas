import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads } from "@/lib/db/schema";
import { listVersandRuns } from "@/lib/db/queries/versand";
import { VersandView } from "./versand-view";

export const dynamic = "force-dynamic";

/**
 * Versandzentrale: EIN Ort für den kompletten Versand — eine Runden-Tabelle
 * mit beiden Kanälen (Brief + E-Mail). (/email-versand leitet hierher um.)
 */
export default async function VersandPage() {
  const { user } = await requireUser();

  const [versandRuns, campaignRows] = await Promise.all([
    listVersandRuns(user.id).catch(() => []),
    // Kampagnen mit mindestens einem (nicht entfernten) Lead — nur für die
    // gibt es beim "Neuen Versand" überhaupt Empfänger.
    db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.userId, user.id),
          isNull(campaigns.deletedAt),
          sql`EXISTS (SELECT 1 FROM ${leads} l WHERE l.campaign_id = ${campaigns.id} AND l.removed_at IS NULL)`,
        ),
      )
      .orderBy(desc(campaigns.createdAt)),
  ]);

  return (
    <VersandView
      runs={versandRuns.map((r) => ({
        runId: r.runId,
        runName: r.runName,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        createdAt: r.createdAt.toISOString(),
        completedTotal: r.completedTotal,
        withPdf: r.withPdf,
        letterOpen: r.letterOpen,
        letterInProgress: r.letterInProgress,
        letterSent: r.letterSent,
        reacted: r.reacted,
        stuckInProgress: r.stuckInProgress,
        returned: r.returned,
        lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
        emailTotal: r.emailTotal,
        emailSent: r.emailSent,
        emailScheduled: r.emailScheduled,
        emailReplied: r.emailReplied,
      }))}
      campaigns={campaignRows}
    />
  );
}
