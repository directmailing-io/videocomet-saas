/**
 * Globale Kontakt-Liste über alle Kampagnen eines Users.
 *
 * Konsolidiert Duplikate: mehrere `leads`-Rows die zur selben Person
 * gehoeren (via user-scoped Match-Config bzw. Default: gleiche E-Mail)
 * werden zu einem "Kontakt" gruppiert. Der "Master-Lead" ist der
 * neueste, die anderen sind "Occurrences" (Vorkommen in weiteren
 * Kampagnen/Runden).
 *
 * v1-Implementation: gruppiert nur nach `normalized_email`. Name+Firma-
 * Match kommt in v2 (braucht Levenshtein). Wenn `normalized_email` NULL
 * ist, ist jeder Lead sein eigener Master (kein Merge).
 */

import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leads, runs } from "@/lib/db/schema";

export interface ContactSummary {
  /** Stabile ID = die ID des neuesten Lead-Vorkommens. */
  masterLeadId: string;
  /** Alle DB-IDs die zu dieser Person gehoeren. */
  occurrenceIds: string[];
  displayName: string;
  email: string | null;
  company: string | null;
  city: string | null;
  campaignCount: number;
  runCount: number;
  lastSeenAt: Date;
}

export interface ListContactsInput {
  userId: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListContactsResult {
  contacts: ContactSummary[];
  total: number;
}

/**
 * Listet alle Kontakte des Users, gruppiert nach normalisierter E-Mail.
 * Leads ohne E-Mail bleiben als eigene Kontakte stehen.
 */
export async function listContacts(input: ListContactsInput): Promise<ListContactsResult> {
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = input.offset ?? 0;

  // Suchfilter: greift auf die generated columns UND einige Rohfelder.
  const searchClause = input.search && input.search.trim().length >= 2
    ? or(
        ilike(leads.normalizedEmail, `%${input.search.trim().toLowerCase()}%`),
        ilike(leads.normalizedName, `%${input.search.trim().toLowerCase()}%`),
        ilike(leads.normalizedCompany, `%${input.search.trim().toLowerCase()}%`),
      )
    : undefined;

  // Aggregations-Query. Wir wollen fuer jede eindeutige (userId,
  // normalized_email) genau einen Kontakt-Row bekommen. Leads OHNE
  // normalized_email werden als eigene Kontakte (per lead.id gruppiert)
  // gezaehlt — sonst kollabieren alle Nameless-Leads in einen Meta-Bucket.

  // Wir bauen einen SUB-Query der pro Contact-Group den neuesten Lead
  // als Master waehlt, dann joinen wir zurueck für Anzeige-Felder.

  const contactGroupKey = sql<string>`
    COALESCE(${leads.normalizedEmail}, ${leads.id}::text)
  `.as("contact_key");

  const groupedSub = db
    .select({
      contactKey: contactGroupKey,
      masterLeadId: sql<string>`(
        SELECT id FROM leads l2
        WHERE l2.campaign_id IN (SELECT id FROM campaigns WHERE user_id = ${input.userId})
          AND l2.removed_at IS NULL
          AND (
            (${leads.normalizedEmail} IS NULL AND l2.id = ${leads.id})
            OR (${leads.normalizedEmail} IS NOT NULL AND l2.normalized_email = ${leads.normalizedEmail})
          )
        ORDER BY l2.created_at DESC LIMIT 1
      )`.as("master_lead_id"),
      occurrenceCount: sql<number>`COUNT(*)::int`.as("occurrence_count"),
      campaignCount: sql<number>`COUNT(DISTINCT ${leads.campaignId})::int`.as("campaign_count"),
      runCount: sql<number>`COUNT(DISTINCT ${leads.runId})::int`.as("run_count"),
      lastSeenAt: sql<Date>`MAX(${leads.createdAt})`.as("last_seen_at"),
    })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(
      and(
        eq(campaigns.userId, input.userId),
        isNull(leads.removedAt),
        searchClause,
      ),
    )
    .groupBy(contactGroupKey, leads.id, leads.normalizedEmail)
    .as("g");

  // Distinct + sort — wir wollen nur pro contact_key einen Row.
  // Postgres-Trick: DISTINCT ON (contact_key) ORDER BY last_seen DESC.
  const rows = await db.execute<{
    master_lead_id: string;
    occurrence_count: number;
    campaign_count: number;
    run_count: number;
    last_seen_at: Date;
    display_name: string | null;
    email: string | null;
    company: string | null;
    city: string | null;
  }>(sql`
    WITH master_leads AS (
      SELECT DISTINCT ON (contact_key)
        contact_key,
        master_lead_id,
        SUM(occurrence_count)::int   AS occurrence_count,
        SUM(campaign_count)::int     AS campaign_count,
        SUM(run_count)::int          AS run_count,
        MAX(last_seen_at)            AS last_seen_at
      FROM ${groupedSub}
      GROUP BY contact_key, master_lead_id
      ORDER BY contact_key, master_lead_id
    )
    SELECT
      ml.master_lead_id,
      ml.occurrence_count,
      ml.campaign_count,
      ml.run_count,
      ml.last_seen_at,
      l.normalized_name  AS display_name,
      l.normalized_email AS email,
      l.normalized_company AS company,
      l.data->>'city'    AS city
    FROM master_leads ml
    LEFT JOIN leads l ON l.id = ml.master_lead_id
    ORDER BY ml.last_seen_at DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `);

  // Fuer den Total-Count einen einfacheren Zaehler.
  const [totalRow] = await db.execute<{ total: number }>(sql`
    SELECT COUNT(DISTINCT COALESCE(l.normalized_email, l.id::text))::int AS total
    FROM leads l
    INNER JOIN campaigns c ON c.id = l.campaign_id
    WHERE c.user_id = ${input.userId}
      AND l.removed_at IS NULL
  `);

  const contacts: ContactSummary[] = rows.map((r) => ({
    masterLeadId: r.master_lead_id,
    occurrenceIds: [], // wird beim Detail-Load nachgeladen (v1 spart Query-Cost)
    displayName: r.display_name ?? "(kein Name)",
    email: r.email,
    company: r.company,
    city: r.city,
    campaignCount: r.campaign_count,
    runCount: r.run_count,
    lastSeenAt: r.last_seen_at,
  }));

  return {
    contacts,
    total: totalRow?.total ?? 0,
  };
}

export interface ContactDetail extends ContactSummary {
  occurrences: Array<{
    leadId: string;
    campaignId: string;
    campaignName: string;
    runId: string;
    runName: string;
    slug: string | null;
    pageUrl: string | null;
    videoUrl: string | null;
    pdfUrl: string | null;
    status: string;
    createdAt: Date;
    rawData: Record<string, unknown>;
  }>;
}

/**
 * Detail-Ansicht eines Kontakts: master-Lead + alle Occurrences (Kampagnen
 * + Runden wo er vorkommt) + rohe importierte Daten.
 */
export async function getContactDetail(
  userId: string,
  masterLeadId: string,
): Promise<ContactDetail | null> {
  // Master-Lead laden (ownership check via campaign.userId join).
  const [master] = await db
    .select({
      id: leads.id,
      email: leads.normalizedEmail,
      name: leads.normalizedName,
      company: leads.normalizedCompany,
      data: leads.data,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(and(eq(leads.id, masterLeadId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!master) return null;

  // Alle Occurrences die zu diesem Master gehoeren.
  // - Wenn Master hat E-Mail: match auf normalized_email.
  // - Wenn nicht: nur der Master selbst.
  const matchCondition = master.email
    ? eq(leads.normalizedEmail, master.email)
    : eq(leads.id, master.id);

  const occurrenceRows = await db
    .select({
      leadId: leads.id,
      campaignId: leads.campaignId,
      campaignName: campaigns.name,
      runId: leads.runId,
      runName: runs.name,
      slug: leads.slug,
      pageUrl: sql<string | null>`NULL`, // v2: berechnen aus slug + campaign.domain
      videoUrl: leads.videoUrl,
      pdfUrl: leads.pdfUrl,
      status: leads.status,
      createdAt: leads.createdAt,
      data: leads.data,
    })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(campaigns.userId, userId),
        isNull(leads.removedAt),
        matchCondition,
      ),
    )
    .orderBy(desc(leads.createdAt));

  const occurrences = occurrenceRows.map((r) => ({
    leadId: r.leadId,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    runId: r.runId,
    runName: r.runName ?? "(unbenannt)",
    slug: r.slug,
    pageUrl: r.pageUrl,
    videoUrl: r.videoUrl,
    pdfUrl: r.pdfUrl,
    status: r.status,
    createdAt: r.createdAt,
    rawData: (r.data as Record<string, unknown>) ?? {},
  }));

  const campaignIds = new Set(occurrences.map((o) => o.campaignId));
  const runIds = new Set(occurrences.map((o) => o.runId));

  return {
    masterLeadId: master.id,
    occurrenceIds: occurrences.map((o) => o.leadId),
    displayName: master.name ?? "(kein Name)",
    email: master.email,
    company: master.company,
    city: ((master.data as Record<string, unknown> | null)?.city as string) ?? null,
    campaignCount: campaignIds.size,
    runCount: runIds.size,
    lastSeenAt: occurrences[0]?.createdAt ?? master.createdAt,
    occurrences,
  };
}
