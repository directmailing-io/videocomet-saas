/**
 * REST API für eine einzelne CRM-Integration des angemeldeten Users.
 *
 *   DELETE ?force=true|false
 *     - Wenn die Integration in `campaign_crm_settings` referenziert ist
 *       und `force !== "true"`: 409 mit Count. Das verhindert, dass der
 *       User unbedacht eine produktiv-genutzte Integration killt.
 *     - Mit `force=true`: löscht erst die referenzierenden settings-Rows
 *       (FK ist ON DELETE RESTRICT auf der settings-Seite), dann die
 *       Integration selbst — beides in einer Transaktion, damit ein
 *       Crash zwischendrin keinen halben State zurücklässt.
 *
 * Tenant-Guard: jeder DB-Touch ist auf `user_id = auth.user.id`
 * eingeschränkt; eine Integration eines anderen Users sieht wie nicht
 * existent aus → 404.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaignCrmSettings, crmIntegrations } from "@/lib/db/schema";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Ownership-Check VOR allem anderen — sonst leaken wir „existiert /
  // existiert nicht" an einen Fremd-Tenant.
  const [own] = await db
    .select({ id: crmIntegrations.id })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.id, params.id),
        eq(crmIntegrations.userId, auth.user.id),
      ),
    )
    .limit(1);
  if (!own) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const force = req.nextUrl.searchParams.get("force") === "true";

  // Wie viele Kampagnen-Settings-Zeilen referenzieren diese Integration?
  // FK in campaign_crm_settings ist ON DELETE RESTRICT — wir müssen das
  // explizit selbst aufräumen, sonst killt uns Postgres mit 23503.
  const [{ count }] = (await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ${campaignCrmSettings}
    WHERE ${campaignCrmSettings.crmIntegrationId} = ${params.id}
  `)) as unknown as Array<{ count: number }>;
  const usageCount = Number(count ?? 0);

  if (usageCount > 0 && !force) {
    return NextResponse.json(
      {
        error: `Integration wird in ${usageCount} Kampagnen verwendet. Mit ?force=true erzwingen.`,
        count: usageCount,
      },
      { status: 409 },
    );
  }

  try {
    await db.transaction(async (tx) => {
      if (usageCount > 0) {
        await tx
          .delete(campaignCrmSettings)
          .where(eq(campaignCrmSettings.crmIntegrationId, params.id));
      }
      await tx
        .delete(crmIntegrations)
        .where(
          and(
            eq(crmIntegrations.id, params.id),
            eq(crmIntegrations.userId, auth.user.id),
          ),
        );
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:integrations:delete] failed:", err);
    return NextResponse.json(
      { error: "Integration konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, removedSettings: usageCount });
}
