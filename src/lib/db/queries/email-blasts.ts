/**
 * Queries + Transaktionen für E-Mail-Blasts (Kontrakt Kapitel 5/6).
 *
 * Kernstücke:
 *  - startEmailBlast: EINE Transaktion — Confirmation-Log, Snapshot,
 *    Empfänger-Materialisierung (Suppression + In-Blast-Dedupe +
 *    30-Tage-Schutzlimit) + Postfach-Rotation. E-Mail-Versand ist seit
 *    Migration 0066 in der Grundgebühr inklusive — es werden KEINE
 *    Credits mehr berechnet.
 *  - Schutz-Limit: max. 4 gesendete Mails pro Empfänger-Adresse in 30
 *    Tagen (userweit, blastübergreifend). Betroffene Messages werden
 *    nicht übersprungen, sondern warten via earliestSendAt.
 *  - maybeAutoPauseForBounces: Bounce-Schutz — Blast pausiert automatisch
 *    mit Klartext-Grund, wenn zu viele Mails nicht ankommen.
 *  - reviveMessagesForLead: korrigierte Lead-Adresse nimmt failed/
 *    bounced/skipped-Messages in aktiven Blasts automatisch wieder auf.
 *  - performUnsubscribe / skipScheduledMessagesToEmail: Abmelde-/Reply-
 *    Pfad inkl. Counter-Pflege.
 */

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { isEmailTemplateComplete } from "@/lib/db/queries/email-templates";
import { insertLeadEvent } from "@/lib/db/queries/lead-events";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";
import { computeEmailGifHash } from "@/lib/email/gif-hash";
import { tiptapDocContainsNode } from "@/lib/email/render";
import { sendBlastCompletedMail } from "@/lib/mail";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

// ── 30-Tage-Schutzlimit ────────────────────────────────────────────────────

/** Max. Mails pro Empfänger-Adresse im rollierenden Fenster (userweit). */
export const PER_ADDRESS_MAX_MAILS = 4;
export const PER_ADDRESS_WINDOW_DAYS = 30;

interface AddressWindowEntry {
  /** sentAt der Mails im 30-Tage-Fenster, aufsteigend sortiert. */
  sentAt: Date[];
  /** Noch nicht versendete (scheduled) Messages in aktiven Blasts. */
  scheduled: number;
}

/**
 * Fenster-Zustand pro Adresse: gesendete Mails der letzten 30 Tage plus
 * offene scheduled-Messages in running/paused-Blasts des Users.
 */
async function loadAddressWindowMap(
  dbOrTx: Tx | typeof db,
  userId: string,
): Promise<Map<string, AddressWindowEntry>> {
  const rows = await dbOrTx.execute<{
    to_email: string;
    status: string;
    sent_at: string | null;
  }>(
    sql`SELECT em.to_email, em.status, em.sent_at::text
        FROM email_messages em
        JOIN email_blasts b ON b.id = em.blast_id
        WHERE b.user_id = ${userId}
          AND (
            (em.status = 'sent'
              AND em.sent_at > now() - interval '${sql.raw(String(PER_ADDRESS_WINDOW_DAYS))} days')
            OR (em.status = 'scheduled' AND b.status IN ('running', 'paused'))
          )`,
  );
  const map = new Map<string, AddressWindowEntry>();
  for (const r of rows as unknown as Array<{
    to_email: string;
    status: string;
    sent_at: string | null;
  }>) {
    const key = r.to_email.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = { sentAt: [], scheduled: 0 };
      map.set(key, entry);
    }
    if (r.status === "sent" && r.sent_at) entry.sentAt.push(new Date(r.sent_at));
    else entry.scheduled += 1;
  }
  for (const entry of Array.from(map.values())) {
    entry.sentAt.sort((a, b) => a.getTime() - b.getTime());
  }
  return map;
}

/**
 * Frühester Versandzeitpunkt für eine weitere Mail an diese Adresse.
 * NULL = sofort erlaubt. Sonst: Zeitpunkt, zu dem genug alte Mails aus
 * dem 30-Tage-Fenster herausgefallen sind.
 */
