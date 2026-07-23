/**
 * HTML-Renderer für Outreach-Mails (Kontrakt Kapitel 4, Update „freie
 * Komposition" 2026-07-23).
 *
 * Der Body (TipTap-bodyJson) ist die einzige Leinwand: GIF-Block und
 * CTA-Button sind OPTIONALE, frei platzierbare Custom-Nodes (`emailGif`,
 * `emailCta`) — kein erzwungenes Layout mehr. Kein Node ⇒ blanke,
 * klassische Mail.
 *
 * Invarianten (Rechts-/Schutzpaket, NICHT abwählbar):
 *  - Dezente einzeilige „Abmelden"-Zeile (klein, grau) + Impressum klein
 *    darunter werden IMMER am Mail-Ende gerendert.
 *  - GIF- und CTA-Klicks (Sentinel `@system:pageUrl`) laufen über den
 *    Click-Redirect `{APP_URL}/api/email/r/{token}`.
 *
 * Rückwärtskompatibilität: Snapshots/Vorlagen ohne bodyJson rendern den
 * bodyHtml-Cache als einfachen Text — ohne erzwungenen CTA/GIF (gewollt).
 *
 * Die Funktionen sind pur (kein DB-/Node-Zugriff) und damit auch im
 * Client (Live-Vorschau im Vorlagen-Editor + Wizard) nutzbar.
 */

import {
  resolveValue,
  substitute,
  SYSTEM_MAPPING_PAGE_URL,
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
  /** Cache/Fallback — wird nur gerendert, wenn `bodyJson` fehlt. */
  bodyHtml: string;
  /** TipTap-Dokument (freie Komposition). */
  bodyJson?: unknown;
  /** Nur noch Defaults für neue CTA-Nodes — im Rendering ungenutzt. */
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  signatureHtml?: string | null;
  impressumHtml: string;
}

export interface RenderOutreachEmailInput {
  content: EmailRenderContent;
  /** Lead-Row-Daten (`leads.data`) bzw. Beispiel-Daten in der Vorschau. */
  leadData: Record<string, string>;
  /** Aufgelöste Landingpage-URL des Leads (buildLeadPublicUrl, absolut). */
  pageUrl: string | null;
  /** `leads.emailGifUrl` — nur wenn vorhanden wird der emailGif-Node gerendert. */
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
const ACCENT = "#7C5CE8";
/** Dezenter Footer-Grauton (Abmelde-Zeile + Impressum). */
const FOOTER_GRAY = "#9ca3af";

export function getAppUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.videocomet.de"
  ).replace(/\/+$/, "");
}

/** Click-Redirect-URL (`/api/email/r/[token]` → Landingpage des Leads). */
export function buildClickUrl(appUrl: string, token: string): string {
  return `${appUrl}/api/email/r/${token}`;
}

/** Abmelde-URL (Page `/abmelden/[token]`). */
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

// ── TipTap-JSON-Helpers (auch von Editor/Wizard/Start-Route genutzt) ──────

export interface TipTapJsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TipTapJsonNode[];
}

export function asTipTapDoc(v: unknown): TipTapJsonNode | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const n = v as TipTapJsonNode;
  if (n.type !== "doc" || !Array.isArray(n.content)) return null;
  return n;
}

function walkNodes(
  node: TipTapJsonNode,
  visit: (n: TipTapJsonNode) => boolean | void,
): boolean {
  if (visit(node) === true) return true;
  for (const child of node.content ?? []) {
    if (walkNodes(child, visit)) return true;
  }
  return false;
}

/** Prüft, ob ein bodyJson-Dokument einen Node-Typ enthält (z. B. `emailGif`). */
export function tiptapDocContainsNode(v: unknown, type: string): boolean {
  const doc = asTipTapDoc(v);
  if (!doc) return false;
  return walkNodes(doc, (n) => n.type === type);
}

/** Label/URL des ERSTEN emailCta-Nodes — Rückspiegelung in ctaLabel/ctaUrl. */
export function extractFirstCtaNode(
  v: unknown,
): { label: string; url: string } | null {
  const doc = asTipTapDoc(v);
  if (!doc) return null;
  let found: { label: string; url: string } | null = null;
  walkNodes(doc, (n) => {
    if (n.type === "emailCta") {
      found = {
        label: String(n.attrs?.label ?? "Video ansehen"),
        url: String(n.attrs?.url ?? SYSTEM_MAPPING_PAGE_URL),
      };
      return true;
    }
  });
  return found;
}

