import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, leadSlugAliases, runs } from "@/lib/db/schema";
import type { RemovedDetail, RemovedReason } from "@/lib/db/schema";
import type {
  PreflightCounts,
  PreflightLeadRow,
  PreflightStatus,
} from "@/lib/preflight/types";
import { PREFLIGHT_PROBLEMATIC_STATUSES } from "@/lib/preflight/types";
import { enqueueWebhooksForLeadCreated } from "@/lib/webhooks/lead-event-hook";

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

/**
 * Public-facing Lead-Shape für die LP-Render-Hot-Path. Identisch zu `Lead`,
 * verengt aber `videoOrientation` von `string | null` (Drizzle-Mapping einer
 * `text`-Spalte mit CHECK-Constraint) auf das tatsaechlich erlaubte Tupel
 * `'landscape' | 'portrait' | 'square' | null`. Die Page-Schicht kann so
 * direkt `lead.videoOrientation === 'portrait'` switchen, ohne nochmal
 * runtime-typischen Validation-Code zu schreiben.
 */
export type PublicLead = Omit<Lead, "videoOrientation"> & {
  videoOrientation: "landscape" | "portrait" | "square" | null;
};

/**
 * Verengt das nullable text-Feld auf die erlaubten Aspect-Tokens. Werte die
 * nicht im erlaubten Tupel liegen werden auf `null` heruntergefallen — der
 * CHECK-Constraint in der DB sollte das eigentlich verhindern, aber wir
 * defensiven hier doppelt um die LP-Render-Schicht stabil zu halten.
 */
function projectPublicLead(row: Lead | null): PublicLead | null {
  if (!row) return null;
  const orientation =
    row.videoOrientation === "landscape" ||
    row.videoOrientation === "portrait" ||
    row.videoOrientation === "square"
      ? row.videoOrientation
      : null;
  return { ...row, videoOrientation: orientation };
}

export interface BulkLeadRow {
  rowIndex: number;
  data: Record<string, string>;
}

export type UpdateLeadPatch = Partial<Omit<Lead, "id" | "runId" | "createdAt">>;

/**
 * Bulk-Insert von Leads für einen Run.
 *
 * Die denormalisierte `campaignId` auf jedem Lead-Row (Migration 0014) wird
 * automatisch aus `runs.campaign_id` per Sub-Select gefüllt, falls der Caller
 * sie nicht explizit übergibt. Ein expliziter `campaignId`-Parameter spart den
 * Sub-Select pro Row und ist der bevorzugte Pfad, weil der Caller die ID
 * üblicherweise eh schon in der Hand hat (z.B. aus dem Auth-/Run-Kontext).
 */
export async function bulkInsertLeads(
  runId: string,
  rows: BulkLeadRow[],
  campaignId?: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  // `leads.campaign_id` ist NOT NULL (Migration 0014). Wir holen die ID
  // vorab via Sub-Query, wenn der Caller sie nicht uebergeben hat — ein
  // inline `sql` Helper im .values() wird von Drizzle nicht zuverlaessig
  // als Spaltenwert gerendert (das war der Grund fuer das `null value`-
  // Failing).
  let resolvedCampaignId = campaignId;
  if (!resolvedCampaignId) {
    const [row] = await db
      .select({ campaignId: runs.campaignId })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (!row) throw new Error(`bulkInsertLeads: run ${runId} not found`);
    resolvedCampaignId = row.campaignId;
  }
  const inserted = await db
    .insert(leads)
    .values(
      rows.map((r) => ({
        runId,
        campaignId: resolvedCampaignId!,
        rowIndex: r.rowIndex,
        data: r.data,
      })),
    )
    .returning({ id: leads.id });
  // Outgoing-Webhook-Hook: feuert `lead.created` für jeden neu
  // eingefügten Lead. Lead-Erzeugung ist selten (CSV-Bulk-Insert) und
  // pro-Lead-Cost ist akzeptabel. Fire-and-forget; nie blocking.
  if (inserted.length > 0) {
    void enqueueWebhooksForLeadCreated({
      leadIds: inserted.map((r) => r.id),
    });
  }
  return inserted.length;
}

