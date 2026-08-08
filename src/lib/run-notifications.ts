/**
 * Abschluss-Mails pro Run (W3). Genau EINE Mail pro Run, egal wie viele
 * Worker/Recovery-Pfade gleichzeitig finalisieren: der Claim läuft als
 * atomares `UPDATE ... WHERE completion_email_sent_at IS NULL RETURNING` auf
 * `runs.completion_email_sent_at` — nur der Gewinner verschickt.
 *
 * Opt-out: `users.notify_run_emails` (Default true, Toggle in den
 * Einstellungen). Der Claim wird auch bei Opt-out gesetzt, damit ein
 * späteres Einschalten keine alte Runde nachträglich vermailt.
 *
 * Alle Funktionen sind fire-and-forget-sicher: Fehler werden geloggt,
 * nie geworfen — eine kaputte Mail darf niemals die Pipeline anhalten.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs, users } from "@/lib/db/schema";
import {
  sendRunCompletedMail,
  sendRunFailedMail,
  type RunMailFailedLead,
} from "@/lib/mail";

const MAX_FAILED_LEADS_IN_MAIL = 20;

interface ClaimedRun {
  id: string;
  name: string;
  campaignId: string;
  userId: string;
}

/**
 * Atomarer Einmal-Claim. Liefert den Run nur beim ERSTEN Aufruf pro Run,
 * danach (oder bei fremden/unbekannten Runs) null.
 */
async function claimRunNotification(runId: string): Promise<ClaimedRun | null> {
  const claimed = await db
    .update(runs)
    .set({ completionEmailSentAt: new Date() })
    .where(and(eq(runs.id, runId), isNull(runs.completionEmailSentAt)))
    .returning({
      id: runs.id,
      name: runs.name,
      campaignId: runs.campaignId,
      userId: runs.userId,
    });
  return claimed[0] ?? null;
}

async function getRecipient(
  userId: string,
): Promise<{ email: string; firstName: string | null } | null> {
  const [user] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      notifyRunEmails: users.notifyRunEmails,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !user.notifyRunEmails) return null;
  return { email: user.email, firstName: user.firstName };
}

const NAME_ALIASES = {
  first: ["firstName", "Vorname", "first_name", "vorname"],
  last: ["lastName", "Nachname", "last_name", "nachname"],
  company: ["company", "Firma", "firma", "Unternehmen", "unternehmen", "companyName"],
} as const;

function pickField(
  data: Record<string, string>,
  candidates: readonly string[],
): string {
  for (const key of candidates) {
    const v = data[key];
    if (v && v.trim()) return v.trim();
  }
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) lower.set(k.toLowerCase(), v);
  for (const key of candidates) {
    const v = lower.get(key.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function leadDisplayName(
  data: Record<string, string>,
  rowIndex: number,
): string {
  const first = pickField(data, NAME_ALIASES.first);
  const last = pickField(data, NAME_ALIASES.last);
  const person = [first, last].filter(Boolean).join(" ");
  if (person) return person;
  const company = pickField(data, NAME_ALIASES.company);
  if (company) return company;
  return `Zeile ${rowIndex + 1}`;
}

/**
 * Stage des jeweils letzten error-Events pro Lead — Fallback-Fehlertext,
 * wenn `leads.errorMessage` leer ist.
 */
async function lastErrorStageByLead(
  runId: string,
  leadIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (leadIds.length === 0) return result;
  try {
    const idList = sql.join(
      leadIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (lead_id) lead_id, stage
      FROM pipeline_events
      WHERE run_id = ${runId}
        AND level = 'error'
        AND lead_id IN (${idList})
      ORDER BY lead_id, ts DESC
    `)) as unknown as Array<{ lead_id: string; stage: string }>;
    const list = Array.isArray(rows)
      ? rows
      : ((rows as { rows?: Array<{ lead_id: string; stage: string }> }).rows ?? []);
    for (const r of list) result.set(r.lead_id, r.stage);
  } catch {
    // Nur Kontext-Anreicherung; ohne sie bleibt der generische Fehlertext.
  }
  return result;
}

/**
 * Verschickt die Abschluss-Mail für einen fertig gewordenen Run (alle Leads
 * terminal). Wird aus `finalizeRunIfAllLeadsDone` heraus fire-and-forget
 * aufgerufen — nur der Aufruf, der den Run tatsächlich finalisiert hat.
 */
export async function sendRunCompletionNotification(
  runId: string,
): Promise<void> {
  try {
    const run = await claimRunNotification(runId);
    if (!run) return;
    const recipient = await getRecipient(run.userId);
    if (!recipient) return;

    const leadRows = await db
      .select({
        id: leads.id,
        rowIndex: leads.rowIndex,
        status: leads.status,
        introStatus: leads.introStatus,
        errorMessage: leads.errorMessage,
        data: leads.data,
      })
      .from(leads)
      .where(and(eq(leads.runId, runId), isNull(leads.removedAt)))
      .orderBy(leads.rowIndex);

    const completedCount = leadRows.filter((l) => l.status === "completed").length;
    const failed = leadRows.filter((l) => l.status === "failed");
    const introFallbackCount = leadRows.filter(
      (l) => l.introStatus === "fallback_error",
    ).length;

    const failedShown = failed.slice(0, MAX_FAILED_LEADS_IN_MAIL);
    const stageByLead = await lastErrorStageByLead(
      runId,
      failedShown.filter((l) => !l.errorMessage).map((l) => l.id),
    );
    const failedLeads: RunMailFailedLead[] = failedShown.map((l) => {
      const stage = stageByLead.get(l.id);
      const reason =
        l.errorMessage?.trim() ||
        (stage ? `Fehler im Schritt „${stage}"` : "Unbekannter Fehler");
      return { name: leadDisplayName(l.data, l.rowIndex), reason };
    });

    await sendRunCompletedMail({
      to: recipient.email,
      firstName: recipient.firstName,
      runName: run.name,
      campaignId: run.campaignId,
      runId: run.id,
      completedCount,
      failedCount: failed.length,
      totalCount: leadRows.length,
      failedLeads,
      failedMoreCount: Math.max(0, failed.length - failedShown.length),
      introFallbackCount,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[run-notifications] completion mail failed for run=${runId}:`,
      err,
    );
  }
}

/**
 * Verschickt die Fehlschlag-Mail, wenn ein GANZER Run fatal auf
 * `status='failed'` geht (0-Lead-Guards, Watchdog). Gleicher Einmal-Claim
 * wie die Abschluss-Mail — ein Run bekommt nie beides.
 */
export async function sendRunFailureNotification(
  runId: string,
  reason: string,
): Promise<void> {
  try {
    const run = await claimRunNotification(runId);
    if (!run) return;
    const recipient = await getRecipient(run.userId);
    if (!recipient) return;

    await sendRunFailedMail({
      to: recipient.email,
      firstName: recipient.firstName,
      runName: run.name,
      campaignId: run.campaignId,
      runId: run.id,
      reason,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[run-notifications] failure mail failed for run=${runId}:`,
      err,
    );
  }
}
