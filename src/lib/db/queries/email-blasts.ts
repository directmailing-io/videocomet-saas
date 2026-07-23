/**
 * Queries + Transaktionen für E-Mail-Blasts (Kontrakt Kapitel 5/6).
 *
 * Kernstücke:
 *  - startEmailBlast: EINE Transaktion — Confirmation-Log, Snapshot,
 *    Empfänger-Materialisierung (Suppression + In-Blast-Dedupe), Charge.
 *  - cancelEmailBlast: scheduled ⇒ skipped(cancelled) + Refund.
 *  - reconcileEmailFailureRefunds: kumulativer, idempotenter Refund für
 *    failed/bounced (floor(n/10) minus bereits refundete Credits unter
 *    festem Reason-Key, Blast-Row gelockt).
 *  - performUnsubscribe / skipScheduledMessagesToEmail: Abmelde-/Reply-
 *    Pfad inkl. Counter-Pflege.
 */

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  emailBlasts,
  emailMessages,
  emailSuppressions,
  emailTemplates,
  leadEvents,
  leads,
  mailboxConnections,
  users,
  type CampaignEmailGifConfig,
  type EmailBlast,
  type EmailBlastContentSnapshot,
  type EmailMessageStatus,
  type EmailSuppressionReason,
  type EmailTemplate,
} from "@/lib/db/schema";
import {
  chargeForEmailBlast,
  refundEmailCreditsUpTo,
} from "@/lib/billing/credit-service";
import { isEmailTemplateComplete } from "@/lib/db/queries/email-templates";
import { insertLeadEvent } from "@/lib/db/queries/lead-events";
import { computeEmailGifHash } from "@/lib/email/gif-hash";
import { tiptapDocContainsNode } from "@/lib/email/render";
import { sendBlastCompletedMail } from "@/lib/mail";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

export function serializeEmailBlast(b: EmailBlast) {
  return {
    id: b.id,
    campaignId: b.campaignId,
    runId: b.runId,
    mailboxConnectionId: b.mailboxConnectionId,
    templateId: b.templateId,
    status: b.status,
    totalCount: b.totalCount,
    sentCount: b.sentCount ?? 0,
    failedCount: b.failedCount ?? 0,
    skippedCount: b.skippedCount ?? 0,
    bouncedCount: b.bouncedCount ?? 0,
    repliedCount: b.repliedCount ?? 0,
    creditsCharged: b.creditsCharged,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
    createdAt: b.createdAt,
  };
}

