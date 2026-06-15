/**
 * Queries für Public Password-Protected Campaign-Shares (Migration 0022).
 *
 * Datenmodell: siehe `campaignShares` + `campaignShareAttempts` in schema.ts.
 *
 * Sicherheits-Invarianten:
 *  - `getActiveShareByToken` liefert KEINE Owner-spezifischen Felder ausser
 *    `userId` (für campaign-Scoping in den read-Queries), niemals raw
 *    Owner-Daten.
 *  - `listShareEvents` STRIPPT `ipHash`, `userAgent`, `sessionId` aus jedem
 *    Payload bevor das Ergebnis das Modul verlässt — Public-Konsumenten
 *    dürfen niemals Tracking-Identifier sehen.
 *  - `createShare` verifiziert Campaign-Ownership inline; ein User kann
 *    keinen Share-Link für eine fremde Kampagne anlegen.
 *  - `revokeShare` ist tenant-guarded via `userId` und idempotent.
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  analyticsEvents,
  campaignShareAttempts,
  campaignShares,
  campaigns,
  leadEvents,
  leads,
  runs,
  userDomains,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/db/queries/users";
import { generateShareToken } from "@/lib/share-token";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActiveShare {
  id: string;
  campaignId: string;
  userId: string;
  passwordHash: string;
  label: string | null;
  lastAccessedAt: Date | null;
  /**
   * Hostname der Custom-Domain der Kampagne, falls verknüpft UND `active`.
   * Für die Public-Share-Sicht bauen wir damit Lead-URLs der Form
   * `https://<hostname>/<slug>` statt der Default-URL `${appUrl}/v/<slug>`.
   * NULL → keine Vanity-Domain, Fallback auf Default.
   */
  campaignDomainHostname: string | null;
}

export interface ShareLeadRow {
  leadId: string;
  slug: string | null;
  firstName: string | null;
  lastName: string | null;
  /** E-Mail des Leads aus `data` (case-insensitive Lookup). */
  email: string | null;
  /** Telefonnummer des Leads. */
  phone: string | null;
  /** Zusammengesetzte Adresse: "Strasse, PLZ Stadt[, Land]" oder NULL. */
  address: string | null;
  runId: string;
  runName: string;
  status: string;
  viewCount: number;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  playCount: number;
  ctaClickCount: number;
  lastCtaAt: Date | null;
  watchTimeSec: number;
  createdAt: Date;
}

/**
 * Werte gemäß `leads_removed_reason_check` (Migration 0021) — synchron mit
 * `RemovedReason` in schema.ts. Reicht von der DB hochgereicht; das UI mappt
 * jeden Wert auf ein deutsches Label + Badge-Variant.
 */
export type ShareRemovedReason =
  | "user_rejected"
  | "auto_failed"
  | "duplicate"
  | "pipeline_failed"
  | "incomplete_data";

export interface ShareRemovedLeadRow {
  leadId: string;
  runId: string;
  runName: string;
  /** Vorname aus `leads.data` via case-insensitive Lookup. */
  firstName: string | null;
  /** Nachname aus `leads.data` via case-insensitive Lookup. */
  lastName: string | null;
  /** E-Mail aus `leads.data`. */
  email: string | null;
  /** Telefonnummer aus `leads.data`. */
  phone: string | null;
  /** Zusammengesetzte Adresse: "Strasse, PLZ Stadt[, Land]" oder NULL. */
  address: string | null;
  removedAt: Date;
  removedReason: ShareRemovedReason | null;
  removedDetail: Record<string, unknown> | null;
}

export type ShareEventSource = "lead" | "analytics";

export interface ShareEventRow {
  id: string;
  source: ShareEventSource;
  kind: string;
  ts: Date;
  leadId: string;
  leadSlug: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  runName: string;
  payload: Record<string, unknown> | null;
}

export interface ShareEngagement {
  opened: ShareLeadRow[];
  played: ShareLeadRow[];
  clicked: ShareLeadRow[];
}

/**
 * Whitelist der Event-Kinds, die auf der Public-Share-Sicht gezeigt werden.
 * Bewusst minimal: nur Seite-geöffnet, Video-Play und CTA-Klick. Alle übrigen
 * Kinds (Watch-Progress, Scroll-Depth, Time-on-Page, etc.) sind interner
 * Tracking-Detail und werden vor dem Verlassen der Query gefiltert.
 *
 * Quellen:
 *   - `leadEvents.kind`: `page_view`, `video_play`, `cta_click`
 *   - `analyticsEvents.eventType` (legacy): `page_view`, `video_start`, `cta_click`
 *     sowie potentielle Bridge-Aliase (`lead_open`, `landingpage_open`, `view`,
 *     `play`) — alle Aliase werden mitgenommen, damit ältere Tracker nichts
 *     verschlucken.
 */