/**
 * Platzhalter-Auflösung für HTML-Zonen (Legacy-Pfad + Signatur/Impressum):
 * erst TipTap-Spans (+ rohe {{key}}), dann {{key|fallback}}-Tokens.
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

/** Anker → „Text (URL)" bzw. nackte URL — für die Plain-Text-Ableitung. */
function htmlAnchorsToPlain(html: string): string {
  return html.replace(
    /<a\b[^>]*?href=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, _q: string, href: string, inner: string) => {
      const innerText = inner.replace(/<[^>]+>/g, "").trim();
      // Reine Bild-Links (GIF) → weglassen; die Link-Zeile kommt separat.
      if (!innerText) return "";
      if (innerText === href) return href;
      return `${innerText} (${href})`;
    },
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
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── TipTap-Body-Renderer ───────────────────────────────────────────────────

interface BodyRenderCtx {
  input: RenderOutreachEmailInput;
  system: SubstitutionSystemContext;
  clickUrl: string;
}

function subText(text: string, ctx: BodyRenderCtx): string {
  return substitute(
    text,
    ctx.input.leadData,
    ctx.input.mapping,
    "double-brace-fallback",
    ctx.system,
  );
}

function renderInlineNode(node: TipTapJsonNode, ctx: BodyRenderCtx): string {
  if (node.type === "hardBreak") return "<br />";
  if (node.type === "placeholder") {
    const key = String(node.attrs?.key ?? "");
    const fallback = node.attrs?.fallback;
    const value = resolveValue(
      key,
      ctx.input.leadData,
      ctx.input.mapping,
      typeof fallback === "string" ? fallback : undefined,
      undefined,
      ctx.system,
    );
    return escapeHtml(value);
  }
  if (typeof node.text !== "string") {
    return (node.content ?? []).map((c) => renderInlineNode(c, ctx)).join("");
  }

  let out = escapeHtml(subText(node.text, ctx));
  const marks = node.marks ?? [];

  const styleParts: string[] = [];
  for (const m of marks) {
    if (m.type !== "textStyle") continue;
    const color = m.attrs?.color;
    const fontSize = m.attrs?.fontSize;
    const fontFamily = m.attrs?.fontFamily;
    if (typeof color === "string" && color) styleParts.push(`color:${color}`);
    if (typeof fontSize === "string" && fontSize)
      styleParts.push(`font-size:${fontSize}`);
    if (typeof fontFamily === "string" && fontFamily)
      styleParts.push(`font-family:${fontFamily.replace(/"/g, "'")}`);
  }
  if (styleParts.length > 0) {
    out = `<span style="${escapeHtml(styleParts.join(";"))}">${out}</span>`;
  }
  for (const m of marks) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
  }
  const link = marks.find((m) => m.type === "link");
  if (link) {
    const rawHref = String(link.attrs?.href ?? "");
    const href =
      rawHref === SYSTEM_MAPPING_PAGE_URL
        ? ctx.clickUrl
        : subText(rawHref, ctx).trim();
    if (href) {
      out = `<a href="${escapeHtml(href)}" target="_blank" style="color:${ACCENT};text-decoration:underline;">${out}</a>`;
    }
  }
  return out;
}

function renderGifBlock(ctx: BodyRenderCtx): string {
  const gifUrl = ctx.input.emailGifUrl;
  // Kein aktuelles GIF für diesen Lead ⇒ Block komplett auslassen.
  if (!gifUrl) return "";
  return `<div style="margin:0 0 16px 0;">
    <a href="${escapeHtml(ctx.clickUrl)}" target="_blank" style="display:block;text-decoration:none;">
      <img src="${escapeHtml(gifUrl)}" width="600" alt="Video-Vorschau" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:14px;" />
    </a>
  </div>`;
}

function renderCtaBlock(node: TipTapJsonNode, ctx: BodyRenderCtx): string {
  const label =
    subText(String(node.attrs?.label ?? ""), ctx).trim() || "Video ansehen";
  const rawUrl = String(node.attrs?.url ?? SYSTEM_MAPPING_PAGE_URL);
  const url =
    rawUrl === SYSTEM_MAPPING_PAGE_URL
      ? ctx.clickUrl
      : subText(rawUrl, ctx).trim() || ctx.clickUrl;
  return `<div style="margin:4px 0 16px 0;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="border-radius:999px;background:${INK};">
          <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>
  </div>`;
}