export async function getEmailBlastForUser(
  id: string,
  userId: string,
): Promise<EmailBlast | null> {
  const [row] = await db
    .select()
    .from(emailBlasts)
    .where(and(eq(emailBlasts.id, id), eq(emailBlasts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listCampaignEmailBlasts(
  campaignId: string,
  userId: string,
): Promise<EmailBlast[]> {
  return db
    .select()
    .from(emailBlasts)
    .where(
      and(
        eq(emailBlasts.campaignId, campaignId),
        eq(emailBlasts.userId, userId),
      ),
    )
    .orderBy(desc(emailBlasts.createdAt));
}

export function buildContentSnapshot(
  template: Pick<
    EmailTemplate,
    | "subject"
    | "bodyJson"
    | "bodyHtml"
    | "ctaLabel"
    | "ctaUrl"
    | "signatureHtml"
    | "impressumHtml"
  >,
  gifConfig: CampaignEmailGifConfig | null,
): EmailBlastContentSnapshot {
  return {
    subject: template.subject,
    bodyJson: template.bodyJson ?? null,
    bodyHtml: template.bodyHtml,
    ctaLabel: template.ctaLabel,
    ctaUrl: template.ctaUrl,
    signatureHtml: template.signatureHtml,
    impressumHtml: template.impressumHtml,
    gifConfig,
  };
}

export interface BlastPreview {
  total: number;
  sendable: number;
  noEmail: number;
  suppressed: number;
  duplicates: number;
}

/**
 * Live-Zähler für Wizard + Start: gleiche Logik wie die Materialisierung
 * in startEmailBlast (erste Adresse gewinnt, Rest = duplicate).
 */
export async function computeBlastPreview(input: {
  userId: string;
  campaignId: string;
  runId?: string | null;
}): Promise<BlastPreview> {
  const conditions = [
    eq(leads.campaignId, input.campaignId),
    isNull(leads.removedAt),
  ];
  if (input.runId) conditions.push(eq(leads.runId, input.runId));

  const rows = await db
    .select({ normalizedEmail: leads.normalizedEmail })
    .from(leads)
    .where(and(...conditions));

  const suppressedSet = await loadSuppressionSet(db, input.userId);

  let noEmail = 0;
  let suppressed = 0;
  let duplicates = 0;
  let sendable = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const email = (r.normalizedEmail ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      noEmail += 1;
    } else if (suppressedSet.has(email)) {
      suppressed += 1;
    } else if (seen.has(email)) {
      duplicates += 1;
    } else {
      seen.add(email);
      sendable += 1;
    }
  }
  return { total: rows.length, sendable, noEmail, suppressed, duplicates };
}

async function loadSuppressionSet(
  dbOrTx: Tx | typeof db,
  userId: string,
): Promise<Set<string>> {
  const rows = await dbOrTx
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.userId, userId));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

export interface StartBlastGifLead {
  leadId: string;
  campaignId: string;
}

export type StartBlastResult =
  | {
      ok: true;
      blast: EmailBlast;
      scheduled: number;
      skipped: number;
      creditsCharged: number;
      gifLeads: StartBlastGifLead[];
    }
  | { ok: false; error: "not_found" | "wrong_status" | "mailbox_unavailable" | "template_incomplete" | "no_recipients" };

/**
 * Startet einen Draft-Blast in EINER Transaktion. Wirft
 * InsufficientCreditsError bei zu wenig Guthaben (Rollback komplett).
 */
export async function startEmailBlast(input: {
  blastId: string;
  userId: string;
  confirmationTextVersion: string;
}): Promise<StartBlastResult> {
  return db.transaction(async (tx): Promise<StartBlastResult> => {
    const [blast] = await tx
      .select()
      .from(emailBlasts)
      .where(
        and(eq(emailBlasts.id, input.blastId), eq(emailBlasts.userId, input.userId)),
      )
      .for("update")
      .limit(1);
    if (!blast) return { ok: false, error: "not_found" };
    if (blast.status !== "draft") return { ok: false, error: "wrong_status" };

    const [mailbox] = await tx
      .select()
      .from(mailboxConnections)
      .where(
        and(
          eq(mailboxConnections.id, blast.mailboxConnectionId),
          eq(mailboxConnections.userId, input.userId),
        ),
      )
      .limit(1);
    if (!mailbox || mailbox.status !== "connected") {
      return { ok: false, error: "mailbox_unavailable" };
    }

    const [template] = await tx
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.id, blast.templateId),
          eq(emailTemplates.userId, input.userId),
          isNull(emailTemplates.deletedAt),
        ),
      )
      .limit(1);
    if (!template || !isEmailTemplateComplete(template)) {
      return { ok: false, error: "template_incomplete" };
    }

    const [campaign] = await tx
      .select({ emailGifConfig: campaigns.emailGifConfig })
      .from(campaigns)
      .where(eq(campaigns.id, blast.campaignId))
      .limit(1);
    // GIF nur, wenn die Vorlage einen emailGif-Node enthält — sonst weder
    // Encode-Jobs noch gifConfig im Snapshot (freie Komposition).
    const gifConfig = tiptapDocContainsNode(template.bodyJson, "emailGif")
      ? (campaign?.emailGifConfig ?? null)
      : null;
    const snapshot = buildContentSnapshot(template, gifConfig);

    const leadConditions = [
      eq(leads.campaignId, blast.campaignId),
      isNull(leads.removedAt),
    ];
    if (blast.runId) leadConditions.push(eq(leads.runId, blast.runId));
    const leadRows = await tx
      .select({
        id: leads.id,
        normalizedEmail: leads.normalizedEmail,
        emailGifUrl: leads.emailGifUrl,
        emailGifHash: leads.emailGifHash,
        videoContentHash: leads.videoContentHash,
        videoMp4Url: leads.videoMp4Url,
        videoUrl: leads.videoUrl,
        rowIndex: leads.rowIndex,
      })
      .from(leads)
      .where(and(...leadConditions))
      .orderBy(leads.rowIndex);

    const suppressedSet = await loadSuppressionSet(tx, input.userId);

    const seen = new Set<string>();
    const gifLeads: StartBlastGifLead[] = [];
    let scheduled = 0;
    let skipped = 0;
    const values = leadRows.map((l) => {
      const email = (l.normalizedEmail ?? "").trim().toLowerCase();
      let status: "scheduled" | "skipped" = "scheduled";
      let skipReason: string | null = null;
      if (!isValidEmail(email)) {
        status = "skipped";
        skipReason = "no_email";
      } else if (suppressedSet.has(email)) {
        status = "skipped";
        skipReason = "suppressed";
      } else if (seen.has(email)) {
        status = "skipped";
        skipReason = "duplicate";
      } else {
        seen.add(email);
      }
      if (status === "scheduled") {
        scheduled += 1;
        const hasVideo = Boolean(l.videoMp4Url ?? l.videoUrl);
        if (
          gifConfig &&
          hasVideo &&
          (!l.emailGifUrl ||
            l.emailGifHash !== computeEmailGifHash(l.videoContentHash, gifConfig))
        ) {
          gifLeads.push({ leadId: l.id, campaignId: blast.campaignId });
        }
      } else {
        skipped += 1;
      }
      return {
        blastId: blast.id,
        leadId: l.id,
        mailboxConnectionId: blast.mailboxConnectionId,
        toEmail: email || "",
        status,
        skipReason,
        unsubscribeToken: randomBytes(16).toString("hex"),
      };
    });

    if (scheduled === 0) return { ok: false, error: "no_recipients" };

    const credits = Math.ceil(scheduled / 10);
    // Wirft InsufficientCreditsError ⇒ komplette Tx rollt zurück.
    await chargeForEmailBlast(tx, {
      userId: input.userId,
      blastId: blast.id,
      amount: credits,
    });

    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(emailMessages).values(values.slice(i, i + 500));
    }

    const now = new Date();
    const [updated] = await tx
      .update(emailBlasts)
      .set({
        status: "running",
        contentSnapshot: snapshot,
        confirmationLog: {
          confirmedAt: now.toISOString(),
          textVersion: input.confirmationTextVersion,
          userId: input.userId,
        },
        totalCount: scheduled,
        skippedCount: skipped,
        creditsCharged: credits,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(emailBlasts.id, blast.id))
      .returning();

    return {
      ok: true,
      blast: updated!,
      scheduled,
      skipped,
      creditsCharged: credits,
      gifLeads,
    };
  });
}