export const SHARE_ALLOWED_EVENT_KINDS = [
  // Page open / view
  "page_view",
  "lead_open",
  "landingpage_open",
  "view",
  // Video play
  "video_play",
  "video_start",
  "play",
  // CTA click
  "cta_click",
] as const;

export interface ShareSummaryRow {
  id: string;
  token: string;
  label: string | null;
  createdAt: Date;
  lastAccessedAt: Date | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SHARE_EVENT_DEFAULT_LIMIT = 200;
const SHARE_EVENT_MAX_LIMIT = 500;
const CREATE_SHARE_MAX_ATTEMPTS = 5;

// SQL-side flatten der JSONB `leads.data` Vor-/Nachnamen via case-insensitive
// Lookup. Wir spiegeln das Pattern aus `activity.ts` (firstName/Vorname).
// `vorname` (lowercase) ist als Fallback dabei.
const LEAD_FIRSTNAME_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'firstName', ''),
    NULLIF(${leads.data} ->> 'Vorname', ''),
    NULLIF(${leads.data} ->> 'vorname', ''),
    NULLIF(${leads.data} ->> 'first_name', '')
  )
`;

const LEAD_LASTNAME_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'lastName', ''),
    NULLIF(${leads.data} ->> 'Nachname', ''),
    NULLIF(${leads.data} ->> 'nachname', ''),
    NULLIF(${leads.data} ->> 'last_name', '')
  )
`;

// Case-insensitive Lookup für E-Mail, Telefon und die Adress-Bestandteile.
// Die Reihenfolge spiegelt das gebräuchlichste Formular-Feld pro Mandant —
// `E-Mail` vor `email` vor `Email`. Leere Strings → NULL.
const LEAD_EMAIL_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'E-Mail', ''),
    NULLIF(${leads.data} ->> 'email', ''),
    NULLIF(${leads.data} ->> 'Email', ''),
    NULLIF(${leads.data} ->> 'e-mail', ''),
    NULLIF(${leads.data} ->> 'EMail', '')
  )
`;

const LEAD_PHONE_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'Telefon', ''),
    NULLIF(${leads.data} ->> 'telefon', ''),
    NULLIF(${leads.data} ->> 'phone', ''),
    NULLIF(${leads.data} ->> 'Phone', ''),
    NULLIF(${leads.data} ->> 'Tel', ''),
    NULLIF(${leads.data} ->> 'tel', '')
  )
`;

const LEAD_STREET_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'Strasse', ''),
    NULLIF(${leads.data} ->> 'strasse', ''),
    NULLIF(${leads.data} ->> 'strae', ''),
    NULLIF(${leads.data} ->> 'Straße', ''),
    NULLIF(${leads.data} ->> 'street', '')
  )
`;

const LEAD_ZIP_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'PLZ', ''),
    NULLIF(${leads.data} ->> 'plz', ''),
    NULLIF(${leads.data} ->> 'zip', ''),
    NULLIF(${leads.data} ->> 'postalCode', '')
  )
`;

const LEAD_CITY_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'Stadt', ''),
    NULLIF(${leads.data} ->> 'stadt', ''),
    NULLIF(${leads.data} ->> 'city', ''),
    NULLIF(${leads.data} ->> 'Ort', '')
  )
`;

const LEAD_COUNTRY_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'Land', ''),
    NULLIF(${leads.data} ->> 'land', ''),
    NULLIF(${leads.data} ->> 'country', '')
  )
`;

/**
 * Setzt "Strasse, PLZ Stadt[, Land]" aus den vier Bausteinen zusammen.
 * Leere Teile werden ausgelassen; ergibt der ganze String "—" wenn alles leer.
 */
function composeAddress(
  street: string | null,
  zip: string | null,
  city: string | null,
  country: string | null,
): string | null {
  const cityLine = [zip, city].filter(Boolean).join(" ").trim();
  const parts = [street, cityLine, country].filter(
    (p): p is string => !!p && p.length > 0,
  );
  if (parts.length === 0) return null;
  return parts.join(", ");
}