/**
 * Checkt ob ein Slug in der angegebenen Kampagne bereits existiert — scope-
 * korrekt nach Default- (`domainId IS NULL`) bzw. Custom-Domain-Namespace.
 *
 * `excludeLeadId`: wenn gesetzt, wird dieser Lead ignoriert (z.B. wenn der
 * Lead selbst gerade neu vergibt und sein eigener alter Slug nicht als
 * Kollision zählen soll — Retry-Idempotenz).
 *
 * Active-only:
 *   - Leads, deren Run soft-deleted ist (`runs.deleted_at IS NOT NULL`),
 *     dürfen den Namespace NICHT mehr blockieren. Vor Migration 0023 hat
 *     der Run-Delete nur `deleted_at` gesetzt; die Lead-Rows blieben mit
 *     ihren Slugs in der Tabelle und sorgten für falsche `-2`/`-3`-
 *     Suffixe in neuen Runs derselben Kampagne. Ab 0023 löscht der
 *     Delete-Endpoint hart — die Bestandsorphans bleiben aber bis zum
 *     Cleanup-Sweep liegen, und der Filter hier hält den Slug-Namespace
 *     trotzdem sauber.
 *   - Soft-removed Leads (`leads.removed_at IS NOT NULL`, z.B. via
 *     Preflight-Reject / Duplicate / User-Reject) blockieren den Slug
 *     ebenfalls nicht mehr. Ihre Slugs sind aus User-Sicht nicht
 *     vergeben.
 *
 * Tenant-Sicherheit: der Slug-Namespace ist seit Migration 0014
 * campaign-scoped (`leads.campaign_id`); Leads anderer Kampagnen bleiben
 * ausgeschlossen wie bisher.
 *
 * Returns: `{ id }` des kollidierenden Leads, oder `null` wenn der Slug frei
 * ist. Caller entscheidet, ob die ID weiterverwendet wird (Logging, Retry).
 */
