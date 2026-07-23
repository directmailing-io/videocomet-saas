/**
 * HTML-Renderer für Outreach-Mails (Kontrakt Kapitel 4, Update „freie
 * Komposition" 2026-07-23).
 *
 * Der Body (TipTap-bodyJson) ist die einzige Leinwand: GIF-Block und
 * CTA-Button sind OPTIONALE, frei platzierbare Custom-Nodes (`emailGif`,
 * `emailCta`) — kein erzwungenes Layout mehr. Kein Node ⇒ blanke,
 * klassische Mail.
 *
 * Format (Update 2026-07-23, Migration 0039):
 *  - 'branded' (Default): 600px-Tabellen-Layout, CTA als Ink-Pill-Button.
 *  - 'personal': Minimal-HTML wie eine handgetippte Mail (System-Font,
 *    14px, nur p/br/a/b/i/strong/em) — CTA als schlichter Textlink,
 *    GIF-Node bleibt als normales img erlaubt.
 *
 * Sichtbarer Body-Footer (footerMode):
 *  - 'complete' (Default): dezente „Abmelden"-Zeile + Impressum klein.
 *  - 'unsubscribe': nur die Abmelden-Zeile.
 *  - 'none': gar kein Body-Footer.
 *
 * Invarianten (Rechts-/Schutzpaket, laufen IMMER, egal welcher footerMode):
 *  - RFC-8058 List-Unsubscribe-Header (mime.ts), Suppression-Liste,
 *    Bounce-Handling.
 *  - GIF- und CTA-Klicks (Sentinel `@system:pageUrl`) laufen über den
 *    Click-Redirect `{APP_URL}/api/email/r/{token}`.
 *  - Multipart HTML+Text bleibt in beiden Formaten erhalten.
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
  /** 'branded' | 'personal' — fehlt (Alt-Snapshot) ⇒ 'branded'. */
  format?: string | null;
  /** 'complete' | 'unsubscribe' | 'none' — fehlt (Alt-Snapshot) ⇒ 'complete'. */
  footerMode?: string | null;
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
  /** format === 'personal' — reduziertes Markup (p/br/a/b/i/strong/em). */
  personal: boolean;
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

  // Persönliches Format: keine Farb-/Font-Spans, kein u/s — nur das
  // Markup, das auch eine handgetippte Mail hätte.
  if (!ctx.personal) {
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
  }
  for (const m of marks) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "underline" && !ctx.personal) out = `<u>${out}</u>`;
    else if (m.type === "strike" && !ctx.personal) out = `<s>${out}</s>`;
  }
  const link = marks.find((m) => m.type === "link");
  if (link) {
    const rawHref = String(link.attrs?.href ?? "");
    const href =
      rawHref === SYSTEM_MAPPING_PAGE_URL
        ? ctx.clickUrl
        : subText(rawHref, ctx).trim();
    if (href) {
      // 'personal': Client-Default-Link (blau/unterstrichen) statt Akzentfarbe.
      out = ctx.personal
        ? `<a href="${escapeHtml(href)}" target="_blank">${out}</a>`
        : `<a href="${escapeHtml(href)}" target="_blank" style="color:${ACCENT};text-decoration:underline;">${out}</a>`;
    }
  }
  return out;
}

