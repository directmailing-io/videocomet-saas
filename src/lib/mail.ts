import { Resend } from "resend";

const BRAND_INK = "#222222";
const BRAND_MUTED = "#717171";
const BRAND_LINE = "#EBEBEB";
const BRAND_ACCENT = "#7C5CE8";
const BRAND_SOFT = "#F3EEFF";
const BRAND_BG = "#FAFAFA";

let cachedClient: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.videocomet.de"
  );
}

function fromAddress(): string {
  return process.env.RESEND_FROM ?? "VIDEOCOMET <onboarding@resend.dev>";
}

function shellHtml(opts: { headline: string; preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(opts.headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND_BG};font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:${BRAND_INK};">
    <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
      ${escapeHtml(opts.preheader)}
    </span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${BRAND_LINE};border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 16px 40px;">
                <img src="${appUrl()}/mail/videocomet-logo.png" alt="VIDEOCOMET" width="120" height="28" style="display:block;width:120px;height:28px;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px 40px;">
                ${opts.body}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px;border-top:1px solid ${BRAND_LINE};background:${BRAND_BG};">
                <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                  VIDEOCOMET GmbH · Herrleinstr. 39 · 97437 Haßfurt · <a href="mailto:info@videocomet.de" style="color:${BRAND_MUTED};text-decoration:underline;">info@videocomet.de</a>
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND_MUTED};">
                  Diese Nachricht wurde automatisch versendet. Bitte antworte nicht direkt auf diese E-Mail.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendPasswordResetMailInput {
  to: string;
  token: string;
  firstName?: string | null;
}

export async function sendPasswordResetMail(input: SendPasswordResetMailInput): Promise<void> {
  const link = `${appUrl()}/passwort-zurücksetzen?token=${encodeURIComponent(input.token)}`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Passwort zurücksetzen
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      du hast angefordert, dein Passwort für VIDEOCOMET zurückzusetzen. Klicke auf den Button, um ein neues Passwort zu vergeben. Der Link ist 60 Minuten gültig.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${link}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Neues Passwort vergeben
      </a>
    </p>
    <p style="margin:0 0 6px 0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Kopiere diesen Link in deinen Browser:
    </p>
    <p style="margin:0 0 24px 0;font-size:13px;line-height:1.55;color:${BRAND_ACCENT};word-break:break-all;">
      <a href="${link}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(link)}</a>
    </p>
    <div style="background:${BRAND_SOFT};border-radius:14px;padding:16px 18px;">
      <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_INK};">
        Du hast keinen Reset angefordert? Dann ignoriere diese E-Mail einfach. Dein bisheriges Passwort bleibt aktiv.
      </p>
    </div>
  `;

  const html = shellHtml({
    headline: "Passwort zurücksetzen für VIDEOCOMET",
    preheader: "Setze dein Passwort innerhalb von 60 Minuten zurück.",
    body,
  });

  const text = [
    greeting,
    "",
    "du hast angefordert, dein Passwort für VIDEOCOMET zurückzusetzen.",
    "Öffne diesen Link in deinem Browser, um ein neues Passwort zu vergeben.",
    "Der Link ist 60 Minuten gültig.",
    "",
    link,
    "",
    "Du hast keinen Reset angefordert? Ignoriere diese E-Mail.",
    "",
    "VIDEOCOMET",
  ].join("\n");

  const subject = "Passwort zurücksetzen für VIDEOCOMET";

  const resend = getResend();
  if (!resend) {
    // SECURITY: Reset-Link enthaelt den Token. Wir loggen NUR die
    // ersten 8 Token-Chars (genug zum Korrelieren in Dev), den Rest
    // maskieren wir. In Production ist `getResend()` immer gesetzt,
    // dieser Pfad wird nicht erreicht — aber falls jemand
    // versehentlich Resend deaktiviert, soll der Volltoken nicht in
    // Process-Logs landen.
    const maskedLink = link.replace(/(token=)([^&]+)/, (_m, p1, p2: string) =>
      `${p1}${p2.slice(0, 8)}***`,
    );
    console.log("[mail:dev] sendPasswordResetMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    console.log("[mail:dev] link: %s", maskedLink);
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}

export interface SendMailboxDisconnectedMailInput {
  to: string;
  firstName?: string | null;
  mailboxEmail: string;
}

/**
 * Systemmail bei Postfach-Trennung (status ⇒ token_expired). Wird nur
 * beim Status-Übergang verschickt (Aufrufer stellt Idempotenz sicher).
 */
export async function sendMailboxDisconnectedMail(
  input: SendMailboxDisconnectedMailInput,
): Promise<void> {
  const settingsUrl = `${appUrl()}/einstellungen?tab=postfaecher`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Postfach-Verbindung unterbrochen
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      die Verbindung zu deinem Postfach <strong>${escapeHtml(input.mailboxEmail)}</strong> ist abgelaufen. Laufende E-Mail-Versände über dieses Postfach wurden pausiert. Verbinde das Postfach neu, um den Versand fortzusetzen.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${settingsUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Postfach neu verbinden
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${settingsUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(settingsUrl)}</a>
    </p>
  `;

  const html = shellHtml({
    headline: "Postfach-Verbindung unterbrochen",
    preheader: `Die Verbindung zu ${input.mailboxEmail} ist abgelaufen.`,
    body,
  });

  const text = [
    greeting,
    "",
    `die Verbindung zu deinem Postfach ${input.mailboxEmail} ist abgelaufen.`,
    "Laufende E-Mail-Versände über dieses Postfach wurden pausiert.",
    "Verbinde das Postfach neu, um den Versand fortzusetzen:",
    "",
    settingsUrl,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const subject = "Postfach-Verbindung unterbrochen";

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendMailboxDisconnectedMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}

export interface SendBlastCompletedMailInput {
  to: string;
  firstName?: string | null;
  campaignName: string;
  campaignId: string;
  blastId: string;
  sentCount: number;
  totalCount: number;
  repliedCount: number;
  bouncedCount: number;
}

/** Systemmail nach Blast-Abschluss (running ⇒ completed) mit Kurz-Stats. */
export async function sendBlastCompletedMail(
  input: SendBlastCompletedMailInput,
): Promise<void> {
  const detailUrl = `${appUrl()}/kampagnen/${input.campaignId}/email/${input.blastId}`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Dein E-Mail-Versand ist abgeschlossen
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      der E-Mail-Versand für deine Kampagne <strong>${escapeHtml(input.campaignName)}</strong> ist fertig. Hier die wichtigsten Zahlen:
    </p>
    <div style="background:${BRAND_SOFT};border-radius:14px;padding:18px 20px;margin:0 0 24px 0;">
      <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${BRAND_INK};">
        Versendet: <strong>${input.sentCount} von ${input.totalCount}</strong>
      </p>
      <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${BRAND_INK};">
        Antworten: <strong>${input.repliedCount}</strong>
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND_INK};">
        Bounces: <strong>${input.bouncedCount}</strong>
      </p>
    </div>
    <p style="margin:0 0 28px 0;">
      <a href="${detailUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Auswertung ansehen
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${detailUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(detailUrl)}</a>
    </p>
  `;

  const html = shellHtml({
    headline: "Dein E-Mail-Versand ist abgeschlossen",
    preheader: `${input.sentCount} von ${input.totalCount} E-Mails versendet.`,
    body,
  });

  const text = [
    greeting,
    "",
    `der E-Mail-Versand für deine Kampagne „${input.campaignName}" ist fertig.`,
    "",
    `Versendet: ${input.sentCount} von ${input.totalCount}`,
    `Antworten: ${input.repliedCount}`,
    `Bounces: ${input.bouncedCount}`,
    "",
    `Auswertung: ${detailUrl}`,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const subject = "Dein E-Mail-Versand ist abgeschlossen";

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendBlastCompletedMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}