export async function findSlugInCampaign(
  campaignId: string,
  slug: string,
  domainId: string | null,
  excludeLeadId?: string,
): Promise<{ id: string } | null> {
  const conditions = [
    eq(leads.campaignId, campaignId),
    eq(leads.slug, slug),
    domainId ? eq(leads.domainId, domainId) : isNull(leads.domainId),
    // Nur lebende Leads zählen — Soft-Remove (Preflight/Duplicate/User-
    // Reject) gibt den Slug-Namespace wieder frei.
    isNull(leads.removedAt),
  ];
  if (excludeLeadId) conditions.push(ne(leads.id, excludeLeadId));
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    // JOIN auf runs, um Bestands-Orphans aus soft-deleted Runs aus dem
    // Namespace rauszufiltern (Pre-0023-Hangover). innerJoin ist hier
    // korrekt — ein Lead ohne validen Run-Parent existiert nicht
    // (FK NOT NULL).
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(...conditions, isNull(runs.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function updateLeadStatus(
  id: string,
  patch: UpdateLeadPatch,
): Promise<Lead> {
  const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Resolves a slug on the platform default domain (`app.videocomet.de`).
 *
 * TENANT-SAFETY: only matches leads with `domain_id IS NULL`. Leads pinned
 * to a customer Custom-Domain MUST NOT be reachable via the default-domain
 * URL — otherwise a slug collision between User-A's Custom-Domain lead and
 * User-B's default-domain lead leaks A's lead to anyone hitting
 * `app.videocomet.de/v/<slug>` (cross-tenant data leak).
 *
 * Custom-Domain lookups go through `getLeadBySlugAndDomain` instead.
 */
export async function getLeadBySlugForDefaultDomain(
  slug: string,
): Promise<PublicLead | null> {
  // Wir holen bewusst BIS ZU 2 Treffer um Slug-Kollisionen zwischen
  // Kampagnen desselben Users (campaign-scoped Uniqueness seit
  // Migration 0014 erlaubt das) zu erkennen. Wenn mehrere Kampagnen
  // denselben Slug haben, ist das fuer die LP-Aufloesung gefaehrlich —
  // wir nehmen technisch den neusten, aber loggen es als Indikator
  // damit Monitoring/Alarm das mitkriegt.
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.slug, slug), isNull(leads.domainId)))
    .orderBy(desc(leads.createdAt))
    .limit(2);
  if (rows.length > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      "[leads-lookup] slug-collision on default-domain — newer lead served",
      {
        slug,
        winner: { id: rows[0]!.id, campaignId: rows[0]!.campaignId },
        loser: { id: rows[1]!.id, campaignId: rows[1]!.campaignId },
      },
    );
  }
  if (rows[0]) return projectPublicLead(rows[0]);

  // Fallback: Alias-Table durchsuchen (alter Slug aus gedrucktem QR).
  // Wenn Match: aktuellen Lead holen und servieren. Der Aufrufer koennte
  // optional 301-redirecten auf leads.slug (siehe route.ts:/v/[slug]).
  const [alias] = await db
    .select({ leadId: leadSlugAliases.leadId })
    .from(leadSlugAliases)
    .where(
      and(
        eq(leadSlugAliases.slug, slug),
        isNull(leadSlugAliases.domainId),
        or(
          isNull(leadSlugAliases.expiresAt),
          gt(leadSlugAliases.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  if (!alias) return null;
  const [aliasLead] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, alias.leadId))
    .limit(1);
  return projectPublicLead(aliasLead ?? null);
}

/**
 * Resolves a slug WITHIN a specific custom-domain. Used by the public-page
 * route when a request hits one of the customer's own domains — the slug
 * is only unique within `(domain_id, slug)`, not globally.
 *
 * Returns null if no lead matches OR the matched lead doesn't belong to
 * the given domain. The `eq(leads.domainId, domainId)` filter also makes
 * sure a default-domain lead (`domainId IS NULL`) can never be served
 * through a Custom-Domain hit.
 */
export async function getLeadBySlugAndDomain(
  slug: string,
  domainId: string,
): Promise<PublicLead | null> {
  // Genau wie bei der Default-Domain holen wir BIS ZU 2 Treffer um
  // Slug-Kollisionen zwischen Kampagnen DERSELBEN Custom-Domain zu
  // erkennen. Ein Custom-Domain-Owner darf eine Domain mit mehreren
  // Kampagnen teilen — wenn dabei Slugs kollidieren ist das ein
  // Konfigurations-Issue der gemeldet werden sollte.
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.slug, slug), eq(leads.domainId, domainId)))
    .orderBy(desc(leads.createdAt))
    .limit(2);
  if (rows.length > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      "[leads-lookup] slug-collision on custom-domain — newer lead served",
      {
        slug,
        domainId,
        winner: { id: rows[0]!.id, campaignId: rows[0]!.campaignId },
        loser: { id: rows[1]!.id, campaignId: rows[1]!.campaignId },
      },
    );
  }
  if (rows[0]) return projectPublicLead(rows[0]);

  // Fallback: Alias-Table durchsuchen (alter Slug aus gedrucktem QR).
  const [alias] = await db
    .select({ leadId: leadSlugAliases.leadId })
    .from(leadSlugAliases)
    .where(
      and(
        eq(leadSlugAliases.slug, slug),
        eq(leadSlugAliases.domainId, domainId),
        or(
          isNull(leadSlugAliases.expiresAt),
          gt(leadSlugAliases.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  if (!alias) return null;
  const [aliasLead] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, alias.leadId))
    .limit(1);
  return projectPublicLead(aliasLead ?? null);
}

export async function listLeadsByRun(runId: string, userId: string): Promise<Lead[]> {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        // Im Preflight rejected → in Run-Detail, CSV-Export und PDF-Bundle
        // unsichtbar. Audit-Trail bleibt in der DB.
        isNull(leads.removedAt),
      ),
    )
    .orderBy(asc(leads.rowIndex));
  return rows.map((r) => r.lead);
}

