/**
 * HTML-Renderer für Outreach-Mails (Kontrakt Kapitel 4).
 *
 * Erzeugt aus einem eingefrorenen `contentSnapshot` + Lead-Daten +
 * unsubscribeToken die fertige Mail: `{ subject, html, text }`.
 *
 * Invarianten (Rechts-/Schutzpaket):
 *  - Impressum-Footer + Abmeldelink werden IMMER automatisch gerendert —
 *    unabhängig davon, was in der Vorlage steht.
 *  - CTA- und GIF-Klicks laufen über den Click-Redirect
 *    `{APP_URL}/api/email/r/{token}` (Route kommt in Step 3; hier wird
 *    nur die URL gebaut). Als Token dient der unsubscribeToken der
 *    Message — er identifiziert die Message eindeutig.
 *
 * Die Funktionen sind pur (kein DB-/Node-Zugriff) und damit auch im
 * Client (Live-Vorschau im Vorlagen-Editor) nutzbar.
 */

import {
  substitute,
  type SubstitutionSystemContext,
} from "@/lib/placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";

/**
 * Struktur-kompatibel zu `EmailBlastContentSnapshot` (schema.ts) — bewusst
 * lokal dupliziert, damit der Renderer client-seitig importierbar bleibt,
 * ohne das Drizzle-Schema ins Bundle zu ziehen. Ein Snapshot aus der DB
 * passt strukturell direkt hier rein.
 */
export interface EmailRenderContent {
  subject: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  signatureHtml?: string | null;
  impressumHtml: string;
}

export interface RenderOutreachEmailInput {
  content: EmailRenderContent;
  /** Lead-Row-Daten (`leads.data`) bzw. Beispiel-Daten in der Vorschau. */
  leadData: Record<string, string>;
  /** Aufgelöste Landingpage-URL des Leads (buildLeadPublicUrl, absolut). */
  pageUrl: string | null;
  /** `leads.emailGifUrl` — nur wenn vorhanden wird das GIF gerendert. */
  emailGifUrl?: string | null;
  /** `email_messages.unsubscribeToken` (32 hex) bzw. Vorschau-Dummy. */
  unsubscribeToken: string;
  /** Optionales Placeholder-Mapping des Runs. */
  mapping?: PlaceholderMapping | LegacyMapping;
  /** Kampagnen-Aliase für {{pageUrl}} (campaigns.pageUrlAliases). */
  pageUrlAliases?: ReadonlyArray<string> | null;
  /** Override für Tests/Vorschau; default aus Env. */
  appUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const INK = "#1f1d2b";
const MUTED = "#71717a";
const LINE = "#e9e7f2";

export function getAppUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.videocomet.de"
  ).replace(/\/+$/, "");
}

/** Click-Redirect-URL (Route `/api/email/r/[token]` kommt in Step 3). */
export function buildClickUrl(appUrl: string, token: string): string {
  return `${appUrl}/api/email/r/${token}`;
}

/** Abmelde-URL (Page `/abmelden/[token]` kommt in Step 3). */
export function buildUnsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl}/abmelden/${token}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Platzhalter-Auflösung für HTML-Zonen: erst TipTap-Spans (+ rohe {{key}}),
 * dann {{key|fallback}}-Tokens, die der Span-Pass nicht kennt.
 */
function subHtml(
  html: string | null | undefined,
  input: RenderOutreachEmailInput,
  system: SubstitutionSystemContext,
): string {
  if (!html) return "";
  const afterSpans = substitute(
    html,
    input.leadData,
    input.mapping,
    "tiptap-span",
    system,
  );
  return substitute(
    afterSpans,
    input.leadData,
    input.mapping,
    "double-brace-fallback",
    system,
  );
}

/** Plain-Text-Ableitung aus HTML (Blöcke → Newlines, Entities decodiert). */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Rendert eine komplette Outreach-Mail. Wird vom Vorlagen-Editor
 * (Live-Vorschau) und in Step 3 vom Drip-Worker (contentSnapshot)
 * identisch verwendet.
 */