export interface SendAdminInviteMailInput {
  to: string;
  firstName?: string | null;
  tempPassword: string;
}

export async function sendAdminInviteMail(input: SendAdminInviteMailInput): Promise<void> {
  const loginUrl = `${appUrl()}/login`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Dein VIDEOCOMET-Zugang
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      für dich wurde soeben ein VIDEOCOMET-Konto angelegt. Logge dich mit deiner E-Mail und dem folgenden temporären Passwort ein und vergib direkt ein neues Passwort.
    </p>
    <div style="background:${BRAND_SOFT};border-radius:14px;padding:18px 20px;margin:0 0 24px 0;">
      <p style="margin:0 0 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:${BRAND_MUTED};font-weight:600;">
        Temporäres Passwort
      </p>
      <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:600;color:${BRAND_INK};word-break:break-all;">
        ${escapeHtml(input.tempPassword)}
      </p>
    </div>
    <p style="margin:0 0 28px 0;">
      <a href="${loginUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Zum Login
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${loginUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(loginUrl)}</a>
    </p>
  `;

  const html = shellHtml({
    headline: "Dein VIDEOCOMET-Zugang",
    preheader: "Dein Account ist bereit. Hier sind deine Zugangsdaten.",
    body,
  });

  const text = [
    greeting,
    "",
    "für dich wurde ein VIDEOCOMET-Konto angelegt.",
    "",
    `Login: ${loginUrl}`,
    `Temporäres Passwort: ${input.tempPassword}`,
    "",
    "Bitte vergib nach dem ersten Login direkt ein neues Passwort.",
    "",
    "VIDEOCOMET",
  ].join("\n");

  const subject = "Dein VIDEOCOMET-Zugang";

  const resend = getResend();
  if (!resend) {
    // SECURITY: tempPassword im Dev-Modus NICHT mehr loggen — User
    // bekommt das via Email-Provider oder Admin sieht es im
    // Onboarding-UI, aber NIE in Prozess-Logs (Docker-Logs sind
    // weniger zugriffsgeschuetzt als die Mail-Inbox).
    console.log("[mail:dev] sendAdminInviteMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    console.log("[mail:dev] login: %s", loginUrl);
    console.log("[mail:dev] tempPassword: <masked>");
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}

// ── Abo-Ende-Cleanup-Mails (Migration 0040) ────────────────────────────────
// Drei Mails im Loesch-Zyklus nach Abo-Ende: Ankuendigung (Tag 0),
// Erinnerung (7 Tage vor Loeschung), Bestaetigung (nach Loeschung).
// Idempotenz stellt der Worker-Sweep sicher (Timestamp-Claim vor Versand).

function formatDateDe(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface SendAccountCleanupMailInput {
  to: string;
  firstName?: string | null;
  deleteDate: Date;
}

/** Mail (a): Abo beendet, Loeschdatum angekuendigt, Reaktivierungs-CTA. */
export async function sendAccountCleanupNoticeMail(
  input: SendAccountCleanupMailInput,
): Promise<void> {
  const billingUrl = `${appUrl()}/einstellungen?tab=abrechnung`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";
  const dateStr = formatDateDe(input.deleteDate);

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Dein VIDEOCOMET Abo ist beendet
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      dein VIDEOCOMET Abo ist ausgelaufen. Deine Videos, Landingpages und Kampagnen-Inhalte bleiben noch bis zum <strong>${escapeHtml(dateStr)}</strong> gespeichert. Danach werden sie endgültig gelöscht und alle veröffentlichten Links funktionieren nicht mehr.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      Dein Konto und dein Credit-Guthaben bleiben erhalten. Wenn du dein Abo vorher wieder aktivierst, passiert nichts und alles bleibt wie es ist.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Abo wieder aktivieren
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${billingUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(billingUrl)}</a>
    </p>
  `;

  const subject = `Dein VIDEOCOMET Abo ist beendet. Deine Inhalte werden am ${dateStr} gelöscht`;
  const html = shellHtml({
    headline: "Dein VIDEOCOMET Abo ist beendet",
    preheader: `Deine Inhalte werden am ${dateStr} gelöscht.`,
    body,
  });
  const text = [
    greeting,
    "",
    "dein VIDEOCOMET Abo ist ausgelaufen.",
    `Deine Videos, Landingpages und Kampagnen-Inhalte bleiben noch bis zum ${dateStr} gespeichert.`,
    "Danach werden sie endgültig gelöscht und alle veröffentlichten Links funktionieren nicht mehr.",
    "Dein Konto und dein Credit-Guthaben bleiben erhalten.",
    "",
    "Abo wieder aktivieren:",
    billingUrl,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendAccountCleanupNoticeMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  // Resend-SDK wirft NICHT bei API-Fehlern — Cleanup-Mails muessen aber
  // nachweislich raus sein, bevor der Sweep Timestamps setzt (Loesch-Gate).
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

/** Mail (b): 7 Tage vor Loeschung, letzte Erinnerung. */
export async function sendAccountCleanupReminderMail(
  input: SendAccountCleanupMailInput,
): Promise<void> {
  const billingUrl = `${appUrl()}/einstellungen?tab=abrechnung`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";
  const dateStr = formatDateDe(input.deleteDate);

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Noch 7 Tage bis zur Löschung
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      am <strong>${escapeHtml(dateStr)}</strong> werden deine VIDEOCOMET Videos, Landingpages und Kampagnen-Inhalte endgültig gelöscht. Alle veröffentlichten Links funktionieren danach nicht mehr. Wenn du deine Inhalte behalten möchtest, aktiviere jetzt dein Abo. Dann bleibt alles erhalten.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Abo wieder aktivieren
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${billingUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(billingUrl)}</a>
    </p>
  `;

  const subject = `Noch 7 Tage: Deine VIDEOCOMET Videos und Landingpages werden am ${dateStr} gelöscht`;
  const html = shellHtml({
    headline: "Noch 7 Tage bis zur Löschung",
    preheader: `Am ${dateStr} werden deine Inhalte endgültig gelöscht.`,
    body,
  });
  const text = [
    greeting,
    "",
    `am ${dateStr} werden deine VIDEOCOMET Videos, Landingpages und Kampagnen-Inhalte endgültig gelöscht.`,
    "Alle veröffentlichten Links funktionieren danach nicht mehr.",
    "Wenn du deine Inhalte behalten möchtest, aktiviere jetzt dein Abo:",
    "",
    billingUrl,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendAccountCleanupReminderMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  // Resend-SDK wirft NICHT bei API-Fehlern — Cleanup-Mails muessen aber
  // nachweislich raus sein, bevor der Sweep Timestamps setzt (Loesch-Gate).
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

export interface SendEmailVerificationMailInput {
  to: string;
  firstName?: string | null;
  verifyUrl: string;
}

/** Bestaetigungsmail vor der ersten Buchung (Signup-Flow). */
export async function sendEmailVerificationMail(
  input: SendEmailVerificationMailInput,
): Promise<void> {
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Bestätige deine E-Mail-Adresse
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      schön, dass du bei VIDEOCOMET starten möchtest. Bitte bestätige kurz deine E-Mail-Adresse. Danach geht es direkt weiter zur Buchung.
    </p>
    <p style="margin:0 0 20px 0;">
      <a href="${input.verifyUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        E-Mail bestätigen und weiter zur Buchung
      </a>
    </p>
    <p style="margin:0 0 20px 0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Der Link ist 24 Stunden gültig. Wenn du dich nicht bei VIDEOCOMET registriert hast, kannst du diese E-Mail ignorieren.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${input.verifyUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;word-break:break-all;">${escapeHtml(input.verifyUrl)}</a>
    </p>
  `;

  const subject = "Bestätige deine E-Mail-Adresse für VIDEOCOMET";
  const html = shellHtml({
    headline: "Bestätige deine E-Mail-Adresse",
    preheader: "Ein Klick, dann geht es direkt weiter zur Buchung.",
    body,
  });
  const text = [
    greeting,
    "",
    "schön, dass du bei VIDEOCOMET starten möchtest.",
    "Bitte bestätige kurz deine E-Mail-Adresse. Danach geht es direkt weiter zur Buchung:",
    "",
    input.verifyUrl,
    "",
    "Der Link ist 24 Stunden gültig.",
    "Wenn du dich nicht bei VIDEOCOMET registriert hast, kannst du diese E-Mail ignorieren.",
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendEmailVerificationMail -> %s", input.to);
    console.log("[mail:dev] verifyUrl: %s", input.verifyUrl);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

export interface SendSubscriptionStartedMailInput {
  to: string;
  firstName?: string | null;
}

/** Willkommensmail nach erfolgreichem Abo-Start (Stripe-Webhook). */
export async function sendSubscriptionStartedMail(
  input: SendSubscriptionStartedMailInput,
): Promise<void> {
  const dashboardUrl = `${appUrl()}/dashboard`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Dein VIDEOCOMET Abo ist aktiv
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      willkommen bei VIDEOCOMET. Dein Abo ist ab sofort aktiv und du kannst direkt loslegen: persönliche Videos erstellen, Landingpages veröffentlichen und deine ersten Kampagnen starten.
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      Deine Rechnung erhältst du automatisch per E-Mail von Stripe. Alle Details zu deinem Abo findest du jederzeit in deinen Einstellungen.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${dashboardUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Jetzt loslegen
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Fragen zum Start? Schreib uns an <a href="mailto:info@videocomet.de" style="color:${BRAND_ACCENT};text-decoration:underline;">info@videocomet.de</a>.
    </p>
  `;

  const subject = "Willkommen bei VIDEOCOMET: Dein Abo ist aktiv";
  const html = shellHtml({
    headline: "Dein VIDEOCOMET Abo ist aktiv",
    preheader: "Willkommen bei VIDEOCOMET. Du kannst direkt loslegen.",
    body,
  });
  const text = [
    greeting,
    "",
    "willkommen bei VIDEOCOMET. Dein Abo ist ab sofort aktiv.",
    "Du kannst direkt loslegen: persönliche Videos erstellen, Landingpages veröffentlichen und Kampagnen starten.",
    "Deine Rechnung erhältst du automatisch per E-Mail von Stripe.",
    "",
    "Jetzt loslegen:",
    dashboardUrl,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendSubscriptionStartedMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

export interface SendTopupConfirmationMailInput {
  to: string;
  firstName?: string | null;
  packageLabel: string;
  credits: number;
  newBalance: number;
}

/** Bestaetigung nach erfolgreichem Credit-Kauf (Stripe-Webhook). */
export async function sendTopupConfirmationMail(
  input: SendTopupConfirmationMailInput,
): Promise<void> {
  const billingUrl = `${appUrl()}/einstellungen?tab=abrechnung`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";
  const creditsStr = input.credits.toLocaleString("de-DE");
  const balanceStr = input.newBalance.toLocaleString("de-DE");

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Deine Credits sind da
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      danke für deinen Kauf. Wir haben dir soeben <strong>${escapeHtml(creditsStr)} Credits</strong> gutgeschrieben. Sie sind sofort verfügbar und verfallen nie.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px 0;border:1px solid ${BRAND_LINE};border-radius:12px;border-collapse:separate;">
      <tr>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_MUTED};border-bottom:1px solid ${BRAND_LINE};">Paket</td>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_INK};font-weight:600;text-align:right;border-bottom:1px solid ${BRAND_LINE};">${escapeHtml(input.packageLabel)}</td>
      </tr>
      <tr>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_MUTED};border-bottom:1px solid ${BRAND_LINE};">Gutgeschrieben</td>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_INK};font-weight:600;text-align:right;border-bottom:1px solid ${BRAND_LINE};">${escapeHtml(creditsStr)} Credits</td>
      </tr>
      <tr>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_MUTED};">Neues Guthaben</td>
        <td style="padding:14px 18px;font-size:14px;color:${BRAND_INK};font-weight:600;text-align:right;">${escapeHtml(balanceStr)} Credits</td>
      </tr>
    </table>
    <p style="margin:0 0 28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Guthaben ansehen
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Deine Rechnung erhältst du automatisch per E-Mail von Stripe.
    </p>
  `;

  const subject = `${creditsStr} Credits gutgeschrieben`;
  const html = shellHtml({
    headline: "Deine Credits sind da",
    preheader: `${creditsStr} Credits gutgeschrieben. Neues Guthaben: ${balanceStr} Credits.`,
    body,
  });
  const text = [
    greeting,
    "",
    `danke für deinen Kauf. Wir haben dir soeben ${creditsStr} Credits gutgeschrieben.`,
    "Sie sind sofort verfügbar und verfallen nie.",
    "",
    `Paket: ${input.packageLabel}`,
    `Gutgeschrieben: ${creditsStr} Credits`,
    `Neues Guthaben: ${balanceStr} Credits`,
    "",
    "Guthaben ansehen:",
    billingUrl,
    "",
    "Deine Rechnung erhältst du automatisch per E-Mail von Stripe.",
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendTopupConfirmationMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

export interface SendAccountCleanupDoneMailInput {
  to: string;
  firstName?: string | null;
}

/** Mail (c): Loeschung durchgefuehrt, Konto + Credits bleiben. */
export async function sendAccountCleanupDoneMail(
  input: SendAccountCleanupDoneMailInput,
): Promise<void> {
  const billingUrl = `${appUrl()}/einstellungen?tab=abrechnung`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Deine VIDEOCOMET Inhalte wurden gelöscht
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      wie angekündigt wurden deine Videos, Landingpages und Kampagnen-Inhalte heute endgültig gelöscht. Dein Konto und dein Credit-Guthaben bleiben erhalten. Du kannst jederzeit mit einem neuen Abo wieder starten.
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Jetzt wieder starten
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Fragen dazu? Schreib uns an <a href="mailto:info@videocomet.de" style="color:${BRAND_ACCENT};text-decoration:underline;">info@videocomet.de</a>.
    </p>
  `;

  const subject = "Deine VIDEOCOMET Inhalte wurden gelöscht";
  const html = shellHtml({
    headline: "Deine VIDEOCOMET Inhalte wurden gelöscht",
    preheader: "Konto und Credit-Guthaben bleiben erhalten.",
    body,
  });
  const text = [
    greeting,
    "",
    "wie angekündigt wurden deine Videos, Landingpages und Kampagnen-Inhalte heute endgültig gelöscht.",
    "Dein Konto und dein Credit-Guthaben bleiben erhalten.",
    "Du kannst jederzeit mit einem neuen Abo wieder starten:",
    "",
    billingUrl,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendAccountCleanupDoneMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }
  const sendResult = await resend.emails.send({ from: fromAddress(), to: input.to, subject, html, text });
  // Resend-SDK wirft NICHT bei API-Fehlern — Cleanup-Mails muessen aber
  // nachweislich raus sein, bevor der Sweep Timestamps setzt (Loesch-Gate).
  if (sendResult.error) throw new Error(`Resend: ${sendResult.error.message}`);
}

// ───────────────────────────────────────────────────────────────────────────
// ── Run-Abschluss-Benachrichtigungen (W3) ──────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

export interface RunMailFailedLead {
  /** Anzeigename (Vorname/Nachname/Firma aus den Lead-Daten, Fallback Zeile). */
  name: string;
  /** Fehlergrund (lead.errorMessage bzw. Stage des letzten error-Events). */
  reason: string;
}

export interface SendRunCompletedMailInput {
  to: string;
  firstName?: string | null;
  runName: string;
  campaignId: string;
  runId: string;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  /** Max. 20 Einträge; Rest steckt in failedMoreCount. */
  failedLeads: RunMailFailedLead[];
  /** Anzahl weiterer fehlgeschlagener Leads jenseits der Liste. */
  failedMoreCount: number;
  /** Leads, die ohne personalisierte Begrüßung (Original-Video) liefen. */
  introFallbackCount: number;
}

/**
 * Systemmail nach Run-Abschluss (alle Leads terminal). Genau EINE Mail pro
 * Run; der atomare Claim passiert im Caller (run-notifications.ts).
 * Hinweis Texte: keine em-Dashes verwenden.
 */
export async function sendRunCompletedMail(
  input: SendRunCompletedMailInput,
): Promise<void> {
  const detailUrl = `${appUrl()}/kampagnen/${input.campaignId}/runs/${input.runId}`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";
  const allOk = input.failedCount === 0;

  const failedRowsHtml = input.failedLeads
    .map(
      (l) => `
      <p style="margin:0 0 6px 0;font-size:13px;line-height:1.6;color:${BRAND_INK};">
        <strong>${escapeHtml(l.name)}</strong>: ${escapeHtml(l.reason)}
      </p>`,
    )
    .join("");
  const failedBlockHtml = allOk
    ? ""
    : `
    <div style="background:#FDF2F2;border-radius:14px;padding:16px 18px;margin:0 0 24px 0;">
      <p style="margin:0 0 10px 0;font-size:14px;font-weight:600;line-height:1.5;color:${BRAND_INK};">
        ${input.failedCount} ${input.failedCount === 1 ? "Lead ist" : "Leads sind"} fehlgeschlagen:
      </p>
      ${failedRowsHtml}
      ${
        input.failedMoreCount > 0
          ? `<p style="margin:6px 0 0 0;font-size:13px;line-height:1.6;color:${BRAND_MUTED};">und ${input.failedMoreCount} weitere.</p>`
          : ""
      }
      <p style="margin:10px 0 0 0;font-size:13px;line-height:1.6;color:${BRAND_MUTED};">
        Du kannst fehlgeschlagene Leads in der Runden-Ansicht über &bdquo;Neu generieren&ldquo; erneut versuchen.
      </p>
    </div>`;

  const introBlockHtml =
    input.introFallbackCount > 0
      ? `
    <div style="background:#FFF8E6;border-radius:14px;padding:16px 18px;margin:0 0 24px 0;">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND_INK};">
        Hinweis: Bei ${input.introFallbackCount} ${input.introFallbackCount === 1 ? "Video" : "Videos"} konnte die personalisierte Begrüßung nicht erzeugt werden. Diese Videos verwenden dein Original-Video und sind trotzdem vollständig nutzbar.
      </p>
    </div>`
      : "";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      ${allOk ? "Deine Videos sind fertig" : "Deine Runde ist abgeschlossen"}
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      deine Runde <strong>${escapeHtml(input.runName)}</strong> ist fertig. Hier die Zusammenfassung:
    </p>
    <div style="background:${BRAND_SOFT};border-radius:14px;padding:18px 20px;margin:0 0 24px 0;">
      <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:${BRAND_INK};">
        Erfolgreich: <strong>${input.completedCount} von ${input.totalCount}</strong>
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND_INK};">
        Fehlgeschlagen: <strong>${input.failedCount}</strong>
      </p>
    </div>
    ${failedBlockHtml}
    ${introBlockHtml}
    <p style="margin:0 0 28px 0;">
      <a href="${detailUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Runde ansehen
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Funktioniert der Button nicht? Öffne diesen Link in deinem Browser:<br />
      <a href="${detailUrl}" style="color:${BRAND_ACCENT};text-decoration:underline;">${escapeHtml(detailUrl)}</a><br /><br />
      Du möchtest keine Abschluss-Mails mehr? In den <a href="${appUrl()}/einstellungen" style="color:${BRAND_ACCENT};text-decoration:underline;">Einstellungen</a> kannst du sie deaktivieren.
    </p>
  `;

  const subject = allOk
    ? `Deine Videos sind fertig: ${input.runName}`
    : `Runde abgeschlossen mit ${input.failedCount} ${input.failedCount === 1 ? "Fehler" : "Fehlern"}: ${input.runName}`;

  const html = shellHtml({
    headline: subject,
    preheader: `${input.completedCount} von ${input.totalCount} Leads erfolgreich.`,
    body,
  });

  const textFailedLines = input.failedLeads.map((l) => `- ${l.name}: ${l.reason}`);
  if (input.failedMoreCount > 0) {
    textFailedLines.push(`... und ${input.failedMoreCount} weitere.`);
  }
  const text = [
    greeting,
    "",
    `deine Runde „${input.runName}" ist fertig.`,
    "",
    `Erfolgreich: ${input.completedCount} von ${input.totalCount}`,
    `Fehlgeschlagen: ${input.failedCount}`,
    ...(textFailedLines.length > 0 ? ["", ...textFailedLines] : []),
    ...(input.introFallbackCount > 0
      ? [
          "",
          `Hinweis: ${input.introFallbackCount} Video(s) ohne personalisierte Begrüßung (Original-Video verwendet).`,
        ]
      : []),
    "",
    `Runde ansehen: ${detailUrl}`,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendRunCompletedMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}

export interface SendRunFailedMailInput {
  to: string;
  firstName?: string | null;
  runName: string;
  campaignId: string;
  runId: string;
  /** Klartext-Grund (z.B. Watchdog oder 0-Lead-Guard). */
  reason: string;
}

/** Systemmail, wenn ein ganzer Run fatal fehlschlägt (status='failed'). */
export async function sendRunFailedMail(
  input: SendRunFailedMailInput,
): Promise<void> {
  const detailUrl = `${appUrl()}/kampagnen/${input.campaignId}/runs/${input.runId}`;
  const greeting = input.firstName ? `Hallo ${input.firstName},` : "Hallo,";

  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${BRAND_INK};line-height:1.25;">
      Deine Runde konnte nicht abgeschlossen werden
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      ${escapeHtml(greeting)}
    </p>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">
      deine Runde <strong>${escapeHtml(input.runName)}</strong> wurde leider abgebrochen.
    </p>
    <div style="background:#FDF2F2;border-radius:14px;padding:16px 18px;margin:0 0 24px 0;">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND_INK};">
        ${escapeHtml(input.reason)}
      </p>
    </div>
    <p style="margin:0 0 28px 0;">
      <a href="${detailUrl}" style="display:inline-block;background:${BRAND_ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px;">
        Runde ansehen
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">
      Es wurden nur Credits für erfolgreich erzeugte Videos verwendet. Bei Fragen erreichst du uns unter <a href="mailto:info@videocomet.de" style="color:${BRAND_ACCENT};text-decoration:underline;">info@videocomet.de</a>.
    </p>
  `;

  const subject = `Runde abgebrochen: ${input.runName}`;
  const html = shellHtml({
    headline: subject,
    preheader: "Deine Runde konnte nicht abgeschlossen werden.",
    body,
  });
  const text = [
    greeting,
    "",
    `deine Runde „${input.runName}" wurde leider abgebrochen.`,
    "",
    `Grund: ${input.reason}`,
    "",
    `Runde ansehen: ${detailUrl}`,
    "",
    "VIDEOCOMET",
  ].join("\n");

  const resend = getResend();
  if (!resend) {
    console.log("[mail:dev] sendRunFailedMail -> %s", input.to);
    console.log("[mail:dev] subject: %s", subject);
    return;
  }

  await resend.emails.send({
    from: fromAddress(),
    to: input.to,
    subject,
    html,
    text,
  });
}
