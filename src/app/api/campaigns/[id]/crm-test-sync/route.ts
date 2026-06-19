/**
 * POST /api/campaigns/[id]/crm-test-sync
 *
 *   Body: `{ leadId?: string }`. Ohne `leadId` nehmen wir den jüngsten
 *   `status='completed'`-Lead der Kampagne.
 *
 * Was passiert:
 *   1. Lead + Run + Settings + Integration laden (alles tenant-scoped).
 *   2. `leadMatch` gegen `leads.data` auflösen (siehe `resolveLeadMatchValue`).
 *   3. Felder-Payload berechnen: `page_view`/`video_play`/`cta_click` →
 *      ISO-now; `campaign_name`/`run_name`/`page_url` → aus der DB.
 *   4. `provider.findContactByField(field, value)` → Treffer.
 *   5. Pro Treffer `provider.updateContactFields(contactId, payload)`.
 *   6. Pro HTTP-Call eine Zeile in `crm_event_log` mit
 *      `event_kind='test_sync'`.
 *
 * Response: immer HTTP 200 — der Erfolgs-State steckt im Body. So kann die
 * UI nach dem Klick deterministisch eine Toast-Notification zeigen, ohne
 * 4xx/5xx zwischen API-Layer-Fehlern und Sync-Fehlern unterscheiden zu
 * müssen.
 *
 * Wir queuen KEIN BullMQ-Job. Test-Sync ist explizit ein User-Action mit
 * sofortiger Feedback-Schleife — die Latenz von 1-3 HTTP-Calls ist
 * akzeptabel.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  campaignCrmSettings,
  campaigns,
  crmEventLog,
  crmIntegrations,
  leads,
  runs,
  userDomains,
} from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getCrmProvider } from "@/lib/crm/registry";
import { decryptApiKey } from "@/lib/crm/crypto";
import { CrmHttpError } from "@/lib/crm/types";
import {
  resolveLeadMatchValue,
  type LeadMatchRule,
} from "@/lib/crm/match";

const bodySchema = z.object({
  leadId: z.string().uuid().optional(),
});

interface FieldMappingShape {
  page_view?: string;
  video_play?: string;
  cta_click?: string;
  campaign_name?: string;
  run_name?: string;
  page_url?: string;
}

function isLeadMatchArray(value: unknown): value is LeadMatchRule[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { source?: unknown }).source === "string" &&
      ((entry as { target?: unknown }).target === "email" ||
        (entry as { target?: unknown }).target === "phone"),
  );
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://app.videocomet.de"
  );
}

/**
 * Baut die public Landingpage-URL für einen Lead, analog zur
 * Render-Pipeline. Custom-Domain (falls vorhanden) hat Vorrang vor der
 * Default-Domain `app.videocomet.de/v/<slug>`.
 */
function buildPageUrl(
  slug: string | null,
  hostname: string | null,
): string | null {
  if (!slug) return null;
  if (hostname) return `https://${hostname}/${slug}`;
  return `${appUrl()}/v/${slug}`;
}

/**
 * Wandelt das Field-Mapping zusammen mit dem Lead-Kontext in den
 * `fields`-Body für `updateContactFields`. Wir setzen NUR Keys, die der
 * User auch konfiguriert hat — leere Mapping-Werte überspringen wir, sonst
 * würde der CRM-Push das Feld ungewollt leeren.
 */