export function renderOutreachEmail(
  input: RenderOutreachEmailInput,
): RenderedEmail {
  const appUrl = (input.appUrl ?? getAppUrl()).replace(/\/+$/, "");
  const system: SubstitutionSystemContext = {
    pageUrl: input.pageUrl,
    pageUrlAliases: input.pageUrlAliases ?? null,
  };

  const subject = substitute(
    input.content.subject,
    input.leadData,
    input.mapping,
    "double-brace-fallback",
    system,
  ).trim();

  const clickUrl = buildClickUrl(appUrl, input.unsubscribeToken);
  const unsubscribeUrl = buildUnsubscribeUrl(appUrl, input.unsubscribeToken);

  const bodyHtml = subHtml(input.content.bodyHtml, input, system);
  const signatureHtml = subHtml(input.content.signatureHtml, input, system);
  const impressumHtml = subHtml(input.content.impressumHtml, input, system);
  const ctaLabel = substitute(
    input.content.ctaLabel,
    input.leadData,
    input.mapping,
    "double-brace-fallback",
    system,
  ).trim();

  const gifBlock = input.emailGifUrl
    ? `<tr>
        <td style="padding:0 0 20px 0;">
          <a href="${escapeHtml(clickUrl)}" target="_blank" style="display:block;text-decoration:none;">
            <img src="${escapeHtml(input.emailGifUrl)}" width="600" alt="Video-Vorschau" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:14px;" />
          </a>
        </td>
      </tr>`
    : "";

  const ctaBlock = ctaLabel
    ? `<tr>
        <td style="padding:4px 0 24px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-radius:999px;background:${INK};">
                <a href="${escapeHtml(clickUrl)}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(ctaLabel)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  const signatureBlock = signatureHtml.trim()
    ? `<tr>
        <td style="padding:0 0 24px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${INK};">${signatureHtml}</td>
      </tr>`
    : "";

  // Impressum + Abmeldelink: IMMER rendern (auch wenn impressumHtml leer
  // ist — dann bleibt nur der Abmeldelink; eine Vorlage ohne Impressum ist
  // aber nicht blast-fähig, siehe isComplete in der Template-API).
  const impressumBlock = impressumHtml.trim()
    ? `<div style="padding-top:14px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};padding-bottom:6px;">Impressum</div>
        <div style="font-size:12px;line-height:1.6;color:${MUTED};">${impressumHtml}</div>
      </div>`
    : "";

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:100%;">
          <tr>
            <td style="padding:0 0 20px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${INK};">${bodyHtml}</td>
          </tr>
          ${gifBlock}
          ${ctaBlock}
          ${signatureBlock}
          <tr>
            <td style="border-top:1px solid ${LINE};font-family:Helvetica,Arial,sans-serif;">
              ${impressumBlock}
              <div style="padding:14px 0 4px 0;font-size:12px;line-height:1.6;color:${MUTED};">
                Sie möchten keine weiteren E-Mails erhalten?
                <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:${MUTED};text-decoration:underline;">Hier abmelden</a>.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts: string[] = [];
  const bodyText = htmlToPlainText(bodyHtml);
  if (bodyText) textParts.push(bodyText);
  if (input.emailGifUrl || ctaLabel) {
    textParts.push(`${ctaLabel || "Video ansehen"}: ${clickUrl}`);
  }
  const signatureText = htmlToPlainText(signatureHtml);
  if (signatureText) textParts.push(signatureText);
  const impressumText = htmlToPlainText(impressumHtml);
  const footerLines = ["--"];
  if (impressumText) footerLines.push(impressumText);
  footerLines.push(`Abmelden: ${unsubscribeUrl}`);
  textParts.push(footerLines.join("\n"));

  return {
    subject,
    html,
    text: textParts.join("\n\n"),
  };
}