export type SimpleBlastActionResult =
  | { ok: true; blast: EmailBlast }
  | { ok: false; error: "not_found" | "wrong_status" };

export async function pauseEmailBlast(
  id: string,
  userId: string,
): Promise<SimpleBlastActionResult> {
  const [row] = await db
    .update(emailBlasts)
    .set({ status: "paused", updatedAt: new Date() })
    .where(
      and(
        eq(emailBlasts.id, id),
        eq(emailBlasts.userId, userId),
        eq(emailBlasts.status, "running"),
      ),
    )
    .returning();
  if (row) return { ok: true, blast: row };
  const existing = await getEmailBlastForUser(id, userId);
  return { ok: false, error: existing ? "wrong_status" : "not_found" };
}

export async function resumeEmailBlast(
  id: string,
  userId: string,
): Promise<SimpleBlastActionResult> {
  const [row] = await db
    .update(emailBlasts)
    .set({ status: "running", updatedAt: new Date() })
    .where(
      and(
        eq(emailBlasts.id, id),
        eq(emailBlasts.userId, userId),
        eq(emailBlasts.status, "paused"),
      ),
    )
    .returning();
  if (row) return { ok: true, blast: row };
  const existing = await getEmailBlastForUser(id, userId);
  return { ok: false, error: existing ? "wrong_status" : "not_found" };
}

export type CancelBlastResult =
  | { ok: true; blast: EmailBlast; cancelledMessages: number; refunded: number }
  | { ok: false; error: "not_found" | "wrong_status" };