function computeEarliestSendAt(entry: AddressWindowEntry | undefined): Date | null {
  if (!entry) return null;
  const windowCount = entry.sentAt.length + entry.scheduled;
  if (windowCount < PER_ADDRESS_MAX_MAILS) return null;
  // Es müssen (windowCount - (MAX-1)) Sends aus dem Fenster fallen, damit
  // die neue Mail wieder Platz hat.
  const needed = windowCount - (PER_ADDRESS_MAX_MAILS - 1);
  const windowMs = PER_ADDRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const idx = needed - 1;
  if (idx < entry.sentAt.length) {
    return new Date(entry.sentAt[idx]!.getTime() + windowMs);
  }
  // Fenster ist durch scheduled-Messages ohne Zeitstempel belegt —
  // konservativ volle Fensterlänge warten.
  return new Date(Date.now() + windowMs);
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
    mailboxConnectionIds: b.mailboxConnectionIds ?? [b.mailboxConnectionId],
    pauseReason: b.pauseReason ?? null,
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

export interface UserEmailBlastRow {
  id: string;
  campaignId: string;
  campaignName: string;
  status: EmailBlast["status"];
  totalCount: number;
  sentCount: number;
  repliedCount: number;
  startedAt: Date | null;
  createdAt: Date;
}

/** Alle Blasts eines Users über alle Kampagnen (Seite „E-Mail-Versand"). */
export async function listUserEmailBlasts(
  userId: string,
): Promise<UserEmailBlastRow[]> {
  const rows = await db
    .select({
      id: emailBlasts.id,
      campaignId: emailBlasts.campaignId,
      campaignName: campaigns.name,
      status: emailBlasts.status,
      totalCount: emailBlasts.totalCount,
      sentCount: emailBlasts.sentCount,
      repliedCount: emailBlasts.repliedCount,
      startedAt: emailBlasts.startedAt,
      createdAt: emailBlasts.createdAt,
    })
    .from(emailBlasts)
    .innerJoin(campaigns, eq(campaigns.id, emailBlasts.campaignId))
    .where(eq(emailBlasts.userId, userId))
    .orderBy(desc(emailBlasts.createdAt));
  return rows.map((r) => ({
    ...r,
    sentCount: r.sentCount ?? 0,
    repliedCount: r.repliedCount ?? 0,
  }));
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
    | "format"
    | "footerMode"
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
    format: template.format,
    footerMode: template.footerMode,
    gifConfig,
  };
}

export interface BlastPreview {
  total: number;
  sendable: number;
  noEmail: number;
  suppressed: number;
  duplicates: number;
  /**
   * Teilmenge von sendable, die wegen des 30-Tage-Schutzlimits (max. 4
   * Mails pro Adresse) erst später versendet wird.
   */
  waiting: number;
  /** Frühestes Freiwerden unter den wartenden Adressen (ISO), sonst null. */
  waitingFrom: string | null;
}

/**
 * Live-Zähler für Wizard + Start: gleiche Logik wie die Materialisierung
 * in startEmailBlast (erste Adresse gewinnt, Rest = duplicate).
 */
export async function computeBlastPreview(input: {
  userId: string;
  campaignId: string;
  runId?: string | null;
  /** Explizite Lead-Auswahl (Versandzentrale) — null/leer = alle. */
  leadIds?: string[] | null;
}): Promise<BlastPreview> {
  const conditions = [
    eq(leads.campaignId, input.campaignId),
    isNull(leads.removedAt),
  ];
  if (input.runId) conditions.push(eq(leads.runId, input.runId));
  if (input.leadIds && input.leadIds.length > 0) {
    conditions.push(inArray(leads.id, input.leadIds));
  }

  const rows = await db
    .select({ normalizedEmail: leads.normalizedEmail })
    .from(leads)
    .where(and(...conditions));

  const suppressedSet = await loadSuppressionSet(db, input.userId);
  const windowMap = await loadAddressWindowMap(db, input.userId);

  let noEmail = 0;
  let suppressed = 0;
  let duplicates = 0;
  let sendable = 0;
  let waiting = 0;
  let waitingFrom: Date | null = null;
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
      const earliest = computeEarliestSendAt(windowMap.get(email));
      if (earliest) {
        waiting += 1;
        if (!waitingFrom || earliest.getTime() < waitingFrom.getTime()) {
          waitingFrom = earliest;
        }
      }
    }
  }
  return {
    total: rows.length,
    sendable,
    noEmail,
    suppressed,
    duplicates,
    waiting,
    waitingFrom: waitingFrom ? waitingFrom.toISOString() : null,
  };
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
      waiting: number;
      gifLeads: StartBlastGifLead[];
    }
  | { ok: false; error: "not_found" | "wrong_status" | "mailbox_unavailable" | "template_incomplete" | "no_recipients" };

