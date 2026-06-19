/**
 * REST API für die CRM-Konfiguration EINER Kampagne.
 *
 *   GET    → settings-Row mit Provider-Metadaten der gewählten Integration
 *            (oder `null`, wenn noch keine Konfiguration existiert).
 *   PUT    → Upsert. Validiert die `crmIntegrationId` gegen den User und
 *            stellt sicher, dass für jedes `enabledEvents`-Element ein
 *            non-empty fieldMapping-Key existiert.
 *   DELETE → Entfernt die Konfiguration (CRM-Sync für die Kampagne aus).
 *
 * Tenant-Guard: `getCampaign(id, userId)` als Ownership-Check, plus
 * separater Check der `crmIntegrationId` (User-Match) — sonst könnte ein
 * User die Settings seiner Kampagne an die Integration eines Fremd-Users
 * binden.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  campaignCrmSettings,
  crmIntegrations,
} from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";

const EVENT_KINDS = ["page_view", "video_play", "cta_click"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

const leadMatchSchema = z
  .array(
    z.object({
      source: z.string().min(1),
      target: z.enum(["email", "phone"]),
    }),
  )
  .min(1, "Mindestens eine Matching-Regel erforderlich.");

const fieldMappingSchema = z
  .object({
    page_view: z.string().optional(),
    video_play: z.string().optional(),
    cta_click: z.string().optional(),
    campaign_name: z.string().optional(),
    run_name: z.string().optional(),
    page_url: z.string().optional(),
  })
  .strict();

const putSchema = z.object({
  crmIntegrationId: z.string().uuid(),
  enabled: z.boolean(),
  leadMatch: leadMatchSchema,
  enabledEvents: z.array(z.enum(EVENT_KINDS)),
  fieldMapping: fieldMappingSchema,
});

type PutBody = z.infer<typeof putSchema>;

async function ensureCampaign(
  campaignId: string,
  userId: string,
): Promise<boolean> {
  try {
    await getCampaign(campaignId, userId);
    return true;
  } catch {
    return false;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  if (!(await ensureCampaign(params.id, auth.user.id))) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const [row] = await db
    .select({
      campaignId: campaignCrmSettings.campaignId,
      crmIntegrationId: campaignCrmSettings.crmIntegrationId,
      enabled: campaignCrmSettings.enabled,
      leadMatch: campaignCrmSettings.leadMatch,
      enabledEvents: campaignCrmSettings.enabledEvents,
      fieldMapping: campaignCrmSettings.fieldMapping,
      updatedAt: campaignCrmSettings.updatedAt,
      integrationProvider: crmIntegrations.provider,
      integrationName: crmIntegrations.name,
      integrationDisabledAt: crmIntegrations.disabledAt,
    })
    .from(campaignCrmSettings)
    .leftJoin(
      crmIntegrations,
      eq(crmIntegrations.id, campaignCrmSettings.crmIntegrationId),
    )
    .where(eq(campaignCrmSettings.campaignId, params.id))
    .limit(1);

  return NextResponse.json({ settings: row ?? null });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  if (!(await ensureCampaign(params.id, auth.user.id))) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: PutBody;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // Integration muss demselben User gehören.
  const [integ] = await db
    .select({ id: crmIntegrations.id })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.id, body.crmIntegrationId),
        eq(crmIntegrations.userId, auth.user.id),
      ),
    )
    .limit(1);
  if (!integ) {
    return NextResponse.json(
      { error: "Unbekannte CRM-Integration." },
      { status: 400 },
    );
  }

  // Für jedes aktivierte Event muss ein Mapping vorhanden sein.
  const fm = body.fieldMapping;
  const missing: EventKind[] = [];
  for (const kind of body.enabledEvents) {
    const value = fm[kind];
    if (typeof value !== "string" || value.trim().length === 0) {
      missing.push(kind);
    }
  }
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Für folgende Events fehlt ein CRM-Feld-Mapping: ${missing.join(", ")}`,
        missing,
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const [row] = await db
    .insert(campaignCrmSettings)
    .values({
      campaignId: params.id,
      crmIntegrationId: body.crmIntegrationId,
      enabled: body.enabled,
      leadMatch: body.leadMatch as unknown as Record<string, unknown>,
      enabledEvents: body.enabledEvents as unknown as string[],
      fieldMapping: body.fieldMapping as unknown as Record<string, unknown>,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: campaignCrmSettings.campaignId,
      set: {
        crmIntegrationId: body.crmIntegrationId,
        enabled: body.enabled,
        leadMatch: body.leadMatch as unknown as Record<string, unknown>,
        enabledEvents: body.enabledEvents as unknown as string[],
        fieldMapping: body.fieldMapping as unknown as Record<string, unknown>,
        updatedAt: now,
      },
    })
    .returning();

  return NextResponse.json({ settings: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  if (!(await ensureCampaign(params.id, auth.user.id))) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  await db
    .delete(campaignCrmSettings)
    .where(eq(campaignCrmSettings.campaignId, params.id));

  return NextResponse.json({ ok: true });
}