function buildFieldsPayload(
  fieldMapping: FieldMappingShape,
  enabledEvents: string[],
  context: { campaignName: string; runName: string; pageUrl: string | null },
): Record<string, string> {
  const out: Record<string, string> = {};
  const nowIso = new Date().toISOString();
  for (const kind of enabledEvents) {
    const key = (fieldMapping as Record<string, unknown>)[kind];
    if (typeof key === "string" && key.trim().length > 0) {
      out[key.trim()] = nowIso;
    }
  }
  if (typeof fieldMapping.campaign_name === "string" && fieldMapping.campaign_name.trim().length > 0) {
    out[fieldMapping.campaign_name.trim()] = context.campaignName;
  }
  if (typeof fieldMapping.run_name === "string" && fieldMapping.run_name.trim().length > 0) {
    out[fieldMapping.run_name.trim()] = context.runName;
  }
  if (
    typeof fieldMapping.page_url === "string" &&
    fieldMapping.page_url.trim().length > 0 &&
    context.pageUrl
  ) {
    out[fieldMapping.page_url.trim()] = context.pageUrl;
  }
  return out;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getCampaign(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // CRM-Settings + verknüpfte Integration in einem Schwung holen.
  const [settingsRow] = await db
    .select({
      enabled: campaignCrmSettings.enabled,
      leadMatch: campaignCrmSettings.leadMatch,
      enabledEvents: campaignCrmSettings.enabledEvents,
      fieldMapping: campaignCrmSettings.fieldMapping,
      integrationId: campaignCrmSettings.crmIntegrationId,
      integrationProvider: crmIntegrations.provider,
      integrationApiKey: crmIntegrations.apiKeyEncrypted,
      integrationDisabledAt: crmIntegrations.disabledAt,
      integrationUserId: crmIntegrations.userId,
    })
    .from(campaignCrmSettings)
    .innerJoin(
      crmIntegrations,
      eq(crmIntegrations.id, campaignCrmSettings.crmIntegrationId),
    )
    .where(eq(campaignCrmSettings.campaignId, params.id))
    .limit(1);

  if (!settingsRow) {
    return NextResponse.json(
      { ok: false, error: "Keine CRM-Konfiguration für diese Kampagne." },
      { status: 200 },
    );
  }
  if (settingsRow.integrationUserId !== auth.user.id) {
    // Defense-in-Depth: Settings dürfen nie an eine Fremd-Integration
    // gebunden sein, aber wenn doch (DB-Drift), behandeln wir das wie
    // „keine Konfiguration".
    return NextResponse.json(
      { ok: false, error: "Integration gehört nicht zu diesem Account." },
      { status: 200 },
    );
  }
  if (settingsRow.integrationDisabledAt) {
    return NextResponse.json(
      { ok: false, error: "Verknüpfte CRM-Integration ist deaktiviert." },
      { status: 200 },
    );
  }

  // Lead auswählen: explizit per `leadId` oder den jüngsten completed-Lead.
  let leadRow:
    | {
        id: string;
        runId: string;
        data: Record<string, string>;
        slug: string | null;
        domainId: string | null;
      }
    | null = null;

  if (body.leadId) {
    const [row] = await db
      .select({
        id: leads.id,
        runId: leads.runId,
        data: leads.data,
        slug: leads.slug,
        domainId: leads.domainId,
      })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(
        and(
          eq(leads.id, body.leadId),
          eq(leads.campaignId, params.id),
          eq(runs.userId, auth.user.id),
        ),
      )
      .limit(1);
    leadRow = row ?? null;
  } else {
    const [row] = await db
      .select({
        id: leads.id,
        runId: leads.runId,
        data: leads.data,
        slug: leads.slug,
        domainId: leads.domainId,
      })
      .from(leads)
      .innerJoin(runs, eq(runs.id, leads.runId))
      .where(
        and(
          eq(leads.campaignId, params.id),
          eq(leads.status, "completed"),
          eq(runs.userId, auth.user.id),
        ),
      )
      .orderBy(desc(leads.completedAt), desc(leads.createdAt))
      .limit(1);
    leadRow = row ?? null;
  }

  if (!leadRow) {
    return NextResponse.json(
      { ok: false, error: "Kein passender Lead für Test-Sync vorhanden." },
      { status: 200 },
    );
  }

  // Run + Campaign laden.
  const [contextRow] = await db
    .select({
      runName: runs.name,
      campaignName: campaigns.name,
    })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(eq(runs.id, leadRow.runId))
    .limit(1);

  // Custom-Domain optional separat ziehen — der leftJoin auf einen
  // potentiell-null Lead-Domain-Wert ist mit Drizzle's Typsystem
  // unschön zu typen, deshalb explizit als zweite Query.
  let hostname: string | null = null;
  if (leadRow.domainId) {
    const [domainRow] = await db
      .select({ hostname: userDomains.hostname })
      .from(userDomains)
      .where(eq(userDomains.id, leadRow.domainId))
      .limit(1);
    hostname = domainRow?.hostname ?? null;
  }

  const campaignName = contextRow?.campaignName ?? "";
  const runName = contextRow?.runName ?? "";
  const pageUrl = buildPageUrl(leadRow.slug, hostname);

  // leadMatch in das Typ-System des Helpers überführen.
  if (!isLeadMatchArray(settingsRow.leadMatch)) {
    return NextResponse.json(
      { ok: false, error: "leadMatch-Konfiguration ist ungültig." },
      { status: 200 },
    );
  }
  const match = resolveLeadMatchValue(
    leadRow.data,
    settingsRow.leadMatch,
  );
  if (!match) {
    return NextResponse.json(
      {
        ok: false,
        error: "Kein Match-Wert (Email/Phone) im Lead vorhanden.",
      },
      { status: 200 },
    );
  }

  const enabledEvents = Array.isArray(settingsRow.enabledEvents)
    ? (settingsRow.enabledEvents as string[]).filter(
        (k): k is "page_view" | "video_play" | "cta_click" =>
          k === "page_view" || k === "video_play" || k === "cta_click",
      )
    : [];
  const fieldsPayload = buildFieldsPayload(
    (settingsRow.fieldMapping ?? {}) as FieldMappingShape,
    enabledEvents,
    { campaignName, runName, pageUrl },
  );

  const provider = getCrmProvider(settingsRow.integrationProvider);

  let plaintext: string;
  try {
    plaintext = decryptApiKey(settingsRow.integrationApiKey);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:test-sync] decrypt failed:", err);
    return NextResponse.json(
      { ok: false, error: "API-Key konnte nicht entschlüsselt werden." },
      { status: 200 },
    );
  }

  // Lookup.
  let contacts: Array<{ id: string }> = [];
  try {
    contacts = await provider.findContactByField(
      plaintext,
      match.target,
      match.value,
    );
  } catch (err) {
    const httpStatus = err instanceof CrmHttpError ? err.status : null;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const [logged] = await db
      .insert(crmEventLog)
      .values({
        campaignId: params.id,
        leadId: leadRow.id,
        integrationId: settingsRow.integrationId,
        eventKind: "test_sync",
        lookupField: match.target,
        lookupValue: match.value,
        contactId: null,
        httpStatus,
        requestBody: { stage: "lookup", target: match.target },
        responseBody:
          err instanceof CrmHttpError ? (err.body as unknown) : null,
        errorMessage,
        attempt: 1,
      })
      .returning({ id: crmEventLog.id });
    return NextResponse.json(
      {
        ok: false,
        error: `Lookup-Fehler: ${errorMessage}`,
        logId: logged ? logged.id.toString() : null,
      },
      { status: 200 },
    );
  }

  if (contacts.length === 0) {
    const [logged] = await db
      .insert(crmEventLog)
      .values({
        campaignId: params.id,
        leadId: leadRow.id,
        integrationId: settingsRow.integrationId,
        eventKind: "test_sync",
        lookupField: match.target,
        lookupValue: match.value,
        contactId: null,
        httpStatus: 200,
        requestBody: { stage: "lookup", target: match.target },
        responseBody: { matches: 0 },
        errorMessage: "Kein Kontakt im CRM gefunden.",
        attempt: 1,
      })
      .returning({ id: crmEventLog.id });
    return NextResponse.json(
      {
        ok: false,
        error: "Kein Kontakt im CRM gefunden.",
        logId: logged ? logged.id.toString() : null,
      },
      { status: 200 },
    );
  }

  // Update pro Treffer.
  const logIds: string[] = [];
  let updated = 0;
  let lastError: string | null = null;

  for (const contact of contacts) {
    try {
      const result = await provider.updateContactFields(
        plaintext,
        contact.id,
        fieldsPayload,
      );
      const [logged] = await db
        .insert(crmEventLog)
        .values({
          campaignId: params.id,
          leadId: leadRow.id,
          integrationId: settingsRow.integrationId,
          eventKind: "test_sync",
          lookupField: match.target,
          lookupValue: match.value,
          contactId: contact.id,
          httpStatus: 200,
          requestBody: { fields: fieldsPayload },
          responseBody: (result as { raw?: unknown }).raw ?? null,
          errorMessage: null,
          attempt: 1,
        })
        .returning({ id: crmEventLog.id });
      if (logged) logIds.push(logged.id.toString());
      updated += 1;
    } catch (err) {
      const httpStatus = err instanceof CrmHttpError ? err.status : null;
      const errorMessage = err instanceof Error ? err.message : String(err);
      lastError = errorMessage;
      const [logged] = await db
        .insert(crmEventLog)
        .values({
          campaignId: params.id,
          leadId: leadRow.id,
          integrationId: settingsRow.integrationId,
          eventKind: "test_sync",
          lookupField: match.target,
          lookupValue: match.value,
          contactId: contact.id,
          httpStatus,
          requestBody: { fields: fieldsPayload },
          responseBody:
            err instanceof CrmHttpError ? (err.body as unknown) : null,
          errorMessage,
          attempt: 1,
        })
        .returning({ id: crmEventLog.id });
      if (logged) logIds.push(logged.id.toString());
    }
  }

  if (updated === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: lastError ?? "Update fehlgeschlagen.",
        logIds,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      contactsUpdated: updated,
      logIds,
    },
    { status: 200 },
  );
}