export async function cancelEmailBlast(
  id: string,
  userId: string,
): Promise<CancelBlastResult> {
  return db.transaction(async (tx): Promise<CancelBlastResult> => {
    const [blast] = await tx
      .select()
      .from(emailBlasts)
      .where(and(eq(emailBlasts.id, id), eq(emailBlasts.userId, userId)))
      .for("update")
      .limit(1);
    if (!blast) return { ok: false, error: "not_found" };
    if (blast.status !== "running" && blast.status !== "paused") {
      return { ok: false, error: "wrong_status" };
    }

    const cancelled = await tx
      .update(emailMessages)
      .set({ status: "skipped", skipReason: "cancelled" })
      .where(
        and(eq(emailMessages.blastId, id), eq(emailMessages.status, "scheduled")),
      )
      .returning({ id: emailMessages.id });

    const refunded = await refundEmailCreditsUpTo(tx, {
      userId,
      reasonKey: `email_blast:${id}:cancel`,
      targetTotal: Math.floor(cancelled.length / 10),
    });

    const now = new Date();
    const [updated] = await tx
      .update(emailBlasts)
      .set({
        status: "cancelled",
        completedAt: now,
        skippedCount: sql`COALESCE(${emailBlasts.skippedCount}, 0) + ${cancelled.length}`,
        updatedAt: now,
      })
      .where(eq(emailBlasts.id, id))
      .returning();

    return {
      ok: true,
      blast: updated!,
      cancelledMessages: cancelled.length,
      refunded,
    };
  });
}

/**
 * Kumulativer Failed/Bounce-Refund: floor((failed+bounced)/10) minus
 * bereits refundete Credits. Läuft nur für abgeschlossene Blasts —
 * während `running` wird bis zur Completed-Transition gewartet.
 * Idempotent + race-sicher durch Blast-Lock + Ledger-Summe.
 */
export async function reconcileEmailFailureRefunds(blastId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [blast] = await tx
      .select()
      .from(emailBlasts)
      .where(eq(emailBlasts.id, blastId))
      .for("update")
      .limit(1);
    if (!blast || blast.status !== "completed") return 0;

    const [counts] = await tx.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM email_messages
          WHERE blast_id = ${blastId} AND status IN ('failed', 'bounced')`,
    );
    const failures = Number((counts as { n: string } | undefined)?.n ?? 0);
    return refundEmailCreditsUpTo(tx, {
      userId: blast.userId,
      reasonKey: `email_blast:${blastId}:failures`,
      targetTotal: Math.floor(failures / 10),
    });
  });
}

/**
 * Completed-Transition: wenn keine scheduled-Messages mehr existieren,
 * running ⇒ completed. Refund passiert direkt danach (separater
 * idempotenter Reconcile), anschließend geht einmalig die
 * Abschluss-Systemmail raus (Transition-Guard = Idempotenz).
 * Liefert true bei Transition.
 */
export async function maybeCompleteBlast(blastId: string): Promise<boolean> {
  const [row] = await db
    .update(emailBlasts)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(emailBlasts.id, blastId),
        eq(emailBlasts.status, "running"),
        sql`NOT EXISTS (SELECT 1 FROM email_messages em
             WHERE em.blast_id = ${blastId} AND em.status = 'scheduled')`,
      ),
    )
    .returning({ id: emailBlasts.id });
  if (!row) return false;
  await reconcileEmailFailureRefunds(blastId);
  await notifyBlastCompleted(blastId).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[email-blasts] completed mail failed:", err);
  });
  return true;
}

/** Abschluss-Systemmail mit Kurz-Stats (nur vom Transition-Pfad gerufen). */
async function notifyBlastCompleted(blastId: string): Promise<void> {
  const [row] = await db
    .select({
      blastId: emailBlasts.id,
      campaignId: emailBlasts.campaignId,
      sentCount: emailBlasts.sentCount,
      totalCount: emailBlasts.totalCount,
      repliedCount: emailBlasts.repliedCount,
      bouncedCount: emailBlasts.bouncedCount,
      campaignName: campaigns.name,
      userEmail: users.email,
      userFirstName: users.firstName,
    })
    .from(emailBlasts)
    .innerJoin(campaigns, eq(campaigns.id, emailBlasts.campaignId))
    .innerJoin(users, eq(users.id, emailBlasts.userId))
    .where(eq(emailBlasts.id, blastId))
    .limit(1);
  if (!row) return;
  await sendBlastCompletedMail({
    to: row.userEmail,
    firstName: row.userFirstName,
    campaignName: row.campaignName,
    campaignId: row.campaignId,
    blastId: row.blastId,
    sentCount: row.sentCount ?? 0,
    totalCount: row.totalCount,
    repliedCount: row.repliedCount ?? 0,
    bouncedCount: row.bouncedCount ?? 0,
  });
}

/**
 * Skippt alle weiteren scheduled-Messages an eine Adresse über alle
 * Blasts des Users (Reply-/Unsubscribe-Pfad) und pflegt die Counter.
 */
export async function skipScheduledMessagesToEmail(
  userId: string,
  email: string,
  skipReason: "replied" | "unsubscribed",
): Promise<number> {
  const lower = email.trim().toLowerCase();
  if (!lower) return 0;
  const rows = await db.execute<{ blast_id: string }>(
    sql`UPDATE email_messages em
        SET status = 'skipped', skip_reason = ${skipReason}
        FROM email_blasts b
        WHERE b.id = em.blast_id AND b.user_id = ${userId}
          AND em.to_email = ${lower} AND em.status = 'scheduled'
        RETURNING em.blast_id`,
  );
  const byBlast = new Map<string, number>();
  for (const r of rows as unknown as Array<{ blast_id: string }>) {
    byBlast.set(r.blast_id, (byBlast.get(r.blast_id) ?? 0) + 1);
  }
  for (const [blastId, n] of Array.from(byBlast.entries())) {
    await db
      .update(emailBlasts)
      .set({
        skippedCount: sql`COALESCE(${emailBlasts.skippedCount}, 0) + ${n}`,
        totalCount: sql`GREATEST(${emailBlasts.totalCount} - ${n}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(emailBlasts.id, blastId));
    await maybeCompleteBlast(blastId);
  }
  let total = 0;
  for (const n of Array.from(byBlast.values())) total += n;
  return total;
}

