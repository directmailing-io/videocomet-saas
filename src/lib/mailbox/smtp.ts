/**
 * SMTP-Versand + Verbindungstest via nodemailer.
 *
 * `verifyConnection()` fährt die volle Pipeline:
 *   1. transporter.verify()          — SMTP-Login
 *   2. echte Testmail an sich selbst — „VideoComet Verbindungstest“
 *   3. ImapFlow-Login + INBOX öffnen — Rückkanal funktioniert
 *
 * Jeder Schritt liefert bei Fehlern eine verständliche deutsche Meldung.
 * `rejectUnauthorized:false` gibt es NUR über das explizite Opt-in
 * `allowInvalidTls` (default strikt).
 */

import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { ImapFlow } from "imapflow";

export interface SmtpImapConfig {
  emailAddress: string;
  username: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  /** true = 465 implizit TLS, false = 587 STARTTLS. */
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  /** Expliziter Opt-in für selbstsignierte Zertifikate (UI: „Erweitert“). */
  allowInvalidTls?: boolean;
}

export type VerifyStep = "smtp" | "testmail" | "imap";

export type VerifyConnectionResult =
  | { ok: true }
  | { ok: false; step: VerifyStep; message: string };

const STEP_LABEL: Record<VerifyStep, string> = {
  smtp: "SMTP-Verbindung",
  testmail: "Testmail-Versand",
  imap: "IMAP-Verbindung",
};

function translateError(step: VerifyStep, err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string } | null;
  const code = e?.code ?? "";
  const responseCode = e?.responseCode ?? 0;
  const raw = (e?.message ?? String(err)).slice(0, 300);
  const label = STEP_LABEL[step];

  if (code === "EAUTH" || responseCode === 535 || /auth|login|credential/i.test(raw)) {
    return `${label}: Anmeldung fehlgeschlagen. Bitte prüfen Sie Benutzername und Passwort${
      step === "imap" ? " (manche Anbieter verlangen für IMAP ein eigenes Passwort)" : ""
    }.`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `${label}: Der Server wurde nicht gefunden. Bitte prüfen Sie den Hostnamen.`;
  }
  if (code === "ECONNREFUSED") {
    return `${label}: Der Server hat die Verbindung abgelehnt. Bitte prüfen Sie Host und Port.`;
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || /timeout/i.test(raw)) {
    return `${label}: Zeitüberschreitung — der Server hat nicht geantwortet. Bitte prüfen Sie Host, Port und Firewall-Einstellungen.`;
  }
  if (
    code === "ESOCKET" ||
    /certificate|self.signed|tls|ssl|wrong version number/i.test(raw)
  ) {
    return `${label}: TLS-/Zertifikatsproblem (${raw}). Prüfen Sie, ob Port und Verschlüsselung zusammenpassen (465 = SSL/TLS, 587 = STARTTLS).`;
  }
  if (responseCode >= 500) {
    return `${label}: Der Server hat die Anfrage abgelehnt (${raw}).`;
  }
  return `${label} fehlgeschlagen: ${raw}`;
}

function buildTransport(config: SmtpImapConfig) {
  const options: SMTPTransport.Options = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    // STARTTLS (587) darf nie unverschluesselt zurueckfallen
    requireTLS: !config.smtpSecure,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: config.allowInvalidTls ? { rejectUnauthorized: false } : undefined,
  };
  return nodemailer.createTransport(options);
}

function buildImapClient(config: SmtpImapConfig): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: config.allowInvalidTls ? { rejectUnauthorized: false } : undefined,
  });
}

export async function verifyConnection(
  config: SmtpImapConfig,
): Promise<VerifyConnectionResult> {
  const transporter = buildTransport(config);

  try {
    await transporter.verify();
  } catch (err) {
    transporter.close();
    return { ok: false, step: "smtp", message: translateError("smtp", err) };
  }

  try {
    await transporter.sendMail({
      from: config.emailAddress,
      to: config.emailAddress,
      subject: "VideoComet Verbindungstest",
      text: [
        "Dieser Verbindungstest wurde von VideoComet ausgelöst.",
        "",
        "Wenn Sie diese E-Mail sehen, funktioniert der Versand über Ihr Postfach.",
        "Sie können die Nachricht löschen.",
      ].join("\n"),
    });
  } catch (err) {
    return { ok: false, step: "testmail", message: translateError("testmail", err) };
  } finally {
    transporter.close();
  }

  const imap = buildImapClient(config);
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX");
  } catch (err) {
    return { ok: false, step: "imap", message: translateError("imap", err) };
  } finally {
    try {
      await imap.logout();
    } catch {
      // Verbindung war ggf. nie offen
    }
  }

  return { ok: true };
}

export interface SendViaSmtpInput {
  config: SmtpImapConfig;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Eigene Message-ID inkl. spitzer Klammern, z. B. `<uuid@videocomet.de>`. */
  messageId: string;
  headers?: Record<string, string>;
}

export interface SendViaSmtpResult {
  messageId: string;
  accepted: string[];
}

/** Generiert die eigene Message-ID VOR dem Versand (NDR-Korrelation). */
export function generateInternetMessageId(): string {
  return `<${randomUUID()}@videocomet.de>`;
}

export async function sendViaSmtp(
  input: SendViaSmtpInput,
): Promise<SendViaSmtpResult> {
  const transporter = buildTransport(input.config);
  try {
    const info = await transporter.sendMail({
      from: input.fromName
        ? { name: input.fromName, address: input.config.emailAddress }
        : input.config.emailAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      messageId: input.messageId,
      headers: input.headers,
    });
    return {
      messageId: info.messageId ?? input.messageId,
      accepted: (info.accepted ?? []).map((a) => String(a)),
    };
  } finally {
    transporter.close();
  }
}