/**
 * Startet einen Draft-Blast in EINER Transaktion. E-Mail-Versand ist
 * inklusive — es werden keine Credits berechnet. Die Empfänger werden
 * gewichtet nach Tageslimit auf die gewählten Postfächer verteilt
 * (Rotation); Adressen über dem 30-Tage-Schutzlimit warten via
 * earliestSendAt statt übersprungen zu werden.
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

    // Rotation: alle gewählten Postfächer laden; nur verbundene senden.
    const wantedMailboxIds = Array.from(
      new Set([
        blast.mailboxConnectionId,
        ...(blast.mailboxConnectionIds ?? []),
      ]),
    );
    const mailboxRows = await tx
      .select()
      .from(mailboxConnections)
      .where(
        and(
          inArray(mailboxConnections.id, wantedMailboxIds),
          eq(mailboxConnections.userId, input.userId),
        ),
      );
    const sendMailboxes = mailboxRows.filter((m) => m.status === "connected");
    if (sendMailboxes.length === 0) {
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
    if (blast.leadIds && blast.leadIds.length > 0) {
      leadConditions.push(inArray(leads.id, blast.leadIds));
    }
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
    const windowMap = await loadAddressWindowMap(tx, input.userId);

    // Gewichtete Rotation: jede Message geht an das Postfach mit der
    // aktuell geringsten Auslastung relativ zu seinem Tageslimit.
    const rotation = sendMailboxes.map((m) => ({
      id: m.id,
      limit: Math.max(1, effectiveDailyLimit(m.warmupStage, m.dailyCap)),
      assigned: 0,
    }));
    const nextMailboxId = (): string => {
      let best = rotation[0]!;
      for (const r of rotation) {
        if (r.assigned / r.limit < best.assigned / best.limit) best = r;
      }
      best.assigned += 1;
      return best.id;
    };

    const seen = new Set<string>();
    const gifLeads: StartBlastGifLead[] = [];
    let scheduled = 0;
    let skipped = 0;
    let waiting = 0;
    const values = leadRows.map((l) => {
      const email = (l.normalizedEmail ?? "").trim().toLowerCase();
      let status: "scheduled" | "skipped" = "scheduled";
      let skipReason: string | null = null;
      let earliestSendAt: Date | null = null;
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
        earliestSendAt = computeEarliestSendAt(windowMap.get(email));
      }
      if (status === "scheduled") {
        scheduled += 1;
        if (earliestSendAt) waiting += 1;
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
        mailboxConnectionId:
          status === "scheduled" ? nextMailboxId() : blast.mailboxConnectionId,
        toEmail: email || "",
        status,
        skipReason,
        earliestSendAt,
        unsubscribeToken: randomBytes(16).toString("hex"),
      };
    });

    if (scheduled === 0) return { ok: false, error: "no_recipients" };

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
          format: template.format,
          footerMode: template.footerMode,
        },
        totalCount: scheduled,
        skippedCount: skipped,
        creditsCharged: 0,
        mailboxConnectionIds: sendMailboxes.map((m) => m.id),
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
      waiting,
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
    .set({ status: "running", pauseReason: null, updatedAt: new Date() })
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
  | { ok: true; blast: EmailBlast; cancelledMessages: number }
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
    };
  });
}

/** Bounce-Schutz: ab diesem Anteil wird automatisch pausiert. */
export const BOUNCE_AUTO_PAUSE_RATE = 0.05;
/** Mindestanzahl Zustell-Versuche, bevor die Quote bewertet wird. */
export const BOUNCE_AUTO_PAUSE_MIN_ATTEMPTS = 10;

/**
 * Bounce-Schutz: pausiert einen laufenden Blast automatisch, wenn mehr
 * als 5 % der zugestellten Mails bouncen (ab 10 Versuchen). Der Klartext-
 * Grund landet in pauseReason und wird in der App angezeigt — der User
 * kann nach Prüfung der Adressen jederzeit fortsetzen.
 */
export async function maybeAutoPauseForBounces(blastId: string): Promise<boolean> {
  const [blast] = await db
    .select({
      status: emailBlasts.status,
      sentCount: emailBlasts.sentCount,
      bouncedCount: emailBlasts.bouncedCount,
    })
    .from(emailBlasts)
    .where(eq(emailBlasts.id, blastId))
    .limit(1);
  if (!blast || blast.status !== "running") return false;
  const bounced = blast.bouncedCount ?? 0;
  const attempts = (blast.sentCount ?? 0) + bounced;
  if (attempts < BOUNCE_AUTO_PAUSE_MIN_ATTEMPTS) return false;
  if (bounced / attempts <= BOUNCE_AUTO_PAUSE_RATE) return false;

  const reason =
    `Automatisch pausiert zum Schutz Ihres Postfachs: ${bounced} von ${attempts} ` +
    `E-Mails kamen nicht an (unzustellbar). Zu viele unzustellbare Mails schaden ` +
    `dem Ruf Ihrer Absender-Adresse bei Google und Microsoft. Bitte prüfen und ` +
    `korrigieren Sie die E-Mail-Adressen Ihrer Leads — danach können Sie den ` +
    `Versand oben rechts fortsetzen.`;
  const [updated] = await db
    .update(emailBlasts)
    .set({ status: "paused", pauseReason: reason, updatedAt: new Date() })
    .where(and(eq(emailBlasts.id, blastId), eq(emailBlasts.status, "running")))
    .returning({ id: emailBlasts.id });
  return Boolean(updated);
}

