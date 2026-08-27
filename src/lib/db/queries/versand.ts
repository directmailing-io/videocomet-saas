/**
 * Versandzentrale — kampagnenübergreifende Übersicht aller Runden mit
 * fertigen Briefen inkl. Brief-Versandfortschritt (Migration 0067).
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, emailBlasts, emailMessages, leads, runs } from "@/lib/db/schema";

export interface VersandRunRow {
  runId: string;
  runName: string;
  runStatus: string;
  campaignId: string;
  campaignName: string;
  createdAt: Date;
  /** Fertige (exportierbare) Leads. */
  completedTotal: number;
  /** Fertige Leads mit Brief-PDF — 0 ⇒ Kampagne ohne Briefe, Brief-UI ausblenden. */
  withPdf: number;
  letterOpen: number;
  letterInProgress: number;
  letterSent: number;
  /** Versendete Briefe mit Reaktion NACH dem Versanddatum. */
  reacted: number;
  /** In Bearbeitung + Export älter als 7 Tage → "Schon versendet?"-Hinweis. */
  stuckInProgress: number;
  /** Noch nicht versendete Leads mit geplantem Versandtermin. */
  planned: number;
  earliestPlannedAt: Date | null;
  returned: number;
  lastSentAt: Date | null;
  /** E-Mail-Kanal: Leads dieser Runde mit mind. einer Blast-Message. */
  emailTotal: number;
  /** Leads mit versendeter E-Mail (inkl. Antworten). */
  emailSent: number;
  /** Leads, deren E-Mail noch in der Warteschlange steht. */
  emailScheduled: number;
  /** Leads mit Antwort auf eine E-Mail. */
  emailReplied: number;
}

export async function listVersandRuns(userId: string): Promise<VersandRunRow[]> {
  const completedCond = sql`${leads.status} = 'completed' AND ${leads.removedAt} IS NULL`;

  const rows = await db
    .select({
      runId: runs.id,
      runName: runs.name,
      runStatus: runs.status,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      createdAt: runs.createdAt,
      completedTotal: sql<number>`COUNT(*) FILTER (WHERE ${completedCond})::int`,
      withPdf: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.pdfUrl} IS NOT NULL)::int`,
      letterOpen: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} = 'open')::int`,
      letterInProgress: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} = 'in_progress')::int`,
      letterSent: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} = 'sent')::int`,
      reacted: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} = 'sent' AND ${leads.letterSentAt} IS NOT NULL AND (
        ${leads.lastViewedAt} > ${leads.letterSentAt} OR ${leads.lastCtaAt} > ${leads.letterSentAt}
      ))::int`,
      stuckInProgress: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} = 'in_progress' AND ${leads.letterExportedAt} < now() - interval '7 days')::int`,
      planned: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} <> 'sent' AND ${leads.letterPlannedAt} IS NOT NULL)::int`,
      earliestPlannedAt: sql<Date | null>`MIN(${leads.letterPlannedAt}) FILTER (WHERE ${completedCond} AND ${leads.letterStatus} <> 'sent')`,
      returned: sql<number>`COUNT(*) FILTER (WHERE ${completedCond} AND ${leads.letterReturnedAt} IS NOT NULL)::int`,
      lastSentAt: sql<Date | null>`MAX(${leads.letterSentAt}) FILTER (WHERE ${completedCond})`,
    })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .innerJoin(leads, eq(leads.runId, runs.id))
    .where(
      and(
        eq(runs.userId, userId),
        isNull(campaigns.deletedAt),
        // Nur Runden, die die Generierung hinter sich haben — Entwürfe und
        // Preflight-Phasen haben noch keine versandfertigen PDFs.
        sql`${runs.status} NOT IN ('draft', 'mapping', 'preflighting', 'awaiting_approval')`,
      ),
    )
    .groupBy(runs.id, runs.name, runs.status, runs.createdAt, campaigns.id, campaigns.name)
    .having(sql`COUNT(*) FILTER (WHERE ${completedCond}) > 0`)
    .orderBy(desc(runs.createdAt));

  // E-Mail-Kanal pro Runde: getrennt aggregiert (JOIN auf email_messages im
  // Haupt-Query würde die COUNT(*)-FILTER-Werte vervielfachen). Ein Lead
  // zählt als "versendet", sobald mindestens eine Mail raus ist oder
  // beantwortet wurde (bounced/failed zählen nicht als Erfolg).
  const emailRows = await db
    .select({
      runId: leads.runId,
      emailTotal: sql<number>`COUNT(DISTINCT ${emailMessages.leadId})::int`,
      emailSent: sql<number>`COUNT(DISTINCT ${emailMessages.leadId}) FILTER (WHERE ${emailMessages.status} = 'sent' OR ${emailMessages.repliedAt} IS NOT NULL)::int`,
      emailScheduled: sql<number>`COUNT(DISTINCT ${emailMessages.leadId}) FILTER (WHERE ${emailMessages.status} = 'scheduled')::int`,
      emailReplied: sql<number>`COUNT(DISTINCT ${emailMessages.leadId}) FILTER (WHERE ${emailMessages.repliedAt} IS NOT NULL)::int`,
    })
    .from(emailMessages)
    .innerJoin(emailBlasts, eq(emailBlasts.id, emailMessages.blastId))
    .innerJoin(leads, eq(leads.id, emailMessages.leadId))
    .where(eq(emailBlasts.userId, userId))
    .groupBy(leads.runId);

  const emailByRun = new Map(emailRows.map((e) => [e.runId, e]));

  return rows.map((r) => {
    const email = emailByRun.get(r.runId);
    return {
      ...r,
      earliestPlannedAt: r.earliestPlannedAt ? new Date(r.earliestPlannedAt) : null,
      lastSentAt: r.lastSentAt ? new Date(r.lastSentAt) : null,
      emailTotal: email?.emailTotal ?? 0,
      emailSent: email?.emailSent ?? 0,
      emailScheduled: email?.emailScheduled ?? 0,
      emailReplied: email?.emailReplied ?? 0,
    };
  });
}
