/**
 * RFC-4180 CSV-Builder für den Lead-Adress-Export aus dem Aktivitäts-Center.
 *
 * Format-Entscheidungen:
 *   - Header-Zeile auf Deutsch (Excel/Outlook erwarten lokalisierte Spalten)
 *   - Trennzeichen: Komma (RFC-4180 default). Deutsche Excel-User können das
 *     im Import-Dialog umstellen; eine SEP=… Zeile haben wir bewusst NICHT,
 *     weil das LibreOffice und Google-Sheets stört.
 *   - Newlines: CRLF (RFC-4180 §2.1)
 *   - Quoting: nur wo nötig (Komma, Quote, CR, LF im Feldinhalt). Quotes
 *     im Inhalt werden verdoppelt.
 *   - Encoding: Caller schreibt die Bytes als UTF-8; ein BOM wird bewusst
 *     NICHT vorangestellt — der Download-Endpoint (Agent 2) kann das BOM
 *     für Excel-on-Windows on demand davorhängen.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leadEvents, leads, runs } from "@/lib/db/schema";
import { classifyLeadFromAggregates } from "./classify";
import type {
  ActivityFilters,
  ExportLeadRow,
  LeadTemperature,
} from "./types";

// ── CSV primitives ──────────────────────────────────────────────────────────

const HEADER: readonly string[] = [
  "Vorname",
  "Nachname",
  "Firma",
  "E-Mail",
  "Telefon",
  "Webseite",
  "Slug",
  "Lead-Status",
  "Temperatur",
  "Letzte Aktivität",
  "Page-Views",
  "Video-Watched-Sec",
  "CTA-Klicks",
  "Run-Name",
  "Kampagnen-Name",
];

function needsQuoting(value: string): boolean {
  // CR / LF / comma / quote all force quoting per RFC-4180.
  return /[",\r\n]/.test(value);
}

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : String(value);
  if (!needsQuoting(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function rowToCsv(values: readonly unknown[]): string {
  return values.map(escapeField).join(",");
}

const TEMPERATURE_DE: Record<LeadTemperature, string> = {
  cold: "Kalt",
  warm: "Warm",
  hot: "Heiß",
  inactive: "Inaktiv",
};

/**
 * Build the full CSV string. Joins with CRLF and terminates with a final
 * CRLF (matches `csv` spec & avoids the "Excel-cuts-the-last-row" trap).
 */
export function buildLeadCsv(rows: readonly ExportLeadRow[]): string {
  const lines: string[] = [rowToCsv(HEADER)];
  for (const r of rows) {
    lines.push(
      rowToCsv([
        r.firstName ?? "",
        r.lastName ?? "",
        r.companyName ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.websiteUrl ?? "",
        r.slug ?? "",
        r.leadStatus,
        TEMPERATURE_DE[r.temperature],
        r.lastActivityAt ?? "",
        r.pageViews,
        r.watchTimeSec,
        r.ctaClicks,
        r.runName,
        r.campaignName,
      ]),
    );
  }
  // Trailing CRLF on purpose.
  return lines.join("\r\n") + "\r\n";
}

// ── Loader: leads with aggregates from DB ───────────────────────────────────

/**
 * Lookup helper for the JSONB `data` payload on `leads`. We can't index every
 * possible CSV-column name a customer might pick, so the loader does the
 * lookup in JS once the rows are materialised. Same pick-list as
 * `projectPreflightLead` plus an e-mail / phone-aware extension.
 */
