import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads } from "@/lib/db/schema";
import { listUserEmailBlasts } from "@/lib/db/queries/email-blasts";
import { EmailVersandView } from "./email-versand-view";

export const dynamic = "force-dynamic";

/**
 * Zentrale Übersicht aller E-Mail-Versände (Blasts) über alle Kampagnen —
 * der Versand war bisher nur tief in der Kampagnen-Detailseite auffindbar.
 */
export default async function EmailVersandPage() {
  const { user } = await requireUser();

  const [blasts, campaignRows] = await Promise.all([
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
    <EmailVersandView
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
