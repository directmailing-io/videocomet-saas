/**
 * Drip-Engine für E-Mail-Blasts (Kontrakt Kapitel 6).
 *
 * 60s-Loop (Muster domain-monitor.ts): pro Postfach mit laufenden Blasts
 * wird EINE scheduled-Message atomar geclaimt (`FOR UPDATE SKIP LOCKED`
 * mit Join auf running-Blast), gerendert, als MIME mit eigener
 * Message-ID gebaut und versendet. Der Drip-Abstand entsteht über
 * `nextEligibleAt = now + 60–180s` + Sendefenster + Warmup-Tageslimit.
 *
 * Double-Send-Schutz:
 *  - Claim (claimed_at) VOR allem anderen — parallel laufende Ticks
 *    können dieselbe Message nie doppelt greifen (SKIP LOCKED).
 *  - internetMessageId wird VOR dem Versand persistiert.
 *  - Nach einem tatsächlichen Versand-Versuch gibt es KEIN Retry
 *    (Fehler ⇒ failed). Nur wenn der Token-Refresh VOR dem Versand
 *    scheitert, wird die Message wieder freigegeben (claimed_at NULL).
 *  - Stale Claims (>10 min ohne sentAt) ⇒ failed (Boot + jeder Tick).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  emailBlasts,
  emailMessages,
  leads,
  mailboxConnections,
  runs,
  userDomains,
  type EmailBlastContentSnapshot,
  type MailboxConnection,
} from "@/lib/db/schema";
import type { StoredRunColumnMapping } from "@/lib/placeholders/types";
import { todayInTimezone } from "@/lib/db/queries/mailboxes";
import { maybeCompleteBlast } from "@/lib/db/queries/email-blasts";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";
import { computeEmailGifHash } from "@/lib/email/gif-hash";
import {
  buildUnsubscribeUrl,
  getAppUrl,
  renderOutreachEmail,
} from "@/lib/email/render";
import { buildOutreachMime } from "@/lib/email/mime";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import { decryptMailboxSecret } from "@/lib/mailbox/crypto";
import { generateInternetMessageId, sendViaSmtp } from "@/lib/mailbox/smtp";
import { getFreshAccessToken, sendMailAsMime } from "@/lib/msgraph/client";

const TICK_INTERVAL_MS = 60_000;
const STALE_CLAIM_MINUTES = 10;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(`[email-drip] ${msg}`, extra);
  else fn(`[email-drip] ${msg}`);
}

// ── Sendefenster ───────────────────────────────────────────────────────────

/** ISO-Wochentag (1=Mo … 7=So) + Stunde in der Kundenzeitzone. */
function nowInTimezone(tz: string): { isoWeekday: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
  }
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  return {
    isoWeekday: weekdayMap[weekdayStr] ?? 1,
    hour: Number(hourStr),
  };
}

function isWithinSendWindow(m: MailboxConnection): boolean {
  const w = m.sendWindow;
  const { isoWeekday, hour } = nowInTimezone(m.timezone);
  if (!w.days.includes(isoWeekday)) return false;
  return hour >= w.startHour && hour < w.endHour;
}

// ── Stale-Claim-Recovery ───────────────────────────────────────────────────

export async function recoverStaleEmailClaims(): Promise<number> {
  const rows = await db.execute<{ blast_id: string }>(
    sql`UPDATE email_messages
        SET status = 'failed',
            error = 'Versand abgebrochen: Claim älter als ${sql.raw(String(STALE_CLAIM_MINUTES))} Minuten ohne Ergebnis.'
        WHERE status = 'scheduled' AND claimed_at IS NOT NULL
          AND claimed_at < now() - interval '${sql.raw(String(STALE_CLAIM_MINUTES))} minutes'
        RETURNING blast_id`,
  );
  const list = rows as unknown as Array<{ blast_id: string }>;
  const byBlast = new Map<string, number>();
  for (const r of list) byBlast.set(r.blast_id, (byBlast.get(r.blast_id) ?? 0) + 1);
  for (const [blastId, n] of Array.from(byBlast.entries())) {
    await db
      .update(emailBlasts)
      .set({
        failedCount: sql`COALESCE(${emailBlasts.failedCount}, 0) + ${n}`,
        updatedAt: new Date(),
      })
      .where(eq(emailBlasts.id, blastId));
  }
  if (list.length > 0) log("warn", `recovered ${list.length} stale claim(s)`);
  return list.length;
}