// Felder, die vor dem Ausliefern aus jedem Payload entfernt werden müssen
// (Privacy-Strip). Wir filtern in JS statt im SQL-`->>` damit der jsonb
// Roundtrip nicht mutiert und der DB-Cache trifft.
const PAYLOAD_STRIP_KEYS = new Set(["ipHash", "userAgent", "sessionId"]);

function stripPayload(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  let mutated = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PAYLOAD_STRIP_KEYS.has(k)) {
      mutated = true;
      continue;
    }
    out[k] = v;
  }
  // Auch wenn keine Strip-Keys gefunden wurden: wir reichen die Kopie raus,
  // damit Callers den DB-Buffer nicht versehentlich mutieren.
  void mutated;
  return out;
}

// ── Public-Lookup ────────────────────────────────────────────────────────────

/**
 * Lookup eines aktiven (nicht revoked) Shares per Token. Returnt nur die
 * Felder, die der Public-Endpoint zum Password-Check + Campaign-Routing
 * braucht. Keine Owner-Metadaten ausser `userId` (für Tenant-Guard in den
 * read-Queries).
 */
export async function getActiveShareByToken(
  token: string,
): Promise<ActiveShare | null> {
  // LEFT-JOIN auf campaigns (für domain_id) und user_domains (für hostname).
  // Der Domain-Join filtert auf `status = 'active'`, damit pending/failed
  // Domains keine Lead-URLs verseuchen — Fallback bleibt die Default-URL.
  const [row] = await db
    .select({
      id: campaignShares.id,
      campaignId: campaignShares.campaignId,
      userId: campaignShares.userId,
      passwordHash: campaignShares.passwordHash,
      label: campaignShares.label,
      lastAccessedAt: campaignShares.lastAccessedAt,
      campaignDomainHostname: userDomains.hostname,
    })
    .from(campaignShares)
    .leftJoin(campaigns, eq(campaigns.id, campaignShares.campaignId))
    .leftJoin(
      userDomains,
      and(
        eq(userDomains.id, campaigns.domainId),
        eq(userDomains.status, "active"),
      ),
    )
    .where(
      and(eq(campaignShares.token, token), isNull(campaignShares.revokedAt)),
    )
    .limit(1);
  return row ?? null;
}

// ── Public-Read: Leads / Events / Engagement ────────────────────────────────

/**
 * Listet alle nicht-entfernten Leads einer Kampagne mit ihren denormalisierten
 * Engagement-Aggregaten. Wird sowohl direkt (für eine "alle Leads"-Tabelle)
 * als auch indirekt von `listShareEngagement` benutzt.
 */
