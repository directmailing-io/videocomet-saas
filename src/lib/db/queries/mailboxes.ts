/**
 * CRUD-Queries für Postfach-Verbindungen (mailbox_connections).
 *
 * Invarianten:
 *  - `emailAddress` wird IMMER lowercase persistiert.
 *  - UNIQUE(userId, emailAddress) — ein Postfach pro User nur einmal.
 *  - Löschen ist geblockt, solange ein laufender (running/paused) Blast
 *    das Postfach nutzt.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  emailBlasts,
  mailboxConnections,
  type MailboxConnection,
  type MailboxSendWindow,
  type MailboxStatus,
  type NewMailboxConnection,
} from "@/lib/db/schema";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";

export function todayInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(
      new Date(),
    );
  }
}

/**
 * API-Shape ohne Secrets (passwordEncrypted/refreshTokenEncrypted bleiben
 * server-only). `sentToday` wird fuer die Anzeige genullt, wenn
 * `sentTodayDate` nicht "heute" in der Kundenzeitzone ist.
 */
export function serializeMailbox(m: MailboxConnection) {
  const sentToday =
    m.sentTodayDate === todayInTimezone(m.timezone) ? m.sentToday : 0;
  return {
    id: m.id,
    provider: m.provider,
    emailAddress: m.emailAddress,
    displayName: m.displayName,
    status: m.status,
    smtpHost: m.smtpHost,
    smtpPort: m.smtpPort,
    smtpSecure: m.smtpSecure,
    imapHost: m.imapHost,
    imapPort: m.imapPort,
    username: m.username,
    dailyCap: m.dailyCap,
    warmupStage: m.warmupStage,
    sentToday,
    effectiveDailyLimit: effectiveDailyLimit(m.warmupStage, m.dailyCap),
    timezone: m.timezone,
    sendWindow: m.sendWindow,
    lastError: m.lastError,
    lastSyncAt: m.lastSyncAt,
    createdAt: m.createdAt,
  };
}

export type SerializedMailbox = ReturnType<typeof serializeMailbox>;

export async function listMailboxConnections(
  userId: string,
): Promise<MailboxConnection[]> {
  return db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.userId, userId))
    .orderBy(desc(mailboxConnections.createdAt));
}

export async function getMailboxConnection(
  id: string,
  userId: string,
): Promise<MailboxConnection | null> {
  const rows = await db
    .select()
    .from(mailboxConnections)
    .where(
      and(eq(mailboxConnections.id, id), eq(mailboxConnections.userId, userId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMailboxByEmail(
  userId: string,
  emailAddress: string,
): Promise<MailboxConnection | null> {
  const rows = await db
    .select()
    .from(mailboxConnections)
    .where(
      and(
        eq(mailboxConnections.userId, userId),
        eq(mailboxConnections.emailAddress, emailAddress.toLowerCase()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertMailboxConnection(
  values: NewMailboxConnection,
): Promise<MailboxConnection> {
  const rows = await db
    .insert(mailboxConnections)
    .values({ ...values, emailAddress: values.emailAddress.toLowerCase() })
    .returning();
  return rows[0]!;
}

/**
 * M365-Upsert: Existiert die Adresse für den User bereits, wird die
 * Verbindung reaktiviert (neuer Refresh-Token, Status connected) — das
 * deckt den „Neu verbinden“-Fall nach token_expired ab.
 */
export async function upsertM365Mailbox(input: {
  userId: string;
  emailAddress: string;
  displayName: string | null;
  refreshTokenEncrypted: string;
}): Promise<MailboxConnection> {
  const rows = await db
    .insert(mailboxConnections)
    .values({
      userId: input.userId,
      provider: "m365",
      emailAddress: input.emailAddress.toLowerCase(),
      displayName: input.displayName,
      status: "connected",
      refreshTokenEncrypted: input.refreshTokenEncrypted,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [mailboxConnections.userId, mailboxConnections.emailAddress],
      set: {
        provider: "m365",
        displayName: input.displayName,
        status: "connected",
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}

export interface MailboxSettingsPatch {
  sendWindow?: MailboxSendWindow;
  timezone?: string;
  status?: MailboxStatus;
  dailyCap?: number;
  lastError?: string | null;
}

export async function updateMailboxConnection(
  id: string,
  userId: string,
  patch: MailboxSettingsPatch,
): Promise<MailboxConnection | null> {
  const rows = await db
    .update(mailboxConnections)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(mailboxConnections.id, id), eq(mailboxConnections.userId, userId)),
    )
    .returning();
  return rows[0] ?? null;
}

/** Laufend = running ODER paused — beide blocken das Löschen. */
export async function hasActiveBlast(mailboxConnectionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailBlasts.id })
    .from(emailBlasts)
    .where(
      and(
        eq(emailBlasts.mailboxConnectionId, mailboxConnectionId),
        inArray(emailBlasts.status, ["running", "paused"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function deleteMailboxConnection(
  id: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(mailboxConnections)
    .where(
      and(eq(mailboxConnections.id, id), eq(mailboxConnections.userId, userId)),
    )
    .returning({ id: mailboxConnections.id });
  return rows.length > 0;
}
