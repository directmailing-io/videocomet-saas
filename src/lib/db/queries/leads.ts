import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";

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

export async function getLeadBySlug(slug: string): Promise<Lead | null> {
  const [row] = await db.select().from(leads).where(eq(leads.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Resolves a slug WITHIN a specific custom-domain. Used by the public-page
 * route when a request hits one of the customer's own domains — the slug
 * is only unique within `(domain_id, slug)`, not globally.
 *
 * Returns null if no lead matches OR the matched lead doesn't belong to
 * the given domain.
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
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
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
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
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
