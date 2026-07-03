/**
 * Globale Kontakt-Liste über alle Kampagnen eines Users.
 *
 * Konsolidiert Duplikate: mehrere `leads`-Rows die zur selben Person
 * gehoeren (via normalized_email) werden zu einem "Kontakt" gruppiert.
 * Der "Master-Lead" ist das neueste Vorkommen, die anderen sind
 * Occurrences.
 *
 * Leads OHNE E-Mail: jeder ist sein eigener Kontakt (kein Merge — sonst
 * kollabieren 300 Nameless-Leads in einen Meta-Bucket).
 */

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leads, runs, userDomains } from "@/lib/db/schema";

export interface ContactOccurrenceSummary {
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  leadId: string;
  slug: string | null;
  pageUrl: string | null;
}

export interface ContactSummary {
  masterLeadId: string;
  displayName: string;
  email: string | null;
  company: string | null;
  city: string | null;
  campaignCount: number;
  runCount: number;
  lastSeenAt: Date;
  /** Vorkommen inline für schnellen UI-Zugriff (bis zu 6, sonst gekürzt). */
  occurrences: ContactOccurrenceSummary[];
}

export type ContactSort =
  | "recent"
  | "name-asc"
  | "occurrences-desc";

export interface ListContactsInput {
  userId: string;
  search?: string;
  sort?: ContactSort;
  /** Nur Kontakte mit ≥2 Vorkommen. */
  duplicatesOnly?: boolean;
  campaignId?: string;
  limit?: number;
  offset?: number;
}

export interface ListContactsResult {
  contacts: ContactSummary[];
  total: number;
}

const APP_URL_FALLBACK = "https://app.videocomet.de";

/**
 * Baut die public Landingpage-URL für einen Lead. Custom-Domain hat Vorrang,
 * sonst Default-Domain (app.videocomet.de/v/<slug>).
 */
function buildPageUrl(
  slug: string | null,
  domainHostname: string | null,
): string | null {
  if (!slug) return null;
  if (domainHostname) return `https://${domainHostname}/${slug}`;
  const appUrl = (process.env.APP_URL ?? APP_URL_FALLBACK).replace(/\/+$/, "");
  return `${appUrl}/v/${slug}`;
}

