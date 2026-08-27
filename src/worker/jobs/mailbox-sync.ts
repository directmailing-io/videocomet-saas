/**
 * Rückkanal-Sync für Outreach-Postfächer (Kontrakt Kapitel 6).
 *
 * 5-min-Loop: pro verbundenem Postfach neue Inbox-Nachrichten holen
 * (m365: Graph-Delta ab syncState.deltaLink; smtp: IMAP-UID-Polling ab
 * syncState.lastSeenUid) und auf zwei Muster prüfen:
 *
 *  (a) NDR/Bounce — Absender postmaster@/mailer-daemon ODER
 *      multipart/report; unsere internetMessageId (VOR dem Versand
 *      persistiert) wird in Body/Headern gesucht ⇒ Message bounced,
 *      Suppression(bounce), Refund über den idempotenten
 *      Failure-Reconcile des Blasts.
 *  (b) Reply — In-Reply-To/References enthält unsere internetMessageId
 *      oder (m365) conversationId-Match ⇒ repliedAt, leadEvent,
 *      weitere scheduled-Messages an dieselbe Adresse geskippt.
 *
 * Fehlertoleranz: ein kaputtes Postfach (lastError) stoppt den Loop nie.
 * syncState wird per jsonb-Merge geschrieben, damit der Warmup-Zähler
 * des Drip-Workers nicht überschrieben wird.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  emailBlasts,
  emailMessages,
  mailboxConnections,
  type MailboxConnection,
  type MailboxSyncState,
} from "@/lib/db/schema";
import {
  listOpenSentMessages,
  maybeAutoPauseForBounces,
  skipScheduledMessagesToEmail,
  upsertSuppression,
  type OpenSentMessage,
} from "@/lib/db/queries/email-blasts";
import { insertLeadEvent } from "@/lib/db/queries/lead-events";
import { decryptMailboxSecret } from "@/lib/mailbox/crypto";
import { pollInbox } from "@/lib/mailbox/imap";
import {
  M365AuthError,
  fetchInboxDelta,
  fetchMessageDetail,
  getFreshAccessToken,
} from "@/lib/msgraph/client";

const TICK_INTERVAL_MS = 5 * 60 * 1000;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(`[mailbox-sync] ${msg}`, extra);
  else fn(`[mailbox-sync] ${msg}`);
}

function isNdrSender(fromAddress: string | null | undefined): boolean {
  if (!fromAddress) return false;
  const lower = fromAddress.toLowerCase();
  return lower.startsWith("postmaster@") || lower.includes("mailer-daemon");
}

/** `<uuid@videocomet.de>` ⇒ `uuid@videocomet.de` (Suche ohne Klammern). */
function bareMessageId(id: string): string {
  return id.replace(/^</, "").replace(/>$/, "");
}

/** Findet die erste offene Message, deren internetMessageId im Text vorkommt. */
function findByMessageIdInText(
  text: string,
  candidates: OpenSentMessage[],
): OpenSentMessage | null {
  for (const c of candidates) {
    if (!c.internetMessageId) continue;
    if (text.includes(bareMessageId(c.internetMessageId))) return c;
  }
  return null;
}