/**
 * Liefert die fertig gerenderten Leads eines Runs in *deterministischer*
 * Reihenfolge, die sowohl der PDF-Merge als auch die XLSX-Spalten für das
 * Bulk-Export-Bundle identisch verwenden. Wichtig, damit die n-te Excel-Zeile
 * dem n-ten gemergten PDF-Eintrag entspricht.
 *
 * Filter:
 *   - `status = 'completed'`
 *   - `pdf_url IS NOT NULL` (kein PDF generiert → kann nicht gebundelt werden)
 *   - `removed_at IS NULL` (soft-deleted Leads bleiben aussen vor)
 *
 * Tenant-Guard via JOIN auf `runs.user_id`.
 *
 * Sortier-Schluessel:
 *   1. `row_index ASC`  — CSV-Reihenfolge (Hauptkriterium)
 *   2. `created_at ASC` — Tie-Break wenn zwei Leads gleiche Zeile haben
 *      (legacy-Daten, Re-Runs etc.)
 *   3. `id ASC`         — letzte Garantie fuer absolute Determinismus
 */
export async function getCompletedLeadsForBundle(
  runId: string,
  userId: string,
): Promise<Lead[]> {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        eq(leads.status, "completed"),
        isNotNull(leads.pdfUrl),
        isNull(leads.removedAt),
      ),
    )
    .orderBy(asc(leads.rowIndex), asc(leads.createdAt), asc(leads.id));
  return rows.map((r) => r.lead);
}

export async function countByStatus(
  runId: string,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: leads.status,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
      ),
    )
    .groupBy(leads.status);

  const result: Record<string, number> = {
    pending: 0,
    rendering: 0,
    uploading: 0,
    completed: 0,
    failed: 0,
  };
  for (const r of rows) {
    result[r.status] = r.count ?? 0;
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// ── Preflight / Lead-Quality-Check ────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

/**
 * Liefert alle nicht-soft-deleted Leads eines Runs für den Inline-Validation-
 * Pass beim Preflight-Start. Tenant-Guard über `runs.userId`.
 */
export async function getLeadsForPreflightStart(
  runId: string,
  userId: string,
): Promise<Array<{ id: string; rowIndex: number; data: Record<string, string> }>> {
  const rows = await db
    .select({ id: leads.id, rowIndex: leads.rowIndex, data: leads.data })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
      ),
    )
    .orderBy(asc(leads.rowIndex));
  return rows;
}

export interface PreflightStatusUpdate {
  leadId: string;
  status: PreflightStatus;
  duplicateOfLeadId?: string | null;
  errorMessage?: string | null;
}

/**
 * Setzt den Preflight-Status atomisch für eine Liste von Leads. Wird vom
 * Start-Endpunkt aufgerufen, um die durch die Inline-Validation bereits
 * disqualifizierten Leads (missing_field / duplicate) in einem Transaktions-
 * Aufruf zu markieren — ohne dass ein Worker je einen Job für sie sieht.
 *
 * Die `preflight_completed_at` wird automatisch auf NOW() gesetzt, weil
 * disqualifizierte Leads aus Sicht der Pipeline „erledigt" sind.
 */
export async function bulkSetPreflightStatus(
  updates: PreflightStatusUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;
  let count = 0;
  // Drizzle hat kein natives Bulk-Update-with-Different-Values; CASE-WHEN
  // wäre möglich, aber bei <= 500 Leads sind individuelle Updates innerhalb
  // einer Transaktion einfach lesbarer und immer noch <100ms.
  await db.transaction(async (tx) => {
    for (const u of updates) {
      const res = await tx
        .update(leads)
        .set({
          preflightStatus: u.status,
          preflightCompletedAt: new Date(),
          duplicateOfLeadId: u.duplicateOfLeadId ?? null,
          preflightErrorMessage: u.errorMessage ?? null,
        })
        .where(eq(leads.id, u.leadId))
        .returning({ id: leads.id });
      count += res.length;
    }
  });
  return count;
}