function pickFromData(
  data: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string | null {
  if (!data) return null;
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

const FIELD_FIRSTNAME = ["firstName", "Vorname", "first_name", "vorname"];
const FIELD_LASTNAME = ["lastName", "Nachname", "last_name", "nachname"];
const FIELD_COMPANY = [
  "companyName",
  "company",
  "Firma",
  "company_name",
  "firma",
];
const FIELD_EMAIL = ["email", "E-Mail", "EMail", "Mail", "mail", "e_mail"];
const FIELD_PHONE = [
  "phone",
  "Telefon",
  "telefon",
  "phoneNumber",
  "tel",
  "Tel",
];
const FIELD_WEBSITE = [
  "websiteUrl",
  "website",
  "Webseite",
  "url",
  "URL",
  "Website",
];

interface LoadedLeadRow {
  leadId: string;
  data: Record<string, string> | null;
  slug: string | null;
  status: string;
  viewCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  lastViewedAt: Date | null;
  lastCtaAt: Date | null;
  playCount: number;
  runId: string;
  runName: string;
  campaignId: string;
  campaignName: string;
}

/**
 * Load all leads matching the export filters. Pagination is intentionally
 * absent — the download-endpoint streams the whole result-set into a CSV
 * blob. Tenant-Guard is mandatory; only campaigns the user owns are joined.
 *
 * The query joins `leads → runs → campaigns` so we get the contextual names
 * in one roundtrip; aggregates (page-views, watch-time, cta-clicks) come
 * from the denormalised columns the `aggregateLeadStats` writer maintains.
 * For accurate temperature we additionally hop into `lead_events` to find
 * max-progress and session-count per lead (single GROUP BY query, no N+1).
 */
export async function getLeadsForExport(
  userId: string,
  filters: ActivityFilters,
): Promise<ExportLeadRow[]> {
  // ── 1. Lead-Set basierend auf Scope + Filter ─────────────────────────
  const whereParts: ReturnType<typeof sql>[] = [];
  whereParts.push(sql`${campaigns.userId} = ${userId}`);
  whereParts.push(sql`${leads.removedAt} IS NULL`);

  const scope = filters.scope;
  switch (scope.kind) {
    case "campaign":
      whereParts.push(sql`${campaigns.id} = ${scope.campaignId}`);
      break;
    case "run":
      whereParts.push(sql`${runs.id} = ${scope.runId}`);
      break;
    case "lead":
      whereParts.push(sql`${leads.id} = ${scope.leadId}`);
      break;
    case "global":
    default:
      break;
  }

  if (filters.campaignIds && filters.campaignIds.length > 0) {
    whereParts.push(sql`${campaigns.id} = ANY(${filters.campaignIds})`);
  }
  if (filters.runIds && filters.runIds.length > 0) {
    whereParts.push(sql`${runs.id} = ANY(${filters.runIds})`);
  }
  if (filters.from) {
    whereParts.push(
      sql`(${leads.lastViewedAt} IS NULL OR ${leads.lastViewedAt} >= ${filters.from})`,
    );
  }
  if (filters.to) {
    whereParts.push(
      sql`(${leads.lastViewedAt} IS NULL OR ${leads.lastViewedAt} <= ${filters.to})`,
    );
  }
  if (filters.search && filters.search.trim().length > 0) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    whereParts.push(sql`(
      LOWER(COALESCE(${leads.slug}, '')) LIKE ${term}
      OR LOWER(COALESCE(${leads.data}::text, '')) LIKE ${term}
    )`);
  }

  const rows = (await db
    .select({
      leadId: leads.id,
      data: leads.data,
      slug: leads.slug,
      status: leads.status,
      viewCount: leads.viewCount,
      watchTimeSec: leads.watchTimeSec,
      ctaClickCount: leads.ctaClickCount,
      lastViewedAt: leads.lastViewedAt,
      lastCtaAt: leads.lastCtaAt,
      playCount: leads.playCount,
      runId: runs.id,
      runName: runs.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...whereParts))) as unknown as LoadedLeadRow[];

  if (rows.length === 0) return [];

  // ── 2. Pro Lead: max-progress + session-count aus lead_events.
  //    Eine einzige GROUP-BY-Query gegen alle relevanten Lead-IDs — kein N+1.
  const leadIds = rows.map((r) => r.leadId);
  const progressMap = new Map<
    string,
    { maxProgressPct: number; sessionCount: number }
  >();

  const progressRows = (await db
    .select({
      leadId: leadEvents.leadId,
      maxPct: sql<number | null>`MAX(
        CASE
          WHEN ${leadEvents.kind} IN ('video_progress', 'video_ended')
            AND (${leadEvents.payload} ? 'atSec')
            AND (${leadEvents.payload} ? 'duration')
            AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
          THEN (
            COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
            / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)
            * 100
          )
          ELSE NULL
        END
      )`,
      sessionCount: sql<number>`COUNT(DISTINCT ${leadEvents.sessionId})::int`,
    })
    .from(leadEvents)
    .where(inArray(leadEvents.leadId, leadIds))
    .groupBy(leadEvents.leadId)) as Array<{
      leadId: string;
      maxPct: number | null;
      sessionCount: number;
    }>;

  for (const p of progressRows) {
    progressMap.set(p.leadId, {
      maxProgressPct: Number(p.maxPct ?? 0),
      sessionCount: Number(p.sessionCount ?? 0),
    });
  }

  // ── 3. Map zu ExportLeadRow + Temperature-Filter ─────────────────────
  const result: ExportLeadRow[] = [];
  for (const row of rows) {
    const data = row.data ?? null;
    const agg = progressMap.get(row.leadId) ?? {
      maxProgressPct: 0,
      sessionCount: 0,
    };

    const temperature = classifyLeadFromAggregates({
      pageViewCount: row.viewCount ?? 0,
      playCount: row.playCount ?? 0,
      watchTimeSec: row.watchTimeSec ?? 0,
      ctaClickCount: row.ctaClickCount ?? 0,
      maxProgressPct: agg.maxProgressPct,
      sessionCount: agg.sessionCount,
    });

    if (
      filters.temperature &&
      filters.temperature.length > 0 &&
      !filters.temperature.includes(temperature)
    ) {
      continue;
    }

    // Pick the latest activity timestamp across the known signals.
    const lastActivity = [row.lastViewedAt, row.lastCtaAt]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    result.push({
      leadId: row.leadId,
      firstName: pickFromData(data, FIELD_FIRSTNAME),
      lastName: pickFromData(data, FIELD_LASTNAME),
      companyName: pickFromData(data, FIELD_COMPANY),
      email: pickFromData(data, FIELD_EMAIL),
      phone: pickFromData(data, FIELD_PHONE),
      websiteUrl: pickFromData(data, FIELD_WEBSITE),
      slug: row.slug,
      leadStatus: row.status,
      temperature,
      lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
      pageViews: row.viewCount ?? 0,
      watchTimeSec: row.watchTimeSec ?? 0,
      ctaClicks: row.ctaClickCount ?? 0,
      runId: row.runId,
      runName: row.runName,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
    });
  }
  return result;
}