export async function upsertSuppression(input: {
  userId: string;
  email: string;
  reason: EmailSuppressionReason;
  sourceMessageId?: string | null;
}): Promise<void> {
  const lower = input.email.trim().toLowerCase();
  if (!lower) return;
  await db
    .insert(emailSuppressions)
    .values({
      userId: input.userId,
      email: lower,
      reason: input.reason,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .onConflictDoNothing();
}

export interface UnsubscribeResult {
  ok: boolean;
  alreadyUnsubscribed?: boolean;
}

/**
 * Abmeldung über unsubscribeToken (Page-POST + One-Click-POST + API).
 * Idempotent — mehrfacher Aufruf ist ein No-op.
 */
export async function performUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const trimmed = token.trim();
  if (!/^[0-9a-f]{32}$/i.test(trimmed)) return { ok: false };

  const [row] = await db
    .select({
      messageId: emailMessages.id,
      leadId: emailMessages.leadId,
      toEmail: emailMessages.toEmail,
      unsubscribedAt: emailMessages.unsubscribedAt,
      userId: emailBlasts.userId,
    })
    .from(emailMessages)
    .innerJoin(emailBlasts, eq(emailBlasts.id, emailMessages.blastId))
    .where(eq(emailMessages.unsubscribeToken, trimmed))
    .limit(1);
  if (!row) return { ok: false };
  if (row.unsubscribedAt) return { ok: true, alreadyUnsubscribed: true };

  await upsertSuppression({
    userId: row.userId,
    email: row.toEmail,
    reason: "unsubscribe",
    sourceMessageId: row.messageId,
  });
  await db
    .update(emailMessages)
    .set({ unsubscribedAt: new Date() })
    .where(eq(emailMessages.id, row.messageId));
  await insertLeadEvent({ leadId: row.leadId, kind: "email_unsubscribe" });
  await skipScheduledMessagesToEmail(row.userId, row.toEmail, "unsubscribed");
  return { ok: true };
}

/** Status-Zähler eines Blasts direkt aus den Message-Rows. */
export async function countBlastMessages(blastId: string): Promise<{
  scheduled: number;
  sent: number;
  failed: number;
  skipped: number;
  bounced: number;
}> {
  const rows = await db
    .select({
      status: emailMessages.status,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(emailMessages)
    .where(eq(emailMessages.blastId, blastId))
    .groupBy(emailMessages.status);
  const out = { scheduled: 0, sent: 0, failed: 0, skipped: 0, bounced: 0 };
  for (const r of rows) {
    if (r.status in out) out[r.status as keyof typeof out] = r.n;
  }
  return out;
}

/** Für Mailbox-Sync: offene (gesendete) Messages eines Postfachs. */
export async function listOpenSentMessages(mailboxConnectionId: string) {
  return db
    .select({
      id: emailMessages.id,
      blastId: emailMessages.blastId,
      leadId: emailMessages.leadId,
      toEmail: emailMessages.toEmail,
      internetMessageId: emailMessages.internetMessageId,
      conversationId: emailMessages.conversationId,
      repliedAt: emailMessages.repliedAt,
      userId: emailBlasts.userId,
    })
    .from(emailMessages)
    .innerJoin(emailBlasts, eq(emailBlasts.id, emailMessages.blastId))
    .where(
      and(
        eq(emailMessages.mailboxConnectionId, mailboxConnectionId),
        eq(emailMessages.status, "sent"),
      ),
    );
}

export type OpenSentMessage = Awaited<
  ReturnType<typeof listOpenSentMessages>
>[number];

/** Klicks (distinct Leads mit email_click) + Abmeldungen eines Blasts. */
export async function getBlastEngagement(blastId: string): Promise<{
  clicks: number;
  unsubscribed: number;
}> {
  const rows = await db.execute<{ clicks: string; unsubscribed: string }>(
    sql`SELECT
          (SELECT COUNT(DISTINCT le.lead_id) FROM lead_events le
            WHERE le.kind = 'email_click'
              AND le.lead_id IN (
                SELECT em.lead_id FROM email_messages em WHERE em.blast_id = ${blastId}
              ))::text AS clicks,
          (SELECT COUNT(*) FROM email_messages em
            WHERE em.blast_id = ${blastId}
              AND em.unsubscribed_at IS NOT NULL)::text AS unsubscribed`,
  );
  const row = (rows as unknown as Array<{ clicks: string; unsubscribed: string }>)[0];
  return {
    clicks: Number(row?.clicks ?? 0),
    unsubscribed: Number(row?.unsubscribed ?? 0),
  };
}

export interface BlastMessageRow {
  id: string;
  leadId: string;
  toEmail: string;
  status: EmailMessageStatus;
  sentAt: Date | null;
  repliedAt: Date | null;
  unsubscribedAt: Date | null;
  skipReason: string | null;
  error: string | null;
  clicked: boolean;
  leadData: Record<string, string>;
}

/** Message-Tabelle der Blast-Detailseite (paginiert, mit Lead-Daten). */
export async function listBlastMessages(
  blastId: string,
  opts: { offset: number; limit: number },
): Promise<{ rows: BlastMessageRow[]; total: number }> {
  const clickedSql = sql<boolean>`EXISTS (
    SELECT 1 FROM ${leadEvents} le
    WHERE le.lead_id = ${emailMessages.leadId} AND le.kind = 'email_click'
  )`;
  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: emailMessages.id,
        leadId: emailMessages.leadId,
        toEmail: emailMessages.toEmail,
        status: emailMessages.status,
        sentAt: emailMessages.sentAt,
        repliedAt: emailMessages.repliedAt,
        unsubscribedAt: emailMessages.unsubscribedAt,
        skipReason: emailMessages.skipReason,
        error: emailMessages.error,
        clicked: clickedSql,
        leadData: leads.data,
        rowIndex: leads.rowIndex,
      })
      .from(emailMessages)
      .innerJoin(leads, eq(leads.id, emailMessages.leadId))
      .where(eq(emailMessages.blastId, blastId))
      .orderBy(leads.rowIndex)
      .offset(opts.offset)
      .limit(opts.limit),
    db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(emailMessages)
      .where(eq(emailMessages.blastId, blastId)),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      toEmail: r.toEmail,
      status: r.status,
      sentAt: r.sentAt,
      repliedAt: r.repliedAt,
      unsubscribedAt: r.unsubscribedAt,
      skipReason: r.skipReason,
      error: r.error,
      clicked: Boolean(r.clicked),
      leadData: r.leadData ?? {},
    })),
    total: countRow?.n ?? 0,
  };
}