async function handleBounce(target: OpenSentMessage): Promise<void> {
  const [updated] = await db
    .update(emailMessages)
    .set({ status: "bounced" })
    .where(sql`${emailMessages.id} = ${target.id} AND ${emailMessages.status} = 'sent'`)
    .returning({ id: emailMessages.id });
  if (!updated) return; // schon verarbeitet
  await db
    .update(emailBlasts)
    .set({
      bouncedCount: sql`COALESCE(${emailBlasts.bouncedCount}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(eq(emailBlasts.id, target.blastId));
  await upsertSuppression({
    userId: target.userId,
    email: target.toEmail,
    reason: "bounce",
    sourceMessageId: target.id,
  });
  const paused = await maybeAutoPauseForBounces(target.blastId);
  if (paused) {
    log("warn", `bounce guard: blast ${target.blastId} automatisch pausiert`);
  }
  log("info", `bounce: message ${target.id} (${target.toEmail})`);
}

async function handleReply(
  target: OpenSentMessage,
  conversationId?: string | null,
): Promise<void> {
  if (target.repliedAt) return;
  const [updated] = await db
    .update(emailMessages)
    .set({
      repliedAt: new Date(),
      ...(conversationId ? { conversationId } : {}),
    })
    .where(
      sql`${emailMessages.id} = ${target.id} AND ${emailMessages.repliedAt} IS NULL`,
    )
    .returning({ id: emailMessages.id });
  if (!updated) return;
  await db
    .update(emailBlasts)
    .set({
      repliedCount: sql`COALESCE(${emailBlasts.repliedCount}, 0) + 1`,
      updatedAt: new Date(),
    })
    .where(eq(emailBlasts.id, target.blastId));
  await insertLeadEvent({ leadId: target.leadId, kind: "email_reply" });
  await skipScheduledMessagesToEmail(target.userId, target.toEmail, "replied");
  log("info", `reply: message ${target.id} (${target.toEmail})`);
}

/** jsonb-Merge, damit warmup/andere Cursor-Keys erhalten bleiben. */
async function mergeSyncState(
  mailboxId: string,
  patch: Partial<MailboxSyncState>,
): Promise<void> {
  await db.execute(
    sql`UPDATE mailbox_connections
        SET sync_state = COALESCE(sync_state, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
            last_sync_at = now(),
            last_error = NULL,
            updated_at = now()
        WHERE id = ${mailboxId}`,
  );
}

// ── m365 ───────────────────────────────────────────────────────────────────

async function syncM365Mailbox(m: MailboxConnection): Promise<void> {
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(m);
  } catch (err) {
    if (err instanceof M365AuthError && err.tokenExpired) return; // markiert
    throw err;
  }

  const prevDeltaLink = m.syncState?.deltaLink ?? null;
  const delta = await fetchInboxDelta(accessToken, prevDeltaLink);

  // Initial-Sync: Bestand ignorieren, nur Cursor persistieren.
  if (!prevDeltaLink) {
    await mergeSyncState(m.id, { deltaLink: delta.deltaLink });
    return;
  }

  const open = await listOpenSentMessages(m.id);
  const byConversation = new Map<string, OpenSentMessage>();
  for (const o of open) {
    if (o.conversationId) byConversation.set(o.conversationId, o);
  }

  for (const msg of delta.messages) {
    if (msg["@removed"] || msg.isDraft) continue;
    const from = msg.from?.emailAddress?.address ?? null;
    // Eigene Mails (z. B. Sent-Kopien) überspringen.
    if (from && from.toLowerCase() === m.emailAddress) continue;

    try {
      if (isNdrSender(from)) {
        const detail = await fetchMessageDetail(accessToken, msg.id);
        if (!detail) continue;
        const haystack = [
          detail.body?.content ?? "",
          (detail.internetMessageHeaders ?? [])
            .map((h) => `${h.name}: ${h.value}`)
            .join("\n"),
        ].join("\n");
        const target = findByMessageIdInText(haystack, open);
        if (target) await handleBounce(target);
        continue;
      }

      // Reply: conversationId-Match spart den Detail-Fetch.
      const byConv = msg.conversationId
        ? byConversation.get(msg.conversationId)
        : undefined;
      if (byConv) {
        await handleReply(byConv, msg.conversationId);
        continue;
      }
      const detail = await fetchMessageDetail(accessToken, msg.id);
      if (!detail) continue;
      const refHeaders = (detail.internetMessageHeaders ?? [])
        .filter((h) => /^(in-reply-to|references)$/i.test(h.name ?? ""))
        .map((h) => h.value ?? "")
        .join("\n");
      const target = findByMessageIdInText(refHeaders, open);
      if (target) await handleReply(target, msg.conversationId ?? detail.conversationId);
    } catch (err) {
      log("warn", `m365 message ${msg.id} processing failed:`, err);
    }
  }

  await mergeSyncState(m.id, { deltaLink: delta.deltaLink });
}

// ── SMTP/IMAP ──────────────────────────────────────────────────────────────

function parseMimeHeaders(source: string): Record<string, string> {
  const headerEnd = source.search(/\r?\n\r?\n/);
  const rawHeaders = headerEnd >= 0 ? source.slice(0, headerEnd) : source;
  // Folding auflösen (Fortsetzungszeilen beginnen mit Whitespace).
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(idx + 1).trim();
  }
  return out;
}

async function syncSmtpMailbox(m: MailboxConnection): Promise<void> {
  if (!m.imapHost || !m.username || !m.passwordEncrypted) {
    throw new Error("IMAP-Konfiguration unvollständig.");
  }
  const result = await pollInbox(
    {
      username: m.username,
      password: decryptMailboxSecret(m.passwordEncrypted),
      imapHost: m.imapHost,
      imapPort: m.imapPort ?? 993,
      allowInvalidTls: m.allowInvalidTls,
    },
    m.syncState ?? null,
  );

  if (result.messages.length > 0) {
    const open = await listOpenSentMessages(m.id);
    for (const msg of result.messages) {
      if (msg.fromAddress && msg.fromAddress === m.emailAddress) continue;
      try {
        const source = msg.source.toString("utf8");
        const headers = parseMimeHeaders(source);
        const isNdr =
          isNdrSender(msg.fromAddress) ||
          /multipart\/report/i.test(headers["content-type"] ?? "");
        if (isNdr) {
          const target = findByMessageIdInText(source, open);
          if (target) await handleBounce(target);
          continue;
        }
        const refText = [
          headers["in-reply-to"] ?? "",
          headers["references"] ?? "",
        ].join("\n");
        const target = findByMessageIdInText(refText, open);
        if (target) await handleReply(target);
      } catch (err) {
        log("warn", `imap message uid=${msg.uid} processing failed:`, err);
      }
    }
  }

  await mergeSyncState(m.id, {
    uidValidity: result.syncState.uidValidity,
    lastSeenUid: result.syncState.lastSeenUid,
  });
}

// ── Tick ───────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const mailboxes = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.status, "connected"));

  for (const m of mailboxes) {
    try {
      if (m.provider === "m365") await syncM365Mailbox(m);
      else await syncSmtpMailbox(m);
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? "Sync fehlgeschlagen.";
      log("error", `mailbox ${m.emailAddress} sync failed:`, err);
      await db
        .update(mailboxConnections)
        .set({ lastError: message, lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(mailboxConnections.id, m.id))
        .catch(() => undefined);
    }
  }
}

export function startMailboxSync(): () => void {
  const boot = setTimeout(() => {
    tick().catch((err) => log("error", "boot tick crashed:", err));
  }, 15_000);
  const interval = setInterval(() => {
    tick().catch((err) => log("error", "tick crashed:", err));
  }, TICK_INTERVAL_MS);
  interval.unref();
  return () => {
    clearTimeout(boot);
    clearInterval(interval);
  };
}
