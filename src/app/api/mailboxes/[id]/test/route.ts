export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mailboxes/:id/test — erneuter Verbindungstest.
 *
 * smtp: volle verify-Pipeline (SMTP → Testmail → IMAP) mit gespeicherten
 * Credentials. m365: Token-Refresh + /me. Erfolg setzt status=connected
 * und räumt lastError auf; Fehler wird als deutsche Meldung persistiert.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getMailboxConnection,
  serializeMailbox,
  updateMailboxConnection,
} from "@/lib/db/queries/mailboxes";
import { decryptMailboxSecret } from "@/lib/mailbox/crypto";
import { verifyConnection } from "@/lib/mailbox/smtp";
import {
  M365AuthError,
  fetchMe,
  getFreshAccessToken,
  isM365Configured,
} from "@/lib/msgraph/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const mailbox = await getMailboxConnection(id, auth.user.id);
  if (!mailbox) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  if (mailbox.provider === "smtp") {
    if (
      !mailbox.smtpHost ||
      !mailbox.smtpPort ||
      !mailbox.imapHost ||
      !mailbox.imapPort ||
      !mailbox.username ||
      !mailbox.passwordEncrypted
    ) {
      return NextResponse.json(
        { error: "Die SMTP-Zugangsdaten sind unvollständig. Bitte Postfach neu anlegen." },
        { status: 422 },
      );
    }
    const result = await verifyConnection({
      emailAddress: mailbox.emailAddress,
      username: mailbox.username,
      password: decryptMailboxSecret(mailbox.passwordEncrypted),
      smtpHost: mailbox.smtpHost,
      smtpPort: mailbox.smtpPort,
      smtpSecure: mailbox.smtpSecure ?? mailbox.smtpPort === 465,
      imapHost: mailbox.imapHost,
      imapPort: mailbox.imapPort,
      allowInvalidTls: mailbox.allowInvalidTls,
    });
    if (!result.ok) {
      await updateMailboxConnection(id, auth.user.id, {
        lastError: result.message,
      });
      return NextResponse.json(
        { error: result.message, step: result.step },
        { status: 422 },
      );
    }
    const updated = await updateMailboxConnection(id, auth.user.id, {
      status: mailbox.status === "disabled" ? "disabled" : "connected",
      lastError: null,
    });
    return NextResponse.json({
      ok: true,
      mailbox: updated ? serializeMailbox(updated) : undefined,
    });
  }

  // m365
  if (!isM365Configured()) {
    return NextResponse.json(
      {
        error:
          "Die Microsoft-365-Anbindung ist auf diesem Server nicht konfiguriert (MS_CLIENT_ID / MS_CLIENT_SECRET fehlen).",
      },
      { status: 503 },
    );
  }
  try {
    const accessToken = await getFreshAccessToken(mailbox);
    await fetchMe(accessToken);
  } catch (err) {
    const message =
      err instanceof M365AuthError && err.tokenExpired
        ? "Die Microsoft-Anmeldung ist abgelaufen. Bitte verbinden Sie das Postfach neu."
        : "Der Microsoft-Verbindungstest ist fehlgeschlagen. Bitte versuchen Sie es erneut oder verbinden Sie das Postfach neu.";
    if (!(err instanceof M365AuthError && err.tokenExpired)) {
      await updateMailboxConnection(id, auth.user.id, { lastError: message });
    }
    return NextResponse.json({ error: message }, { status: 422 });
  }
  const updated = await updateMailboxConnection(id, auth.user.id, {
    status: mailbox.status === "disabled" ? "disabled" : "connected",
    lastError: null,
  });
  return NextResponse.json({
    ok: true,
    mailbox: updated ? serializeMailbox(updated) : undefined,
  });
}
