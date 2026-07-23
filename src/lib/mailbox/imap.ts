/**
 * IMAP-Rückkanal via ImapFlow — UID-basiertes Polling.
 *
 * Modell: genau EINE kurzlebige Session pro Postfach und Poll-Durchlauf,
 * keine IDLE-Dauerverbindungen (der mailbox-sync-Worker pollt alle 5 min).
 *
 * `uidValidity`-Wechsel (Server hat die Mailbox neu indiziert) ⇒ alle
 * gespeicherten UIDs sind ungültig ⇒ Reset von `lastSeenUid` auf den
 * aktuellen Stand OHNE Nachrichten zu liefern — sonst würden historische
 * Mails fälschlich als „neu“ verarbeitet.
 */

import { ImapFlow } from "imapflow";
import type { MailboxSyncState } from "@/lib/db/schema";
import type { SmtpImapConfig } from "./smtp";

export interface FetchedImapMessage {
  uid: number;
  internalDate: Date | null;
  fromAddress: string | null;
  subject: string | null;
  /** Roh-MIME der Nachricht (für NDR-/Reply-Erkennung in Step 3). */
  source: Buffer;
}

export interface ImapPollResult {
  messages: FetchedImapMessage[];
  syncState: MailboxSyncState;
  /** true wenn der Server die Mailbox neu indiziert hat (UIDs resettet). */
  uidValidityChanged: boolean;
}

/** Sicherheitslimit pro Poll — mehr wird im nächsten Durchlauf geholt. */
const MAX_MESSAGES_PER_POLL = 200;

type ImapConnectConfig = Pick<
  SmtpImapConfig,
  "username" | "password" | "imapHost" | "imapPort" | "allowInvalidTls"
>;

export async function pollInbox(
  config: ImapConnectConfig,
  previous: MailboxSyncState | null,
): Promise<ImapPollResult> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: config.allowInvalidTls ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX");
    const uidValidity = Number(mailbox.uidValidity ?? 0);
    const uidNext = Number(mailbox.uidNext ?? 1);

    const prevValidity = previous?.uidValidity;
    const prevLastSeen = previous?.lastSeenUid;

    const validityChanged =
      prevValidity !== undefined && prevValidity !== uidValidity;

    if (validityChanged || prevLastSeen === undefined) {
      // Erste Synchronisation bzw. Reset: Cursor auf "jetzt" setzen,
      // Bestandsmails NICHT als neu behandeln.
      return {
        messages: [],
        syncState: { uidValidity, lastSeenUid: Math.max(uidNext - 1, 0) },
        uidValidityChanged: validityChanged,
      };
    }

    const messages: FetchedImapMessage[] = [];
    let highestUid = prevLastSeen;

    if (uidNext - 1 > prevLastSeen) {
      for await (const msg of client.fetch(
        { uid: `${prevLastSeen + 1}:*` },
        { uid: true, envelope: true, internalDate: true, source: true },
        { uid: true },
      )) {
        // IMAP-Eigenheit: `n:*` liefert bei leerem Bereich die letzte
        // vorhandene Nachricht — UIDs unterhalb des Cursors überspringen.
        if (msg.uid <= prevLastSeen) continue;
        if (msg.uid > highestUid) highestUid = msg.uid;
        if (messages.length >= MAX_MESSAGES_PER_POLL) continue;
        const fromEntry = msg.envelope?.from?.[0];
        const rawDate = msg.internalDate ?? null;
        messages.push({
          uid: msg.uid,
          internalDate:
            rawDate instanceof Date ? rawDate : rawDate ? new Date(rawDate) : null,
          fromAddress: fromEntry?.address?.toLowerCase() ?? null,
          subject: msg.envelope?.subject ?? null,
          source: msg.source ?? Buffer.alloc(0),
        });
      }
    }

    return {
      messages,
      syncState: { uidValidity, lastSeenUid: highestUid },
      uidValidityChanged: false,
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // Verbindung war ggf. nie offen
    }
  }
}