export async function listShareLeads(
  campaignId: string,
): Promise<ShareLeadRow[]> {
  const rows = await db
    .select({
      leadId: leads.id,
      slug: leads.slug,
      firstName: LEAD_FIRSTNAME_SQL.as("first_name"),
      lastName: LEAD_LASTNAME_SQL.as("last_name"),
      email: LEAD_EMAIL_SQL.as("email"),
      phone: LEAD_PHONE_SQL.as("phone"),
      street: LEAD_STREET_SQL.as("street"),
      zip: LEAD_ZIP_SQL.as("zip"),
      city: LEAD_CITY_SQL.as("city"),
      country: LEAD_COUNTRY_SQL.as("country"),
      runId: runs.id,
      runName: runs.name,
      status: leads.status,
      viewCount: leads.viewCount,
      firstViewedAt: leads.firstViewedAt,
      lastViewedAt: leads.lastViewedAt,
      playCount: leads.playCount,
      ctaClickCount: leads.ctaClickCount,
      lastCtaAt: leads.lastCtaAt,
      watchTimeSec: leads.watchTimeSec,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(eq(leads.campaignId, campaignId), isNull(leads.removedAt)),
    )
    .orderBy(desc(leads.createdAt));

  return rows.map((r) => ({
    leadId: r.leadId,
    slug: r.slug,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    address: composeAddress(r.street, r.zip, r.city, r.country),
    runId: r.runId,
    runName: r.runName,
    status: r.status,
    viewCount: r.viewCount ?? 0,
    firstViewedAt: r.firstViewedAt,
    lastViewedAt: r.lastViewedAt,
    playCount: r.playCount ?? 0,
    ctaClickCount: r.ctaClickCount ?? 0,
    lastCtaAt: r.lastCtaAt,
    watchTimeSec: r.watchTimeSec ?? 0,
    createdAt: r.createdAt,
  }));
}

/**
 * Listet alle aussortierten (soft-removed) Leads einer Kampagne — d.h. Leads
 * mit `removed_at IS NOT NULL`. Inverses Filter-Pendant zu `listShareLeads`.
 *
 * Tenant-Scope via JOIN auf `runs.campaign_id`; KEIN zusätzlicher User-Filter
 * nötig, weil der Caller bereits den Share-Auth-Schritt durchlaufen hat und
 * den `campaignId` aus dem Share-Row holt (siehe page.tsx).
 *
 * Sortierung: jüngste Entfernung zuerst (`removed_at DESC`).
 */
export async function listShareRemovedLeads(
  campaignId: string,
): Promise<ShareRemovedLeadRow[]> {
  const rows = await db
    .select({
      leadId: leads.id,
      firstName: LEAD_FIRSTNAME_SQL.as("first_name"),
      lastName: LEAD_LASTNAME_SQL.as("last_name"),
      email: LEAD_EMAIL_SQL.as("email"),
      phone: LEAD_PHONE_SQL.as("phone"),
      street: LEAD_STREET_SQL.as("street"),
      zip: LEAD_ZIP_SQL.as("zip"),
      city: LEAD_CITY_SQL.as("city"),
      country: LEAD_COUNTRY_SQL.as("country"),
      runId: runs.id,
      runName: runs.name,
      removedAt: leads.removedAt,
      removedReason: leads.removedReason,
      removedDetail: leads.removedDetail,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(eq(runs.campaignId, campaignId), isNotNull(leads.removedAt)),
    )
    .orderBy(desc(leads.removedAt));

  return rows.map((r) => ({
    leadId: r.leadId,
    runId: r.runId,
    runName: r.runName,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    address: composeAddress(r.street, r.zip, r.city, r.country),
    // Die `WHERE`-Bedingung filtert auf `removedAt IS NOT NULL` — der
    // non-null-assert ist daher safe und reflektiert die Domain-Invariante.
    removedAt: r.removedAt as Date,
    removedReason: (r.removedReason ?? null) as ShareRemovedReason | null,
    removedDetail: (r.removedDetail ?? null) as Record<string, unknown> | null,
  }));
}

interface ListShareEventsOptions {
  sinceTs?: Date;
  limit?: number;
}

/**
 * UNION der beiden Event-Quellen `lead_events` (neue Tracking-Pipeline) und
 * `analytics_events` (legacy), tenant-scoped via campaign_id der Leads.
 *
 * Jeder Event-Payload wird vor dem Return durch `stripPayload` geschickt,
 * damit `ipHash`/`userAgent`/`sessionId` niemals an die Public-Seite leakt.
 */
export async function listShareEvents(
  campaignId: string,
  opts: ListShareEventsOptions = {},
): Promise<ShareEventRow[]> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? SHARE_EVENT_DEFAULT_LIMIT),
    SHARE_EVENT_MAX_LIMIT,
  );
  const since = opts.sinceTs ?? null;
  const sinceIso = since ? since.toISOString() : null;

  // Whitelist als SQL-Array-Literal. Hart kodiert (kein Parameter) — siehe
  // `SHARE_ALLOWED_EVENT_KINDS`-Kommentar oben. Postgres' `= ANY(ARRAY[...])`
  // ist hier äquivalent zu `IN (...)`, lässt sich aber sauber in den
  // raw-SQL-Block einsetzen.
  const allowedKindsSql = sql.join(
    SHARE_ALLOWED_EVENT_KINDS.map((k) => sql`${k}`),
    sql`, `,
  );

  // Wir bauen die UNION als raw-SQL, damit beide Quellen mit identischen
  // Spalten zusammenkommen und Postgres die ORDER+LIMIT global auswerten
  // kann. Die Joins enforcen den Campaign-Tenant-Guard via runs.campaign_id.
  const rows = await db.execute<{
    id: string;
    source: ShareEventSource;
    kind: string;
    ts: Date;
    lead_id: string;
    lead_slug: string | null;
    lead_first_name: string | null;
    lead_last_name: string | null;
    run_name: string;
    payload: Record<string, unknown> | null;
  }>(sql`
    SELECT * FROM (
      SELECT
        ${leadEvents.id} AS id,
        'lead'::text AS source,
        ${leadEvents.kind} AS kind,
        ${leadEvents.ts} AS ts,
        ${leads.id} AS lead_id,
        ${leads.slug} AS lead_slug,
        ${LEAD_FIRSTNAME_SQL} AS lead_first_name,
        ${LEAD_LASTNAME_SQL} AS lead_last_name,
        ${runs.name} AS run_name,
        ${leadEvents.payload} AS payload
      FROM ${leadEvents}
      INNER JOIN ${leads} ON ${leads.id} = ${leadEvents.leadId}
      INNER JOIN ${runs} ON ${runs.id} = ${leads.runId}
      WHERE ${runs.campaignId} = ${campaignId}
        AND ${leads.removedAt} IS NULL
        AND ${leadEvents.kind} = ANY(ARRAY[${allowedKindsSql}]::text[])
        ${sinceIso ? sql`AND ${leadEvents.ts} > ${sinceIso}` : sql``}

      UNION ALL

      SELECT
        ${analyticsEvents.id} AS id,
        'analytics'::text AS source,
        ${analyticsEvents.eventType} AS kind,
        ${analyticsEvents.createdAt} AS ts,
        ${leads.id} AS lead_id,
        ${leads.slug} AS lead_slug,
        ${LEAD_FIRSTNAME_SQL} AS lead_first_name,
        ${LEAD_LASTNAME_SQL} AS lead_last_name,
        ${runs.name} AS run_name,
        ${analyticsEvents.eventData} AS payload
      FROM ${analyticsEvents}
      INNER JOIN ${leads} ON ${leads.id} = ${analyticsEvents.leadId}
      INNER JOIN ${runs} ON ${runs.id} = ${leads.runId}
      WHERE ${runs.campaignId} = ${campaignId}
        AND ${leads.removedAt} IS NULL
        AND ${analyticsEvents.eventType} = ANY(ARRAY[${allowedKindsSql}]::text[])
        ${sinceIso ? sql`AND ${analyticsEvents.createdAt} > ${sinceIso}` : sql``}
    ) u
    ORDER BY u.ts DESC
    LIMIT ${limit}
  `);

  // postgres.js gibt das Ergebnis von `db.execute` als Array-ähnliche
  // Struktur zurück. Wir normalisieren explizit.
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];

  return (list as Array<{
    id: string;
    source: ShareEventSource;
    kind: string;
    ts: Date | string;
    lead_id: string;
    lead_slug: string | null;
    lead_first_name: string | null;
    lead_last_name: string | null;
    run_name: string;
    payload: unknown;
  }>).map((r) => ({
    id: r.id,
    source: r.source,
    kind: r.kind,
    ts: r.ts instanceof Date ? r.ts : new Date(r.ts),
    leadId: r.lead_id,
    leadSlug: r.lead_slug,
    leadFirstName: r.lead_first_name,
    leadLastName: r.lead_last_name,
    runName: r.run_name,
    payload: stripPayload(r.payload),
  }));
}

