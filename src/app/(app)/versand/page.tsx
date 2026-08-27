import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads } from "@/lib/db/schema";
import { listUserEmailBlasts } from "@/lib/db/queries/email-blasts";
import { listVersandRuns } from "@/lib/db/queries/versand";
import { VersandView } from "./versand-view";

export const dynamic = "force-dynamic";

/**
 * Versandzentrale: EIN Ort für den kompletten Versand — Tab „Briefe"
 * (Runden mit fertigen PDFs, Status-Steuerung, Teilexport) + Tab „E-Mails"
 * (bestehende Blast-Übersicht). Ersetzt den alten Nav-Punkt
 * „E-Mail-Versand" (/email-versand leitet hierher um).
 */
export default async function VersandPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user } = await requireUser();
  const { tab } = await searchParams;

  const [versandRuns, blasts, campaignRows] = await Promise.all([
    listVersandRuns(user.id).catch(() => []),
    listUserEmailBlasts(user.id).catch(() => []),
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
      initialTab={tab === "emails" ? "emails" : "briefe"}
      runs={versandRuns.map((r) => ({
        runId: r.runId,
        runName: r.runName,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        createdAt: r.createdAt.toISOString(),
        completedTotal: r.completedTotal,
        letterOpen: r.letterOpen,
        letterInProgress: r.letterInProgress,
        letterSent: r.letterSent,
        reacted: r.reacted,
        stuckInProgress: r.stuckInProgress,
        planned: r.planned,
        earliestPlannedAt: r.earliestPlannedAt
          ? r.earliestPlannedAt.toISOString()
          : null,
        returned: r.returned,
        lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
      }))}
      blasts={blasts.map((b) => ({
        id: b.id,
        campaignId: b.campaignId,
        campaignName: b.campaignName,
        status: b.status,
        totalCount: b.totalCount,
        sentCount: b.sentCount,
        startedAt: b.startedAt ? b.startedAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
      }))}
      campaigns={campaignRows}
    />
  );
}