function renderGifBlock(ctx: BodyRenderCtx): string {
  const gifUrl = ctx.input.emailGifUrl;
  // Kein aktuelles GIF für diesen Lead ⇒ Block komplett auslassen.
  if (!gifUrl) return "";
  // 'personal': normales img ohne Karten-Radius — der User platziert es
  // bewusst (oder eben nicht).
  const imgStyle = ctx.personal
    ? "display:block;width:100%;max-width:600px;height:auto;border:0;"
    : "display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:14px;";
  return `<div style="margin:0 0 16px 0;">
    <a href="${escapeHtml(ctx.clickUrl)}" target="_blank" style="display:block;text-decoration:none;">
      <img src="${escapeHtml(gifUrl)}" width="600" alt="Video-Vorschau" style="${imgStyle}" />
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
  // 'personal': schlichter Textlink statt Button.
  if (ctx.personal) {
    return `<p style="margin:0 0 12px 0;"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(label)}</a></p>`;
  }
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
        const inner = (node.content ?? [])
          .map((c) => renderInlineNode(c, ctx))
          .join("");
        // 'personal': Überschrift ⇒ fetter Absatz (nur p/strong erlaubt).
        if (ctx.personal) {
          parts.push(
            `<p style="margin:0 0 12px 0;"><strong>${inner}</strong></p>`,
          );
          break;
        }
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
        const sizes: Record<number, number> = { 1: 22, 2: 19, 3: 17 };
        parts.push(
          `<h${level} style="margin:0 0 12px 0;font-size:${sizes[level]}px;line-height:1.35;font-weight:700;">${inner}</h${level}>`,
        );
        break;
      }
      case "bulletList":
      case "orderedList": {
        // 'personal': Liste ⇒ Absatz mit "- " / "1." Zeilen (kein ul/ol).
        if (ctx.personal) {
          const lines = (node.content ?? []).map((li, i) => {
            const prefix = node.type === "bulletList" ? "- " : `${i + 1}. `;
            const inner = renderBlockNodes(li.content ?? [], ctx, true)
              // Verschachtelte p ⇒ Inline-Inhalt (eine Zeile pro Item).
              .replace(/<\/?p\b[^>]*>/gi, "");
            return `${prefix}${inner}`;
          });
          parts.push(`<p style="margin:0 0 12px 0;">${lines.join("<br />")}</p>`);
          break;
        }
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
        // 'personal': Zitat ⇒ normaler Absatz.
        if (ctx.personal) {
          parts.push(renderBlockNodes(node.content ?? [], ctx, inListItem));
          break;
        }
        parts.push(
          `<blockquote style="margin:0 0 12px 0;padding:2px 0 2px 14px;border-left:3px solid ${LINE};color:${MUTED};">${renderBlockNodes(node.content ?? [], ctx)}</blockquote>`,
        );
        break;
      }
      case "horizontalRule": {
        // 'personal': keine hr — handgetippte Mails haben keine Trennlinien.
        if (ctx.personal) break;
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

  // Fallbacks für Alt-Snapshots/-Vorlagen ohne die Felder (Migration 0039).
  const personal = input.content.format === "personal";
  const footerMode =
    input.content.footerMode === "unsubscribe" ||
    input.content.footerMode === "none"
      ? input.content.footerMode
      : "complete";

  const ctx: BodyRenderCtx = { input, system, clickUrl, personal };
  const doc = asTipTapDoc(input.content.bodyJson);
  const bodyInner = doc
    ? renderBlockNodes(doc.content ?? [], ctx)
    : subHtml(input.content.bodyHtml, input, system);

  const signatureHtml = subHtml(input.content.signatureHtml, input, system);
  const impressumHtml = subHtml(input.content.impressumHtml, input, system);

  // Sichtbarer Body-Footer nach footerMode. Der unsichtbare RFC-8058
  // List-Unsubscribe-Header (mime.ts) + Suppression/Bounce laufen IMMER.
  const showUnsubscribe = footerMode !== "none";
  const showImpressum = footerMode === "complete" && impressumHtml.trim().length > 0;

  const impressumBlock = showImpressum
    ? `<div style="padding-top:8px;font-size:11px;line-height:1.6;color:${FOOTER_GRAY};">
        <span style="letter-spacing:0.05em;text-transform:uppercase;">Impressum</span><br />${impressumHtml}
      </div>`
    : "";

  let html: string;
  if (personal) {
    // Minimal-HTML wie eine handgetippte Mail — kein 600px-Container,
    // kein Karten-Styling.
    const signatureBlock = signatureHtml.trim()
      ? `<div style="margin-top:16px;">${signatureHtml}</div>`
      : "";
    const footerBlock = showUnsubscribe
      ? `<div style="margin-top:24px;font-size:11px;line-height:1.6;color:${FOOTER_GRAY};">
      <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:${FOOTER_GRAY};text-decoration:underline;">Abmelden</a>
    </div>
    ${impressumBlock}`
      : "";
    html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;color:#333333;">
    ${bodyInner}
    ${signatureBlock}
    ${footerBlock}
  </div>
</body>
</html>`;
  } else {
    const signatureBlock = signatureHtml.trim()
      ? `<tr>
        <td style="padding:8px 0 24px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${INK};">${signatureHtml}</td>
      </tr>`
      : "";
    const footerRow = showUnsubscribe
      ? `<tr>
            <td style="border-top:1px solid ${LINE};font-family:Helvetica,Arial,sans-serif;">
              <div style="padding:12px 0 0 0;font-size:11px;line-height:1.6;color:${FOOTER_GRAY};">
                <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:${FOOTER_GRAY};text-decoration:underline;">Abmelden</a>
              </div>
              ${impressumBlock}
            </td>
          </tr>`
      : "";
    html = `<!doctype html>
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
          ${footerRow}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  const textParts: string[] = [];
  const bodyText = htmlToPlainText(htmlAnchorsToPlain(bodyInner));
  if (bodyText) textParts.push(bodyText);
  // GIF ohne Link im Text wäre unsichtbar — Link-Zeile ergänzen.
  if (doc && input.emailGifUrl && tiptapDocContainsNode(doc, "emailGif")) {
    textParts.push(`Video ansehen: ${clickUrl}`);
  }
  const signatureText = htmlToPlainText(htmlAnchorsToPlain(signatureHtml));
  if (signatureText) textParts.push(signatureText);
  // Plain-Text-Footer analog: Abmelde-Zeile nur bei footerMode !== 'none'.
  if (showUnsubscribe) {
    const impressumText = showImpressum ? htmlToPlainText(impressumHtml) : "";
    const footerLines = ["--"];
    if (impressumText) footerLines.push(impressumText);
    footerLines.push(`Abmelden: ${unsubscribeUrl}`);
    textParts.push(footerLines.join("\n"));
  }

  return {
    subject,
    html,
    text: textParts.join("\n\n"),
  };
}