/**
 * Liefert alle Leads eines Runs für die Quality-Check-UI. Sortiert
 * problematische Leads (nicht-`ok`-Stati) zuerst, damit der User direkt
 * mit den Problemfällen anfangen kann. Innerhalb jeder Gruppe nach
 * `rowIndex` (also CSV-Reihenfolge).
 *
 * Liefert auch soft-deleted Leads (`removedAt IS NOT NULL`), damit die UI
 * "entfernt"-Banner anzeigen und Undo erlauben kann.
 */
export async function listPreflightLeads(
  runId: string,
  userId: string,
): Promise<PreflightLeadRow[]> {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .orderBy(
      // "ok" zuletzt, alles andere zuerst; innerhalb jeder Gruppe nach
      // rowIndex aufsteigend.
      sql`CASE WHEN ${leads.preflightStatus} = 'ok' THEN 1 ELSE 0 END`,
      asc(leads.rowIndex),
    );

  return rows.map(({ lead }) => projectPreflightLead(lead));
}

function projectPreflightLead(l: typeof leads.$inferSelect): PreflightLeadRow {
  const data = (l.data ?? {}) as Record<string, unknown>;
  // Normalisiertes Lookup — Bindestriche/Unterstriche/Spaces werden für
  // den Match ignoriert. Damit greift `Website-URL` auf den Alias
  // `websiteUrl`, `vor_name` auf `Vorname` etc.
  const normalise = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalisedData = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim().length > 0) {
      normalisedData.set(normalise(k), v.trim());
    }
  }
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = data[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    for (const k of keys) {
      const v = normalisedData.get(normalise(k));
      if (v) return v;
    }
    return null;
  };
  return {
    id: l.id,
    runId: l.runId,
    rowIndex: l.rowIndex,
    firstName: pick(["firstName", "Vorname", "first_name"]),
    lastName: pick(["lastName", "Nachname", "last_name"]),
    fullName: pick(["fullName", "Name", "full_name"]),
    companyName: pick(["companyName", "company", "Firma", "company_name"]),
    websiteUrl: pick([
      "websiteUrl",
      "website",
      "Webseite",
      "url",
      "URL",
      "Website",
    ]),
    preflightStatus: l.preflightStatus,
    preflightFinalUrl: l.preflightFinalUrl,
    preflightHttpStatus: l.preflightHttpStatus,
    preflightDurationMs: l.preflightDurationMs,
    preflightErrorMessage: l.preflightErrorMessage,
    preflightScreenshotUrl: l.preflightScreenshotUrl,
    preflightAttempts: l.preflightAttempts,
    duplicateOfLeadId: l.duplicateOfLeadId,
    removedAt: l.removedAt ? l.removedAt.toISOString() : null,
    approvedAt: l.approvedAt ? l.approvedAt.toISOString() : null,
  };
}

/**
 * Soft-Delete einer Liste von Leads. Idempotent — bereits entfernte Leads
 * werden silent geskipt (WHERE `removed_at IS NULL`). Tenant-Guard über
 * Korrelation auf den parent-Run.
 *
 * Returns: Anzahl tatsächlich frisch entfernter Leads (also <= leadIds.length).
 */
export async function markLeadsRemoved(
  leadIds: string[],
  runId: string,
  userId: string,
  reason: "user_rejected" | "auto_failed" | "duplicate",
): Promise<number> {
  if (leadIds.length === 0) return 0;
  // Existence-Check über Sub-Select sicherer als Multi-Table-Update, weil
  // postgres Multi-Table-Updates über FROM klingen syntaktisch fragil sind.
  const ownedIds = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.id, leadIds),
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
      ),
    );
  const ids = ownedIds.map((r) => r.id);
  if (ids.length === 0) return 0;
  const updated = await db
    .update(leads)
    .set({ removedAt: new Date(), removedReason: reason })
    .where(inArray(leads.id, ids))
    .returning({ id: leads.id });
  return updated.length;
}