/**
 * Engagement-Buckets für die Public-Share-Ansicht: alle Leads, die mindestens
 * die LP geöffnet haben, sowie alle Leads, die das Video gestartet haben.
 * Reuse von `listShareLeads` damit die Filter-/Sortier-Logik konsistent
 * bleibt.
 */
export async function listShareEngagement(
  campaignId: string,
): Promise<ShareEngagement> {
  const all = await listShareLeads(campaignId);
  const opened = all
    .filter((l) => (l.viewCount ?? 0) > 0)
    .sort((a, b) => {
      const at = a.firstViewedAt ? a.firstViewedAt.getTime() : 0;
      const bt = b.firstViewedAt ? b.firstViewedAt.getTime() : 0;
      return bt - at;
    });
  const played = all
    .filter((l) => (l.playCount ?? 0) > 0)
    .sort((a, b) => {
      const at = a.lastViewedAt ? a.lastViewedAt.getTime() : 0;
      const bt = b.lastViewedAt ? b.lastViewedAt.getTime() : 0;
      return bt - at;
    });
  const clicked = all
    .filter((l) => (l.ctaClickCount ?? 0) > 0)
    .sort((a, b) => {
      const at = a.lastCtaAt ? a.lastCtaAt.getTime() : 0;
      const bt = b.lastCtaAt ? b.lastCtaAt.getTime() : 0;
      return bt - at;
    });
  return { opened, played, clicked };
}

// ── Rate-Limit + Audit-Log ───────────────────────────────────────────────────

/**
 * Anzahl der Fehlversuche (`ok = false`) für (token, ipHash) im Fenster der
 * letzten `windowMinutes`. Verteidigt gegen Brute-Force ohne raw-IP zu
 * speichern.
 */