function renderBlockNodes(
  nodes: TipTapJsonNode[],
  ctx: BodyRenderCtx,
  inListItem = false,
): string {
  const parts: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const inner = (node.content ?? [])
          .map((c) => renderInlineNode(c, ctx))
          .join("");
        const align = node.attrs?.textAlign;
        const alignStyle =
          typeof align === "string" && align !== "left"
            ? `text-align:${align};`
            : "";
        const margin = inListItem ? "0" : "0 0 12px 0";
        parts.push(
          `<p style="margin:${margin};${alignStyle}">${inner || "<br />"}</p>`,
        );
        break;
      }
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
        const sizes: Record<number, number> = { 1: 22, 2: 19, 3: 17 };
        const inner = (node.content ?? [])
          .map((c) => renderInlineNode(c, ctx))
          .join("");
        parts.push(
          `<h${level} style="margin:0 0 12px 0;font-size:${sizes[level]}px;line-height:1.35;font-weight:700;">${inner}</h${level}>`,
        );
        break;
      }
      case "bulletList":
      case "orderedList": {
        const tag = node.type === "bulletList" ? "ul" : "ol";
        const items = (node.content ?? [])
          .map(
            (li) =>
              `<li style="margin:0 0 4px 0;">${renderBlockNodes(li.content ?? [], ctx, true)}</li>`,
          )
          .join("");
        parts.push(
          `<${tag} style="margin:0 0 12px 0;padding-left:24px;">${items}</${tag}>`,
        );
        break;
      }
      case "blockquote": {
        parts.push(
          `<blockquote style="margin:0 0 12px 0;padding:2px 0 2px 14px;border-left:3px solid ${LINE};color:${MUTED};">${renderBlockNodes(node.content ?? [], ctx)}</blockquote>`,
        );
        break;
      }
      case "horizontalRule": {
        parts.push(
          `<hr style="border:none;border-top:1px solid ${LINE};margin:16px 0;" />`,
        );
        break;
      }
      case "emailGif": {
        parts.push(renderGifBlock(ctx));
        break;
      }
      case "emailCta": {
        parts.push(renderCtaBlock(node, ctx));
        break;
      }
      default: {
        if (node.content && node.content.length > 0) {
          parts.push(renderBlockNodes(node.content, ctx, inListItem));
        }
        break;
      }
    }
  }
  return parts.join("");
}

/**
 * Rendert eine komplette Outreach-Mail. Wird vom Vorlagen-Editor
 * (Live-Vorschau), vom Blast-Wizard (Schritt 6) und vom Drip-Worker
 * (contentSnapshot) identisch verwendet.
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

  const ctx: BodyRenderCtx = { input, system, clickUrl };
  const doc = asTipTapDoc(input.content.bodyJson);
  const bodyInner = doc
    ? renderBlockNodes(doc.content ?? [], ctx)
    : subHtml(input.content.bodyHtml, input, system);

  const signatureHtml = subHtml(input.content.signatureHtml, input, system);
  const impressumHtml = subHtml(input.content.impressumHtml, input, system);

  const signatureBlock = signatureHtml.trim()
    ? `<tr>
        <td style="padding:8px 0 24px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${INK};">${signatureHtml}</td>
      </tr>`
    : "";

  // Rechts-/Schutzpaket: dezente Abmelde-Zeile + kleines Impressum werden
  // IMMER gerendert (eine Vorlage ohne Impressum ist nicht blast-fähig,
  // siehe isComplete in der Template-API).
  const impressumBlock = impressumHtml.trim()
    ? `<div style="padding-top:8px;font-size:11px;line-height:1.6;color:${FOOTER_GRAY};">
        <span style="letter-spacing:0.05em;text-transform:uppercase;">Impressum</span><br />${impressumHtml}
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
            <td style="padding:0 0 12px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${INK};">${bodyInner}</td>
          </tr>
          ${signatureBlock}
          <tr>
            <td style="border-top:1px solid ${LINE};font-family:Helvetica,Arial,sans-serif;">
              <div style="padding:12px 0 0 0;font-size:11px;line-height:1.6;color:${FOOTER_GRAY};">
                <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:${FOOTER_GRAY};text-decoration:underline;">Abmelden</a>
              </div>
              ${impressumBlock}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts: string[] = [];
  const bodyText = htmlToPlainText(htmlAnchorsToPlain(bodyInner));
  if (bodyText) textParts.push(bodyText);
  // GIF ohne Link im Text wäre unsichtbar — Link-Zeile ergänzen.
  if (doc && input.emailGifUrl && tiptapDocContainsNode(doc, "emailGif")) {
    textParts.push(`Video ansehen: ${clickUrl}`);
  }
  const signatureText = htmlToPlainText(htmlAnchorsToPlain(signatureHtml));
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