/**
 * Completed-Transition: wenn keine scheduled-Messages mehr existieren,
 * running ⇒ completed, anschließend geht einmalig die
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

/**
 * Korrigierte Lead-Adresse: nimmt failed/bounced- sowie wegen fehlender/
 * gesperrter Adresse geskippte Messages des Leads in laufenden/pausierten
 * Blasts automatisch wieder in den Versand auf (neue Adresse, Status
 * scheduled, 30-Tage-Schutzlimit wird neu berechnet). Counter werden
 * konsistent zurückgedreht. Liefert die Zahl reaktivierter Messages.
 */
export async function reviveMessagesForLead(
  userId: string,
  leadId: string,
  newEmail: string,
): Promise<number> {
  const lower = newEmail.trim().toLowerCase();
  if (!isValidEmail(lower)) return 0;

  const suppressedSet = await loadSuppressionSet(db, userId);
  if (suppressedSet.has(lower)) return 0;

  const candidates = await db
    .select({
      id: emailMessages.id,
      blastId: emailMessages.blastId,
      status: emailMessages.status,
      skipReason: emailMessages.skipReason,
    })
    .from(emailMessages)
    .innerJoin(emailBlasts, eq(emailBlasts.id, emailMessages.blastId))
    .where(
      and(
        eq(emailMessages.leadId, leadId),
        eq(emailBlasts.userId, userId),
        inArray(emailBlasts.status, ["running", "paused"]),
        sql`(
          ${emailMessages.status} IN ('failed', 'bounced')
          OR (${emailMessages.status} = 'skipped'
              AND ${emailMessages.skipReason} IN ('no_email', 'suppressed'))
        )`,
      ),
    );
  if (candidates.length === 0) return 0;

  const windowMap = await loadAddressWindowMap(db, userId);
  let entry = windowMap.get(lower);

  let revived = 0;
  for (const c of candidates) {
    // Keine zweite scheduled/sent-Message an dieselbe Adresse im selben Blast.
    const [dupe] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.blastId, c.blastId),
          eq(emailMessages.toEmail, lower),
          inArray(emailMessages.status, ["scheduled", "sent"]),
        ),
      )
      .limit(1);
    if (dupe) continue;

    const earliestSendAt = computeEarliestSendAt(entry);
    const [updated] = await db
      .update(emailMessages)
      .set({
        status: "scheduled",
        toEmail: lower,
        skipReason: null,
        error: null,
        claimedAt: null,
        sentAt: null,
        internetMessageId: null,
        graphMessageId: null,
        conversationId: null,
        earliestSendAt,
      })
      .where(
        and(eq(emailMessages.id, c.id), eq(emailMessages.status, c.status)),
      )
      .returning({ id: emailMessages.id });
    if (!updated) continue;
    revived += 1;

    // Adresse zählt jetzt als geplant → Schutzlimit für weitere Revives.
    entry = entry ?? { sentAt: [], scheduled: 0 };
    entry.scheduled += 1;
    windowMap.set(lower, entry);

    const counterSet: Record<string, unknown> = { updatedAt: new Date() };
    if (c.status === "failed") {
      counterSet.failedCount = sql`GREATEST(COALESCE(${emailBlasts.failedCount}, 0) - 1, 0)`;
    } else if (c.status === "bounced") {
      counterSet.bouncedCount = sql`GREATEST(COALESCE(${emailBlasts.bouncedCount}, 0) - 1, 0)`;
      counterSet.sentCount = sql`GREATEST(COALESCE(${emailBlasts.sentCount}, 0) - 1, 0)`;
    } else {
      counterSet.skippedCount = sql`GREATEST(COALESCE(${emailBlasts.skippedCount}, 0) - 1, 0)`;
      counterSet.totalCount = sql`${emailBlasts.totalCount} + 1`;
    }
    await db.update(emailBlasts).set(counterSet).where(eq(emailBlasts.id, c.blastId));
  }
  return revived;
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
  mailboxEmail: string | null;
  earliestSendAt: Date | null;
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
        mailboxEmail: mailboxConnections.emailAddress,
        earliestSendAt: emailMessages.earliestSendAt,
      })
      .from(emailMessages)
      .innerJoin(leads, eq(leads.id, emailMessages.leadId))
      .leftJoin(
        mailboxConnections,
        eq(mailboxConnections.id, emailMessages.mailboxConnectionId),
      )
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
      mailboxEmail: r.mailboxEmail ?? null,
      earliestSendAt: r.earliestSendAt ?? null,
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