/**
 * Soft-Remove mit strukturiertem `removedDetail` (Migration 0021). Wird
 * vom Start-Endpoint nach `bulkInsertLeads` aufgerufen, um die vom
 * `detectDuplicates`-Engine erkannten Duplikate aus der Verarbeitung zu
 * nehmen, OHNE den Audit-Trail zu verlieren.
 *
 * Im Gegensatz zu `markLeadsRemoved`:
 *   - akzeptiert beliebige `RemovedReason`-Werte (nicht das eingeschränkte
 *     Tupel der UI-Reject-Pfade)
 *   - schreibt `removed_detail` (jsonb) mit der vom Caller gelieferten
 *     strukturierten Payload (z.B. `matchedRule` + `duplicateOfRowIndex`)
 *
 * Tenant-Guard via Sub-Select auf `runs.userId`. Idempotent — bereits
 * entfernte Leads werden geskipt.
 *
 * Returns: Anzahl tatsächlich frisch entfernter Leads.
 */
export async function softRemoveLeads(
  leadIds: string[],
  runId: string,
  userId: string,
  reason: RemovedReason,
  detailByLeadId: Map<string, RemovedDetail>,
): Promise<number> {
  if (leadIds.length === 0) return 0;
  const ownedIds = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.id, leadIds),
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
      ),
    );
  const ids = ownedIds.map((r) => r.id);
  if (ids.length === 0) return 0;

  // Drizzle hat kein natives Bulk-Update-with-Different-Values. Da die
  // Anzahl Duplikate üblicherweise <= einige hundert ist, sind Pro-ID-
  // Updates in einer Transaktion (<100ms) der einfachste Pfad.
  let updated = 0;
  await db.transaction(async (tx) => {
    const now = new Date();
    for (const id of ids) {
      // Caller MUSS für jeden Lead ein passendes Detail liefern. Fehlt es,
      // schreiben wir NULL statt einer reason-only-Stub-Form — die
      // discriminated-union zwingt sonst eine Verengung auf "no-payload"-
      // Reasons (pipeline_failed/user_rejected/auto_failed), und das ist
      // nicht das was der Caller (z.B. Dedupe mit 'duplicate') will.
      const detail = detailByLeadId.get(id) ?? null;
      const res = await tx
        .update(leads)
        .set({
          removedAt: now,
          removedReason: reason,
          removedDetail: detail,
        })
        .where(eq(leads.id, id))
        .returning({ id: leads.id });
      updated += res.length;
    }
  });
  return updated;
}

/**
 * Atomic Approval-Schritt. Setzt `approved_at = NOW()` auf alle nicht-removed
 * Leads des Runs.
 *
 * Standard: nur Leads mit `preflight_status = 'ok'` werden approved.
 *
 * Wenn `approveAlsoProblematic` true ist, werden auch die Leads mit
 * terminalen Fehler-Stati approved (User-Override: "ich weiß, dass die
 * URL down ist, will den Lead trotzdem rendern"). `pending`/`running`-Leads
 * werden NIE approved, weil die Phase 1 für die noch nicht abgeschlossen ist.
 */
export async function approveLeads(
  runId: string,
  userId: string,
  options: { approveAlsoProblematic: boolean },
): Promise<{ approvedCount: number }> {
  // Eligible: nicht-removed UND in einem terminalen Status (also nicht
  // mehr pending/running).
  const allowedStatuses: PreflightStatus[] = options.approveAlsoProblematic
    ? ["ok", ...PREFLIGHT_PROBLEMATIC_STATUSES]
    : ["ok"];

  // Tenant-Guard: erst über JOIN die Lead-IDs holen, dann update by id.
  const ownedIds = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
        isNull(leads.approvedAt),
        inArray(leads.preflightStatus, allowedStatuses),
      ),
    );
  if (ownedIds.length === 0) return { approvedCount: 0 };
  const ids = ownedIds.map((r) => r.id);

  const updated = await db
    .update(leads)
    .set({ approvedAt: new Date() })
    .where(inArray(leads.id, ids))
    .returning({ id: leads.id });
  return { approvedCount: updated.length };
}

