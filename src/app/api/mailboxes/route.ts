export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * E-Mail-Postfächer:
 *
 *  GET  /api/mailboxes  → Liste der eigenen Postfach-Verbindungen
 *  POST /api/mailboxes  → SMTP/IMAP-Postfach anlegen. Pipeline:
 *        Freemail-Block → transporter.verify() → echte Testmail an die
 *        eigene Adresse → ImapFlow-Login + INBOX. Jeder Schritt mit
 *        verständlicher deutscher Fehlermeldung.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  findMailboxByEmail,
  insertMailboxConnection,
  listMailboxConnections,
  serializeMailbox,
} from "@/lib/db/queries/mailboxes";
import { encryptMailboxSecret } from "@/lib/mailbox/crypto";
import { checkFreemailDomain } from "@/lib/mailbox/presets";
import { verifyConnection } from "@/lib/mailbox/smtp";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const mailboxes = await listMailboxConnections(auth.user.id);
  return NextResponse.json({ mailboxes: mailboxes.map(serializeMailbox) });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface CreateBody {
  emailAddress?: unknown;
  displayName?: unknown;
  username?: unknown;
  password?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpSecure?: unknown;
  imapHost?: unknown;
  imapPort?: unknown;
  allowInvalidTls?: unknown;
}

function asPort(value: unknown, fallback?: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback ?? null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

function asHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body muss JSON sein." }, { status: 400 });
  }

  const emailAddress =
    typeof body.emailAddress === "string"
      ? body.emailAddress.trim().toLowerCase()
      : "";
  if (!EMAIL_RE.test(emailAddress)) {
    return NextResponse.json(
      { error: "Bitte eine gültige E-Mail-Adresse angeben." },
      { status: 400 },
    );
  }

  const freemail = checkFreemailDomain(emailAddress);
  if (freemail.blocked) {
    return NextResponse.json({ error: freemail.message }, { status: 422 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json(
      { error: "Bitte das Passwort des Postfachs angeben." },
      { status: 400 },
    );
  }

  const smtpHost = asHost(body.smtpHost);
  const imapHost = asHost(body.imapHost);
  if (!smtpHost || !imapHost) {
    return NextResponse.json(
      { error: "Bitte gültige SMTP- und IMAP-Server angeben (z. B. smtp.ionos.de)." },
      { status: 400 },
    );
  }

  const smtpPort = asPort(body.smtpPort);
  const imapPort = asPort(body.imapPort, 993);
  if (!smtpPort || !imapPort) {
    return NextResponse.json(
      { error: "Bitte gültige Ports angeben (1–65535)." },
      { status: 400 },
    );
  }

  const smtpSecure =
    typeof body.smtpSecure === "boolean" ? body.smtpSecure : smtpPort === 465;
  const username =
    typeof body.username === "string" && body.username.trim() !== ""
      ? body.username.trim()
      : emailAddress;
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim() !== ""
      ? body.displayName.trim().slice(0, 120)
      : null;
  const allowInvalidTls = body.allowInvalidTls === true;

  const existing = await findMailboxByEmail(auth.user.id, emailAddress);
  if (existing) {
    return NextResponse.json(
      { error: "Dieses Postfach ist bereits verbunden." },
      { status: 409 },
    );
  }

  const result = await verifyConnection({
    emailAddress,
    username,
    password,
    smtpHost,
    smtpPort,
    smtpSecure,
    imapHost,
    imapPort,
    allowInvalidTls,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, step: result.step },
      { status: 422 },
    );
  }

  const mailbox = await insertMailboxConnection({
    userId: auth.user.id,
    provider: "smtp",
    emailAddress,
    displayName,
    status: "connected",
    smtpHost,
    smtpPort,
    smtpSecure,
    imapHost,
    imapPort,
    username,
    passwordEncrypted: encryptMailboxSecret(password),
    allowInvalidTls,
  });

  return NextResponse.json({ mailbox: serializeMailbox(mailbox) }, { status: 201 });
}