export type LeadEmailStatus =
  | "unsubscribed"
  | "replied"
  | "bounced"
  | "clicked"
  | "sent"
  | "failed"
  | "skipped"
  | "scheduled";

const LEAD_EMAIL_STATUS_PRIORITY: LeadEmailStatus[] = [
  "unsubscribed",
  "replied",
  "bounced",
  "clicked",
  "sent",
  "failed",
  "skipped",
  "scheduled",
];

/**
 * Kompakter E-Mail-Status pro Lead einer Runde (Run-Detail-Tabelle).
 * Leere Map = keine Blast-Messages für diese Runde ⇒ Spalte weglassen.
 */
export async function getLeadEmailStatusMapForRun(
  runId: string,
  userId: string,
): Promise<Record<string, LeadEmailStatus>> {
  const clickedSql = sql<boolean>`EXISTS (
    SELECT 1 FROM ${leadEvents} le
    WHERE le.lead_id = ${emailMessages.leadId} AND le.kind = 'email_click'
  )`;
  const rows = await db
    .select({
      leadId: emailMessages.leadId,
      status: emailMessages.status,
      repliedAt: emailMessages.repliedAt,
      unsubscribedAt: emailMessages.unsubscribedAt,
      clicked: clickedSql,
    })
    .from(emailMessages)
    .innerJoin(emailBlasts, eq(emailBlasts.id, emailMessages.blastId))
    .innerJoin(leads, eq(leads.id, emailMessages.leadId))
    .where(and(eq(leads.runId, runId), eq(emailBlasts.userId, userId)));

  const out: Record<string, LeadEmailStatus> = {};
  for (const r of rows) {
    let s: LeadEmailStatus = r.status;
    if (r.unsubscribedAt) s = "unsubscribed";
    else if (r.repliedAt) s = "replied";
    else if (r.status === "sent" && r.clicked) s = "clicked";
    const prev = out[r.leadId];
    if (
      !prev ||
      LEAD_EMAIL_STATUS_PRIORITY.indexOf(s) < LEAD_EMAIL_STATUS_PRIORITY.indexOf(prev)
    ) {
      out[r.leadId] = s;
    }
  }
  return out;
}

