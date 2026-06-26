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
              <td style="padding:32px 40px 12px 40px;">
                <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${BRAND_INK};">VIDEOCOMET</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px 40px;">
                ${opts.body}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px;border-top:1px solid ${BRAND_LINE};background:${BRAND_BG};">
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