export async function getRecentFailedAttemptCount(
  token: string,
  ipHash: string,
  windowMinutes = 15,
): Promise<number> {
  const sinceIso = new Date(
    Date.now() - windowMinutes * 60 * 1000,
  ).toISOString();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignShareAttempts)
    .where(
      and(
        eq(campaignShareAttempts.token, token),
        eq(campaignShareAttempts.ipHash, ipHash),
        eq(campaignShareAttempts.ok, false),
        sql`${campaignShareAttempts.ts} >= ${sinceIso}`,
      ),
    );
  return row?.count ?? 0;
}

/** Append-only Audit-Log. Single insert, fire-and-forget seitens des Callers. */
export async function recordAttempt(
  token: string,
  ipHash: string,
  ok: boolean,
): Promise<void> {
  await db.insert(campaignShareAttempts).values({ token, ipHash, ok });
}

/** Setzt `last_accessed_at = now()` auf dem Share-Row. */
export async function updateShareLastAccessed(shareId: string): Promise<void> {
  await db
    .update(campaignShares)
    .set({ lastAccessedAt: new Date() })
    .where(eq(campaignShares.id, shareId));
}

// ── Owner-API: Liste / Erstellen / Sperren ──────────────────────────────────

/**
 * Listet aktive (nicht revoked) Shares einer Kampagne — tenant-guarded via
 * `userId`, damit ein User keine fremden Share-Listings sieht.
 */
export async function listSharesForCampaign(
  campaignId: string,
  userId: string,
): Promise<ShareSummaryRow[]> {
  const rows = await db
    .select({
      id: campaignShares.id,
      token: campaignShares.token,
      label: campaignShares.label,
      createdAt: campaignShares.createdAt,
      lastAccessedAt: campaignShares.lastAccessedAt,
    })
    .from(campaignShares)
    .where(
      and(
        eq(campaignShares.campaignId, campaignId),
        eq(campaignShares.userId, userId),
        isNull(campaignShares.revokedAt),
      ),
    )
    .orderBy(desc(campaignShares.createdAt));
  return rows;
}

export interface CreateShareInput {
  campaignId: string;
  userId: string;
  password: string;
  label?: string | null;
}

export interface CreateShareResult {
  id: string;
  token: string;
}

/**
 * Legt einen neuen Share-Link an. Verifiziert Campaign-Ownership inline
 * (wirft `Error("Not found")` bei Mismatch), hash't das Passwort via
 * Argon2id, und retry't bis zu 5x bei (extrem unwahrscheinlicher) Token-
 * Kollision.
 */
export async function createShare(
  opts: CreateShareInput,
): Promise<CreateShareResult> {
  // Tenant-Guard auf Campaign — KEIN Soft-Delete-Filter, damit ein Owner
  // einer gerade gelöschten Kampagne nicht zufällig einen Share zur
  // gleichen ID auf eine Bestand-Soft-Deleted-Kampagne anlegt.
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, opts.campaignId),
        eq(campaigns.userId, opts.userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);
  if (!campaign) {
    throw new Error("Not found");
  }

  const passwordHash = await hashPassword(opts.password);

  for (let attempt = 0; attempt < CREATE_SHARE_MAX_ATTEMPTS; attempt += 1) {
    const token = generateShareToken();
    try {
      const [row] = await db
        .insert(campaignShares)
        .values({
          campaignId: opts.campaignId,
          userId: opts.userId,
          token,
          passwordHash,
          label: opts.label ?? null,
        })
        .returning({ id: campaignShares.id, token: campaignShares.token });
      if (row) return { id: row.id, token: row.token };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Bei Token-Kollision (race): nächsten Versuch.
      if (
        msg.includes("campaign_shares_token_uq") ||
        msg.includes("duplicate key") ||
        msg.includes("unique")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Token-Generierung fehlgeschlagen (Kollisionen).");
}

/**
 * Sperrt einen Share durch Setzen von `revoked_at`. Tenant-guarded via
 * `userId`. Idempotent: gibt `false` zurück, wenn der Share bereits
 * revoked oder unbekannt ist; `true` bei erfolgreicher Sperrung.
 */
export async function revokeShare(
  shareId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(campaignShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(campaignShares.id, shareId),
        eq(campaignShares.userId, userId),
        isNull(campaignShares.revokedAt),
      ),
    )
    .returning({ id: campaignShares.id });
  return result.length > 0;
}
