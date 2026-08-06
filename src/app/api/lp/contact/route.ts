export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";

/**
 * Kontakt-Endpoint fuer die per Custom-LP eingebetteten Beratungs-
 * Formulare. Wird vom Formular-JS auf einer Custom-Domain per fetch()
 * aufgerufen — deshalb IMMER mit CORS-Antwort (Wildcard, weil das
 * Formular auf beliebigen Custom-Domains laufen kann).
 *
 * Empfaenger sind aktuell hardcoded fuer BODYTIME concept. Wenn andere
 * Kunden das Formular auch nutzen sollen: pro Custom-Domain-ID ein
 * Empfaenger-Set konfigurierbar machen (spaeter).
 */

const slotSchema = z.union([
  z.string().trim().max(120),
  z.object({
    date: z.string().trim().max(20).optional(),
    time: z.string().trim().max(20).optional(),
  }),
]);

const bodySchema = z.object({
  first_name: z.string().trim().min(1, "Vorname fehlt.").max(200),
  last_name: z.string().trim().min(1, "Nachname fehlt.").max(200),
  phone: z.string().trim().min(3, "Telefon fehlt.").max(60),
  phone_country: z.string().trim().max(10).optional().default(""),
  email: z.string().trim().email("E-Mail ungueltig.").optional(),
  city: z.string().trim().max(200).optional(),
  slots: z.array(slotSchema).max(20).optional().default([]),
});

// TEST-PHASE: nur an Christoph. Sobald das Wording sitzt, kommt
// info@bodytime-concept.de dazu.
const RECIPIENTS = ["christoph@daniel-kurzeja.de"];

const WEEKDAYS_DE = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];
const MONTHS_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** Formatiert ein Slot-Objekt {date, time} zu „Dienstag, 12. August um 09:00 Uhr". */
function formatSlot(raw: z.infer<typeof slotSchema>): string | null {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  const date = raw.date?.trim() ?? "";
  const time = raw.time?.trim() ?? "";
  if (!date && !time) return null;
  if (!date) return time ? `Uhrzeit ${time} Uhr` : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return `${date}${time ? ` um ${time} Uhr` : ""}`;
  const [_, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const weekday = WEEKDAYS_DE[dt.getUTCDay()];
  const month = MONTHS_DE[Number(mo) - 1];
  const day = String(Number(d));
  const dateText = `${weekday}, ${day}. ${month}`;
  return time ? `${dateText} um ${time} Uhr` : dateText;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Ungueltiger JSON-Body." },
      { status: 400, headers: corsHeaders() },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Pflichtfelder fehlen.";
    return NextResponse.json(
      { success: false, error: firstIssue },
      { status: 400, headers: corsHeaders() },
    );
  }
  const data = parsed.data;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[lp/contact] RESEND_API_KEY not set — cannot send mail");
    return NextResponse.json(
      { success: false, error: "Mailversand nicht konfiguriert." },
      { status: 500, headers: corsHeaders() },
    );
  }

  // From-Name traegt den Anfragenden-Namen, damit im Postfach sofort
  // sichtbar ist WER anfragt (nicht nur „VIDEOCOMET"). Absender-Adresse
  // bleibt no-reply (nicht die User-E-Mail, sonst SPF/DMARC-Bruch);
  // eingehende Antworten laufen via Reply-To auf die User-E-Mail zurück.
  const fullName = `${data.first_name} ${data.last_name}`.trim();
  const senderDomain =
    process.env.RESEND_FROM_DOMAIN ?? "no-reply@videocomet.de";
  const from = `${fullName} (Beratungsanfrage) <${senderDomain}>`;
  const subject = `🔔 Neue Beratungsanfrage von ${fullName}`;
  const referer = req.headers.get("referer") ?? "unbekannt";
  const phoneFull = `${data.phone_country ?? ""} ${data.phone}`.replace(/\s+/g, " ").trim();

  const slotLines = (data.slots ?? [])
    .map((s) => formatSlot(s))
    .filter((s): s is string => Boolean(s));

  // Plain-Text (Fallback fuer Mail-Clients ohne HTML).
  const textParts: string[] = [
    "NEUE BERATUNGSANFRAGE",
    "",
    `Von: ${fullName}`,
    `Telefon: ${phoneFull}`,
  ];
  if (data.email) textParts.push(`E-Mail: ${data.email}`);
  if (data.city) textParts.push(`Ort: ${data.city}`);
  textParts.push("");
  if (slotLines.length > 0) {
    textParts.push("Wunsch-Termine:");
    for (const line of slotLines) textParts.push(`  • ${line}`);
  } else {
    textParts.push("Wunsch-Termine: keine Angabe");
  }
  textParts.push("", `Quelle: ${referer}`);

  const slotsHtml =
    slotLines.length > 0
      ? `<ul style="margin:0; padding-left:20px; color:#1a1a1a; line-height:1.7;">${slotLines
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join("")}</ul>`
      : `<span style="color:#999;">Keine Angabe</span>`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 16px 10px 0; color:#6b6b6b; font-size:13px; vertical-align:top; white-space:nowrap; border-bottom:1px solid #eee;">${escapeHtml(label)}</td>
      <td style="padding:10px 0; color:#1a1a1a; font-size:14px; border-bottom:1px solid #eee;">${value}</td>
    </tr>
  `;

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background:#f6f7f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#25A8E0 0%,#1e88b8 100%); padding:24px 28px;">
              <div style="color:rgba(255,255,255,0.75); font-size:12px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; margin-bottom:6px;">Beratungsanfrage</div>
              <div style="color:#ffffff; font-size:22px; font-weight:700; line-height:1.3;">${escapeHtml(fullName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${row("Telefon", `<a href="tel:${escapeHtml(phoneFull.replace(/[^+0-9]/g, ""))}" style="color:#1a1a1a; text-decoration:none;">${escapeHtml(phoneFull)}</a>`)}
                ${data.email ? row("E-Mail", `<a href="mailto:${escapeHtml(data.email)}" style="color:#25A8E0; text-decoration:none;">${escapeHtml(data.email)}</a>`) : ""}
                ${data.city ? row("Ort", escapeHtml(data.city)) : ""}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px;">
              <div style="color:#6b6b6b; font-size:13px; margin-bottom:10px; font-weight:600;">Wunsch-Termine</div>
              ${slotsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px; border-top:1px solid #eee;">
              <div style="color:#9a9a9a; font-size:11px; line-height:1.5;">
                Diese Anfrage kam über deine Landingpage. Antworte einfach direkt auf diese E-Mail — die Antwort geht an den Absender.
              </div>
              <div style="color:#c4c4c4; font-size:10px; margin-top:8px; word-break:break-all;">Quelle: ${escapeHtml(referer)}</div>
            </td>
          </tr>
        </table>
        <div style="color:#a8a8a8; font-size:11px; margin-top:16px;">Verschickt über <strong style="color:#7a7a7a;">VIDEOCOMET</strong></div>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: RECIPIENTS,
      subject,
      text: textParts.join("\n"),
      html,
      // Reply-To mit Name → beim Antworten sieht Christoph den Klar-Namen
      // im To-Feld, nicht nur eine anonyme E-Mail-Adresse.
      replyTo: data.email ? `${fullName} <${data.email}>` : undefined,
    });
  } catch (err) {
    console.error("[lp/contact] resend failed:", err);
    return NextResponse.json(
      { success: false, error: "Mailversand fehlgeschlagen. Bitte spaeter erneut versuchen." },
      { status: 502, headers: corsHeaders() },
    );
  }

  return NextResponse.json(
    { success: true },
    { status: 200, headers: corsHeaders() },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