// ── Claim + Versand ────────────────────────────────────────────────────────

async function claimNextMessage(mailboxId: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(
    sql`WITH c AS (
          SELECT em.id
          FROM email_messages em
          JOIN email_blasts b ON b.id = em.blast_id AND b.status = 'running'
          WHERE em.mailbox_connection_id = ${mailboxId}
            AND em.status = 'scheduled'
            AND em.claimed_at IS NULL
          ORDER BY em.created_at, em.id
          LIMIT 1
          FOR UPDATE OF em SKIP LOCKED
        )
        UPDATE email_messages em2
        SET claimed_at = now()
        FROM c
        WHERE em2.id = c.id
        RETURNING em2.id`,
  );
  const list = rows as unknown as Array<{ id: string }>;
  return list[0]?.id ?? null;
}

async function releaseClaim(messageId: string): Promise<void> {
  await db
    .update(emailMessages)
    .set({ claimedAt: null })
    .where(and(eq(emailMessages.id, messageId), eq(emailMessages.status, "scheduled")));
}

async function markMessageFailed(
  messageId: string,
  blastId: string,
  error: string,
): Promise<void> {
  await db
    .update(emailMessages)
    .set({ status: "failed", error: error.slice(0, 1_000) })
    .where(eq(emailMessages.id, messageId));
  await db
    .update(emailBlasts)
    .set({
      failedCount: sql`COALESCE(${emailBlasts.failedCount}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(eq(emailBlasts.id, blastId));
}

/** nextEligibleAt = now + 60–180s (zufälliger Drip-Abstand). */
async function scheduleNextSend(mailboxId: string): Promise<void> {
  const delaySec = 60 + Math.floor(Math.random() * 121);
  await db
    .update(mailboxConnections)
    .set({
      nextEligibleAt: new Date(Date.now() + delaySec * 1_000),
      updatedAt: new Date(),
    })
    .where(eq(mailboxConnections.id, mailboxId));
}

/**
 * Erfolgs-Buchung: sentToday++ (+ Datum), Warmup-Fortschritt beim ersten
 * Versand eines Tages. `syncState.warmup` wird per jsonb-Merge
 * geschrieben, damit parallele Sync-Cursor-Updates nicht verloren gehen.
 */
async function bookSuccessfulSend(m: MailboxConnection, today: string): Promise<void> {
  const sentTodayBefore = m.sentTodayDate === today ? m.sentToday : 0;

  if (sentTodayBefore === 0) {
    const warmup = m.syncState?.warmup;
    if (!warmup || warmup.lastSendDate !== today) {
      let daysInStage = (warmup?.daysInStage ?? 0) + 1;
      let warmupStage = m.warmupStage;
      if (daysInStage >= 5) {
        warmupStage += 1;
        daysInStage = 0;
        log("info", `mailbox ${m.emailAddress}: warmup stage → ${warmupStage}`);
      }
      const patch = JSON.stringify({ warmup: { daysInStage, lastSendDate: today } });
      await db.execute(
        sql`UPDATE mailbox_connections
            SET warmup_stage = ${warmupStage},
                sync_state = COALESCE(sync_state, '{}'::jsonb) || ${patch}::jsonb,
                updated_at = now()
            WHERE id = ${m.id}`,
      );
    }
  }

  await db
    .update(mailboxConnections)
    .set({
      sentToday: sentTodayBefore + 1,
      sentTodayDate: today,
      updatedAt: new Date(),
    })
    .where(eq(mailboxConnections.id, m.id));
}

interface RenderContext {
  snapshot: EmailBlastContentSnapshot;
  leadData: Record<string, string>;
  pageUrl: string | null;
  emailGifUrl: string | null;
  mapping: StoredRunColumnMapping["placeholderMapping"] | Record<string, string> | undefined;
  pageUrlAliases: string[] | null;
}

async function loadRenderContext(message: {
  leadId: string;
  blastId: string;
}): Promise<RenderContext | null> {
  const [blast] = await db
    .select({
      contentSnapshot: emailBlasts.contentSnapshot,
      campaignId: emailBlasts.campaignId,
    })
    .from(emailBlasts)
    .where(eq(emailBlasts.id, message.blastId))
    .limit(1);
  if (!blast) return null;

  const [lead] = await db
    .select({
      data: leads.data,
      slug: leads.slug,
      domainId: leads.domainId,
      runId: leads.runId,
      emailGifUrl: leads.emailGifUrl,
      emailGifHash: leads.emailGifHash,
      videoContentHash: leads.videoContentHash,
    })
    .from(leads)
    .where(eq(leads.id, message.leadId))
    .limit(1);
  if (!lead) return null;

  const [campaign] = await db
    .select({ pageUrlAliases: campaigns.pageUrlAliases })
    .from(campaigns)
    .where(eq(campaigns.id, blast.campaignId))
    .limit(1);

  const [run] = await db
    .select({ columnMapping: runs.columnMapping })
    .from(runs)
    .where(eq(runs.id, lead.runId))
    .limit(1);
  const cm = (run?.columnMapping as StoredRunColumnMapping | null) ?? null;
  const mapping = cm?.placeholderMapping ?? cm?.mapping ?? undefined;

  let customHostname: string | null = null;
  if (lead.domainId) {
    const [d] = await db
      .select({ hostname: userDomains.hostname })
      .from(userDomains)
      .where(eq(userDomains.id, lead.domainId))
      .limit(1);
    customHostname = d?.hostname ?? null;
  }
  const pageUrl = buildLeadPublicUrl(
    { slug: lead.slug, customHostname, defaultAppUrl: getAppUrl() },
    { absolute: true },
  );

  const snapshot = blast.contentSnapshot;
  const gifConfig = snapshot.gifConfig ?? null;
  // GIF nur einbetten, wenn der persistierte Hash zum aktuellen Config-
  // Stand passt — sonst wäre das GIF ein veralteter Ausschnitt.
  const emailGifUrl =
    gifConfig &&
    lead.emailGifUrl &&
    lead.emailGifHash === computeEmailGifHash(lead.videoContentHash, gifConfig)
      ? lead.emailGifUrl
      : null;

  const aliases = (campaign?.pageUrlAliases ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  return {
    snapshot,
    leadData: lead.data,
    pageUrl,
    emailGifUrl,
    mapping,
    pageUrlAliases: aliases.length > 0 ? aliases : null,
  };
}

async function processMailbox(m: MailboxConnection): Promise<void> {
  if (!isWithinSendWindow(m)) return;

  const today = todayInTimezone(m.timezone);
  const sentToday = m.sentTodayDate === today ? m.sentToday : 0;
  const limit = effectiveDailyLimit(m.warmupStage, m.dailyCap);
  if (sentToday >= limit) return;
  if (m.nextEligibleAt && m.nextEligibleAt.getTime() > Date.now()) return;

  const messageId = await claimNextMessage(m.id);
  if (!messageId) return;

  const [message] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, messageId))
    .limit(1);
  if (!message) return;

  const ctx = await loadRenderContext(message);
  if (!ctx) {
    await markMessageFailed(messageId, message.blastId, "Render-Kontext fehlt (Lead/Blast gelöscht).");
    return;
  }

  const appUrl = getAppUrl();
  const rendered = renderOutreachEmail({
    content: ctx.snapshot,
    leadData: ctx.leadData,
    pageUrl: ctx.pageUrl,
    emailGifUrl: ctx.emailGifUrl,
    unsubscribeToken: message.unsubscribeToken,
    mapping: ctx.mapping,
    pageUrlAliases: ctx.pageUrlAliases,
    appUrl,
  });

  // Eigene Message-ID VOR dem Versand persistieren (NDR-Korrelation).
  const internetMessageId = generateInternetMessageId();
  await db
    .update(emailMessages)
    .set({ internetMessageId })
    .where(eq(emailMessages.id, messageId));

  const unsubscribeUrl = buildUnsubscribeUrl(appUrl, message.unsubscribeToken);

  if (m.provider === "m365") {
    let accessToken: string;
    try {
      accessToken = await getFreshAccessToken(m);
    } catch (err) {
      // Kein Versand-Versuch passiert ⇒ Message zurück in die Queue.
      // markMailboxTokenExpired hat Status + Blasts bereits gehandhabt.
      await releaseClaim(messageId);
      log("warn", `mailbox ${m.emailAddress}: token refresh failed — ${(err as Error).message}`);
      return;
    }
    const mime = buildOutreachMime({
      fromName: m.displayName,
      fromAddress: m.emailAddress,
      toAddress: message.toEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      messageId: internetMessageId,
      unsubscribeMailto: m.emailAddress,
      unsubscribeUrl,
    });
    try {
      await sendMailAsMime(accessToken, mime.raw);
    } catch (err) {
      // Nach echtem Versand-Versuch KEIN Retry (Double-Send-Risiko).
      await markMessageFailed(messageId, message.blastId, (err as Error).message);
      await scheduleNextSend(m.id);
      return;
    }
  } else {
    if (!m.smtpHost || !m.smtpPort || !m.username || !m.passwordEncrypted || !m.imapHost) {
      await releaseClaim(messageId);
      await db
        .update(mailboxConnections)
        .set({ lastError: "SMTP-Konfiguration unvollständig.", updatedAt: new Date() })
        .where(eq(mailboxConnections.id, m.id));
      return;
    }
    try {
      await sendViaSmtp({
        config: {
          emailAddress: m.emailAddress,
          username: m.username,
          password: decryptMailboxSecret(m.passwordEncrypted),
          smtpHost: m.smtpHost,
          smtpPort: m.smtpPort,
          smtpSecure: m.smtpSecure ?? true,
          imapHost: m.imapHost,
          imapPort: m.imapPort ?? 993,
          allowInvalidTls: m.allowInvalidTls,
        },
        fromName: m.displayName,
        to: message.toEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        messageId: internetMessageId,
        headers: {
          "List-Unsubscribe": `<mailto:${m.emailAddress}>, <${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    } catch (err) {
      await markMessageFailed(messageId, message.blastId, (err as Error).message);
      await scheduleNextSend(m.id);
      return;
    }
  }

  await db
    .update(emailMessages)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(emailMessages.id, messageId));
  await db
    .update(emailBlasts)
    .set({
      sentCount: sql`COALESCE(${emailBlasts.sentCount}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(eq(emailBlasts.id, message.blastId));
  await bookSuccessfulSend(m, today);
  await scheduleNextSend(m.id);
}

// ── Tick ───────────────────────────────────────────────────────────────────

async function completeFinishedBlasts(): Promise<void> {
  const candidates = await db
    .select({ id: emailBlasts.id })
    .from(emailBlasts)
    .where(
      and(
        eq(emailBlasts.status, "running"),
        sql`NOT EXISTS (SELECT 1 FROM email_messages em
             WHERE em.blast_id = ${emailBlasts.id} AND em.status = 'scheduled')`,
      ),
    );
  for (const c of candidates) {
    const completed = await maybeCompleteBlast(c.id).catch((err) => {
      log("error", `complete check for blast ${c.id} failed:`, err);
      return false;
    });
    if (completed) log("info", `blast ${c.id} completed`);
  }
}

async function tick(): Promise<void> {
  await recoverStaleEmailClaims().catch((err) =>
    log("error", "stale claim recovery failed:", err),
  );

  const mailboxes = await db
    .select()
    .from(mailboxConnections)
    .where(
      and(
        eq(mailboxConnections.status, "connected"),
        inArray(
          mailboxConnections.id,
          db
            .select({ id: emailBlasts.mailboxConnectionId })
            .from(emailBlasts)
            .where(eq(emailBlasts.status, "running")),
        ),
      ),
    );

  for (const m of mailboxes) {
    try {
      await processMailbox(m);
    } catch (err) {
      log("error", `mailbox ${m.emailAddress} tick failed:`, err);
    }
  }

  await completeFinishedBlasts().catch((err) =>
    log("error", "completion pass failed:", err),
  );
}

export function startEmailDrip(): () => void {
  const boot = setTimeout(() => {
    tick().catch((err) => log("error", "boot tick crashed:", err));
  }, 5_000);
  const interval = setInterval(() => {
    tick().catch((err) => log("error", "tick crashed:", err));
  }, TICK_INTERVAL_MS);
  interval.unref();
  return () => {
    clearTimeout(boot);
    clearInterval(interval);
  };
}