// ── Admin ──────────────────────────────────────────────────────────────────

export interface AdminEmailBlastRow {
  id: string;
  userEmail: string;
  campaignName: string;
  status: EmailBlast["status"];
  sentCount: number;
  totalCount: number;
  bouncedCount: number;
  repliedCount: number;
  startedAt: Date | null;
  createdAt: Date;
}

/** Alle Blasts (alle User) für die Admin-Konsole. */
export async function listAllEmailBlastsForAdmin(): Promise<AdminEmailBlastRow[]> {
  const rows = await db
    .select({
      id: emailBlasts.id,
      userEmail: users.email,
      campaignName: campaigns.name,
      status: emailBlasts.status,
      sentCount: emailBlasts.sentCount,
      totalCount: emailBlasts.totalCount,
      bouncedCount: emailBlasts.bouncedCount,
      repliedCount: emailBlasts.repliedCount,
      startedAt: emailBlasts.startedAt,
      createdAt: emailBlasts.createdAt,
    })
    .from(emailBlasts)
    .innerJoin(users, eq(users.id, emailBlasts.userId))
    .innerJoin(campaigns, eq(campaigns.id, emailBlasts.campaignId))
    .orderBy(desc(emailBlasts.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    sentCount: r.sentCount ?? 0,
    bouncedCount: r.bouncedCount ?? 0,
    repliedCount: r.repliedCount ?? 0,
  }));
}

/** Blast ohne User-Scope (Admin-Kill-Switch). */
export async function getEmailBlastAdmin(id: string): Promise<EmailBlast | null> {
  const [row] = await db
    .select()
    .from(emailBlasts)
    .where(eq(emailBlasts.id, id))
    .limit(1);
  return row ?? null;
}

export interface AdminSuppressionRow {
  id: string;
  email: string;
  reason: EmailSuppressionReason;
  userEmail: string;
  createdAt: Date;
}

/** Suppression-Suche über alle User (Admin). */
export async function searchSuppressionsForAdmin(
  emailQuery: string,
): Promise<AdminSuppressionRow[]> {
  const term = emailQuery.trim().toLowerCase();
  if (!term) return [];
  return db
    .select({
      id: emailSuppressions.id,
      email: emailSuppressions.email,
      reason: emailSuppressions.reason,
      userEmail: users.email,
      createdAt: emailSuppressions.createdAt,
    })
    .from(emailSuppressions)
    .innerJoin(users, eq(users.id, emailSuppressions.userId))
    .where(sql`${emailSuppressions.email} LIKE ${"%" + term + "%"}`)
    .orderBy(desc(emailSuppressions.createdAt))
    .limit(100);
}