export async function listContacts(input: ListContactsInput): Promise<ListContactsResult> {
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = input.offset ?? 0;
  const sort: ContactSort = input.sort ?? "recent";

  const searchTrim = input.search?.trim().toLowerCase() ?? "";
  const hasSearch = searchTrim.length >= 2;

  // Wir bauen die ganze Aggregation als raw SQL — Drizzle kann DISTINCT
  // ON + Window functions nicht besonders gut. Vorteil: eine einzige
  // Query fuer Contacts + Occurrences (JSON-aggregated).

  // Gruppierungs-Key: E-Mail ALLEIN ist unsicher (Firmen-Postfächer wie
  // kontakt@firma.at werden von mehreren Personen genutzt → 4 Leads mit
  // gleicher E-Mail aber unterschiedlichen Namen sind 4 Personen, nicht 1).
  // Deshalb: MATCH = normalized_email UND normalized_name identisch.
  //   - Beide gesetzt & gleich → derselbe Kontakt
  //   - Nur E-Mail identisch, Name anders → separate Kontakte
  //   - Nur Name gleich, E-Mail leer/anders → separate Kontakte
  //   - Kein Feld gesetzt: jeder Lead eigener Kontakt (lead.id als Key)
  //
  // v2: user-konfigurierbare Regeln (auch nur E-Mail, auch Firma dazu).
  const groupKeyExpr = sql`
    CASE
      WHEN l.normalized_email IS NOT NULL AND l.normalized_name IS NOT NULL
        THEN l.normalized_email || '|' || l.normalized_name
      ELSE l.id::text
    END
  `;

  const searchClause = hasSearch
    ? sql`AND (
        LOWER(COALESCE(l.normalized_email, '')) LIKE ${'%' + searchTrim + '%'}
        OR LOWER(COALESCE(l.normalized_name, '')) LIKE ${'%' + searchTrim + '%'}
        OR LOWER(COALESCE(l.normalized_company, '')) LIKE ${'%' + searchTrim + '%'}
      )`
    : sql``;

  const campaignClause = input.campaignId
    ? sql`AND l.campaign_id = ${input.campaignId}`
    : sql``;

  const duplicatesClause = input.duplicatesOnly
    ? sql`HAVING COUNT(DISTINCT l.campaign_id) >= 2 OR COUNT(DISTINCT l.run_id) >= 2`
    : sql``;

  const orderByClause =
    sort === "name-asc"
      ? sql`ORDER BY display_name ASC NULLS LAST, last_seen_at DESC`
      : sort === "occurrences-desc"
        ? sql`ORDER BY (campaign_count + run_count) DESC, last_seen_at DESC`
        : sql`ORDER BY last_seen_at DESC NULLS LAST`;

  const rows = await db.execute<{
    master_lead_id: string;
    display_name: string | null;
    email: string | null;
    company: string | null;
    city: string | null;
    campaign_count: number;
    run_count: number;
    last_seen_at: Date;
    occurrences_json: string;
  }>(sql`
    WITH filtered_leads AS (
      SELECT
        l.id,
        l.campaign_id,
        l.run_id,
        l.slug,
        l.domain_id,
        l.normalized_email,
        l.normalized_name,
        l.normalized_company,
        l.data,
        l.created_at,
        ${groupKeyExpr} AS group_key
      FROM leads l
      INNER JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.user_id = ${input.userId}
        AND l.removed_at IS NULL
        ${searchClause}
        ${campaignClause}
    ),
    grouped AS (
      SELECT
        group_key,
        COUNT(DISTINCT campaign_id)::int AS campaign_count,
        COUNT(DISTINCT run_id)::int      AS run_count,
        MAX(created_at)                  AS last_seen_at,
        (SELECT id FROM filtered_leads fl2
           WHERE fl2.group_key = filtered_leads.group_key
           ORDER BY created_at DESC LIMIT 1
        ) AS master_lead_id
      FROM filtered_leads
      GROUP BY group_key
      ${duplicatesClause}
    ),
    detailed AS (
      SELECT
        g.group_key,
        g.campaign_count,
        g.run_count,
        g.last_seen_at,
        g.master_lead_id,
        ml.normalized_name  AS display_name,
        ml.normalized_email AS email,
        ml.normalized_company AS company,
        ml.data->>'city'    AS city,
        (
          SELECT json_agg(
            json_build_object(
              'campaignId', fl.campaign_id,
              'campaignName', c.name,
              'runId', fl.run_id,
              'runName', COALESCE(r.name, '(unbenannt)'),
              'leadId', fl.id,
              'slug', fl.slug,
              'domainHostname', ud.hostname
            )
            ORDER BY fl.created_at DESC
          )
          FROM filtered_leads fl
          INNER JOIN campaigns c ON c.id = fl.campaign_id
          INNER JOIN runs r      ON r.id = fl.run_id
          LEFT JOIN user_domains ud ON ud.id = fl.domain_id
          WHERE fl.group_key = g.group_key
        ) AS occurrences_json
      FROM grouped g
      INNER JOIN leads ml ON ml.id = g.master_lead_id
    )
    SELECT
      master_lead_id,
      display_name,
      email,
      company,
      city,
      campaign_count,
      run_count,
      last_seen_at,
      COALESCE(occurrences_json::text, '[]') AS occurrences_json
    FROM detailed
    ${orderByClause}
    LIMIT ${limit} OFFSET ${offset}
  `);

  // Total-Count separat (auch mit dedup-Filter).
  const totalRows = await db.execute<{ total: number }>(sql`
    WITH filtered_leads AS (
      SELECT
        l.campaign_id,
        l.run_id,
        ${groupKeyExpr} AS group_key
      FROM leads l
      INNER JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.user_id = ${input.userId}
        AND l.removed_at IS NULL
        ${searchClause}
        ${campaignClause}
    ),
    grouped AS (
      SELECT group_key,
             COUNT(DISTINCT campaign_id) AS ccount,
             COUNT(DISTINCT run_id)      AS rcount
      FROM filtered_leads
      GROUP BY group_key
      ${duplicatesClause}
    )
    SELECT COUNT(*)::int AS total FROM grouped
  `);

  const contacts: ContactSummary[] = rows.map((r) => {
    const raw = JSON.parse(r.occurrences_json ?? "[]") as Array<{
      campaignId: string;
      campaignName: string;
      runId: string;
      runName: string;
      leadId: string;
      slug: string | null;
      domainHostname: string | null;
    }>;
    const occurrences: ContactOccurrenceSummary[] = raw.map((o) => ({
      campaignId: o.campaignId,
      campaignName: o.campaignName,
      runId: o.runId,
      runName: o.runName,
      leadId: o.leadId,
      slug: o.slug,
      pageUrl: buildPageUrl(o.slug, o.domainHostname),
    }));
    return {
      masterLeadId: r.master_lead_id,
      displayName: r.display_name ?? "(kein Name)",
      email: r.email,
      company: r.company,
      city: r.city,
      campaignCount: r.campaign_count,
      runCount: r.run_count,
      lastSeenAt: r.last_seen_at,
      occurrences,
    };
  });

  return { contacts, total: totalRows[0]?.total ?? 0 };
}

