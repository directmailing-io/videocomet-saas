import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import type {
  PreflightCounts,
  PreflightLeadRow,
  PreflightStatus,
} from "@/lib/preflight/types";
import { PREFLIGHT_PROBLEMATIC_STATUSES } from "@/lib/preflight/types";

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export interface BulkLeadRow {
  rowIndex: number;
  data: Record<string, string>;
}

export type UpdateLeadPatch = Partial<Omit<Lead, "id" | "runId" | "createdAt">>;

export async function bulkInsertLeads(
  runId: string,
  rows: BulkLeadRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(leads)
    .values(
      rows.map((r) => ({
        runId,
        rowIndex: r.rowIndex,
        data: r.data,
      })),
    )
    .returning({ id: leads.id });
  return inserted.length;
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
): Promise<Lead | null> {
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.slug, slug), isNull(leads.domainId)))
    .limit(1);
  return row ?? null;
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
): Promise<Lead | null> {
  const [row] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.slug, slug), eq(leads.domainId, domainId)))
    .limit(1);
  return row ?? null;
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