/**
 * Single-Query GROUP-BY auf preflight_status. "problematic" = jeder
 * terminal-Status, der nicht `ok` ist (also alle echten Fehler-Stati).
 * `removed` zählt soft-deleted Leads unabhängig vom Preflight-Status.
 */
export async function getPreflightCounts(
  runId: string,
  userId: string,
): Promise<PreflightCounts> {
  const rows = await db
    .select({
      status: leads.preflightStatus,
      count: sql<number>`count(*)::int`,
      removed: sql<number>`count(*) FILTER (WHERE ${leads.removedAt} IS NOT NULL)::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .groupBy(leads.preflightStatus);

  const counts: PreflightCounts = {
    pending: 0,
    running: 0,
    ok: 0,
    problematic: 0,
    removed: 0,
    total: 0,
  };
  for (const r of rows) {
    const c = r.count ?? 0;
    counts.total += c;
    counts.removed += r.removed ?? 0;
    if (r.status === "pending") counts.pending += c;
    else if (r.status === "running") counts.running += c;
    else if (r.status === "ok") counts.ok += c;
    else counts.problematic += c;
  }
  return counts;
}

/**
 * Setzt einen einzelnen Lead zurück auf `preflight_status = 'pending'` und
 * inkrementiert `preflight_attempts`. Wird vom retry-screenshot-Endpoint
 * verwendet, um einen erneuten Worker-Run zu erzwingen. Tenant-Guard via
 * Sub-Select.
 *
 * Returns: das aktualisierte Row oder null (nicht-existent / nicht owned).
 */
export async function resetLeadForPreflightRetry(
  leadId: string,
  runId: string,
  userId: string,
): Promise<{ id: string; preflightAttempts: number } | null> {
  const [owned] = await db
    .select({ id: leads.id, attempts: leads.preflightAttempts })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.id, leadId),
        eq(leads.runId, runId),
        eq(runs.userId, userId),
      ),
    )
    .limit(1);
  if (!owned) return null;
  const [updated] = await db
    .update(leads)
    .set({
      preflightStatus: "pending",
      preflightAttempts: (owned.attempts ?? 0) + 1,
      preflightErrorMessage: null,
      preflightCompletedAt: null,
    })
    .where(eq(leads.id, leadId))
    .returning({
      id: leads.id,
      preflightAttempts: leads.preflightAttempts,
    });
  return updated ?? null;
}

/**
 * Listet alle Leads eines Runs, deren `updated`-relevanten Felder seit
 * `sinceTs` verändert wurden — Basis für das SSE-Diff. Verändert =
 * `preflight_completed_at > sinceTs` ODER aktuell in `running`-Status
 * (analog zur In-Flight-Logik im bestehenden /stream-Endpoint).
 */
export async function listChangedPreflightLeads(
  runId: string,
  userId: string,
  sinceTs: Date,
): Promise<PreflightLeadRow[]> {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        sql`(${leads.preflightCompletedAt} > ${sinceTs} OR ${leads.preflightStatus} = 'running')`,
      ),
    )
    .orderBy(asc(leads.rowIndex));
  return rows.map((r) => projectPreflightLead(r.lead));
}

// ───────────────────────────────────────────────────────────────────────────
// ── Lead-Export "Nicht durchgegangen" (Paket D) ───────────────────────────
// ───────────────────────────────────────────────────────────────────────────

/**
 * Schmale Row-Shape für den Excluded-Leads-Export. Enthält genau die Felder,
 * die der Export braucht, um pro Lead eine menschenlesbare Begründung zu
 * synthetisieren — ohne die volle `Lead`-Shape durch die Route zu schleifen.
 */
export interface ExcludedLeadRow {
  id: string;
  rowIndex: number;
  data: Record<string, string>;
  status: Lead["status"];
  errorMessage: string | null;
  removedAt: Date | null;
  removedReason: RemovedReason | null;
  removedDetail: RemovedDetail | null;
  preflightStatus: string;
  preflightErrorMessage: string | null;
}

/**
 * Listet alle "nicht durchgegangenen" Leads eines Runs für den XLSX-Export.
 *
 * "Nicht durchgegangen" = entweder soft-deleted (`removed_at IS NOT NULL`,
 * z.B. via Preflight-Reject / Duplikat / User-Reject) ODER pipeline-failed
 * (`status='failed'` ohne explizites Remove — der Lead steckt also rohstatus-
 * mäßig im Fehler-Bucket, wird vom Standard-Export aber bereits ausgefiltert).
 *
 * Tenant-Guard über JOIN auf `runs.user_id`.
 */
export async function listExcludedLeadsByRun(
  runId: string,
  userId: string,
): Promise<ExcludedLeadRow[]> {
  const rows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      data: leads.data,
      status: leads.status,
      errorMessage: leads.errorMessage,
      removedAt: leads.removedAt,
      removedReason: leads.removedReason,
      removedDetail: leads.removedDetail,
      preflightStatus: leads.preflightStatus,
      preflightErrorMessage: leads.preflightErrorMessage,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        or(isNotNull(leads.removedAt), eq(leads.status, "failed")),
      ),
    )
    .orderBy(asc(leads.rowIndex));

  return rows.map((r) => ({
    id: r.id,
    rowIndex: r.rowIndex,
    data: (r.data ?? {}) as Record<string, string>,
    status: r.status,
    errorMessage: r.errorMessage,
    removedAt: r.removedAt,
    removedReason: r.removedReason,
    removedDetail: r.removedDetail,
    preflightStatus: r.preflightStatus,
    preflightErrorMessage: r.preflightErrorMessage,
  }));
}

/**
 * Aggregierte Zähler pro Ausschluss-Grund. Wird vom Run-Detail UI (Paket D)
 * für die Stats-Pille genutzt: "17 entfernt (12 Duplikate · 3 Pipeline · 2
 * unvollständig)".
 *
 * `pipelineFailed` zählt zwei Quellen: (a) leads mit `removed_reason =
 * 'pipeline_failed'`, (b) leads mit `status='failed'` UND `removed_at IS
 * NULL` (Roh-Pipeline-Fehler, die der Sweeper noch nicht soft-deleted hat).
 */
export interface ExclusionCounts {
  duplicate: number;
  pipelineFailed: number;
  incompleteData: number;
  userRejected: number;
  other: number;
  total: number;
}

export async function getExclusionCounts(
  runId: string,
  userId: string,
): Promise<ExclusionCounts> {
  const rows = await db
    .select({
      removedReason: leads.removedReason,
      removedAt: leads.removedAt,
      status: leads.status,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        or(isNotNull(leads.removedAt), eq(leads.status, "failed")),
      ),
    )
    .groupBy(leads.removedReason, leads.removedAt, leads.status);

  const counts: ExclusionCounts = {
    duplicate: 0,
    pipelineFailed: 0,
    incompleteData: 0,
    userRejected: 0,
    other: 0,
    total: 0,
  };

  for (const r of rows) {
    const c = r.count ?? 0;
    counts.total += c;
    if (r.removedAt === null && r.status === "failed") {
      // Roh-Pipeline-Fehler ohne explizites Soft-Delete.
      counts.pipelineFailed += c;
      continue;
    }
    switch (r.removedReason) {
      case "duplicate":
        counts.duplicate += c;
        break;
      case "incomplete_data":
        counts.incompleteData += c;
        break;
      case "pipeline_failed":
      case "auto_failed":
        counts.pipelineFailed += c;
        break;
      case "user_rejected":
        counts.userRejected += c;
        break;
      default:
        counts.other += c;
        break;
    }
  }
  return counts;
}