// ── Kampagnen-Filter-Options ───────────────────────────────────────────
export interface ContactFilterOptions {
  campaigns: Array<{ id: string; name: string }>;
}

export async function getContactFilterOptions(
  userId: string,
): Promise<ContactFilterOptions> {
  const rows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), isNull(campaigns.deletedAt)))
    .orderBy(campaigns.name);
  return { campaigns: rows };
}

// ── Detail (fuer Drawer) ───────────────────────────────────────────────
export interface ContactDetail extends ContactSummary {
  occurrences: Array<
    ContactOccurrenceSummary & {
      videoUrl: string | null;
      pdfUrl: string | null;
      status: string;
      createdAt: Date;
      rawData: Record<string, unknown>;
      /** Tracking-Aggregate aus leads (denormalisiert bei jedem lead_event insert). */
      viewCount: number;
      firstViewedAt: Date | null;
      lastViewedAt: Date | null;
      playCount: number;
      watchTimeSec: number;
      ctaClickCount: number;
      lastCtaAt: Date | null;
    }
  >;
  occurrenceIds: string[];
}

export async function getContactDetail(
  userId: string,
  masterLeadId: string,
): Promise<ContactDetail | null> {
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
      domainHostname: userDomains.hostname,
      videoUrl: leads.videoUrl,
      pdfUrl: leads.pdfUrl,
      status: leads.status,
      createdAt: leads.createdAt,
      data: leads.data,
      // Tracking-Aggregate (Migration 0018+, denormalisiert bei lead_event insert)
      viewCount: leads.viewCount,
      firstViewedAt: leads.firstViewedAt,
      lastViewedAt: leads.lastViewedAt,
      playCount: leads.playCount,
      watchTimeSec: leads.watchTimeSec,
      ctaClickCount: leads.ctaClickCount,
      lastCtaAt: leads.lastCtaAt,
    })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(userDomains, eq(userDomains.id, leads.domainId))
    .where(
      and(
        eq(campaigns.userId, userId),
        isNull(leads.removedAt),
        matchCondition,
      ),
    )
    .orderBy(desc(leads.createdAt));

  const occurrences = occurrenceRows.map((r) => ({
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    runId: r.runId,
    runName: r.runName ?? "(unbenannt)",
    leadId: r.leadId,
    slug: r.slug,
    pageUrl: buildPageUrl(r.slug, r.domainHostname),
    videoUrl: r.videoUrl,
    pdfUrl: r.pdfUrl,
    status: r.status,
    createdAt: r.createdAt,
    rawData: (r.data as Record<string, unknown>) ?? {},
    viewCount: r.viewCount,
    firstViewedAt: r.firstViewedAt,
    lastViewedAt: r.lastViewedAt,
    playCount: r.playCount,
    watchTimeSec: r.watchTimeSec,
    ctaClickCount: r.ctaClickCount,
    lastCtaAt: r.lastCtaAt,
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
