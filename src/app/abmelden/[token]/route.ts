export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailMessages } from "@/lib/db/schema";
import { performUnsubscribe } from "@/lib/db/queries/email-blasts";

/**
 * Öffentliche Abmelde-Seite (ohne Login) als Route-Handler statt
 * page.tsx: Next.js erlaubt page.tsx und route.ts nicht im selben
 * Segment, und der POST muss hier landen, weil mime.ts genau
 * `{APP_URL}/abmelden/{token}` als RFC-8058-One-Click-Ziel setzt.
 *
 * GET  ⇒ Bestätigungs-Button (Bots, die GET-Links prefetchen, melden
 *         damit niemanden ab).
 * POST ⇒ führt die Abmeldung sofort aus (Formular + One-Click).
 */

function pageHtml(body: string): Response {
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Abmelden</title>
</head>
<body style="margin:0;padding:0;background:#f3f0fa;font-family:Helvetica,Arial,sans-serif;">
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
    <div style="background:#ffffff;border-radius:24px;padding:40px 36px;max-width:440px;width:100%;box-shadow:0 18px 50px rgba(31,29,43,0.08);text-align:center;">
      ${body}
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const INVALID_BODY = `
  <h1 style="margin:0 0 10px 0;font-size:20px;color:#1f1d2b;">Link ungültig</h1>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#71717a;">Dieser Abmeldelink ist ungültig oder abgelaufen.</p>`;

const DONE_BODY = `
  <h1 style="margin:0 0 10px 0;font-size:20px;color:#1f1d2b;">Abmeldung bestätigt</h1>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#71717a;">Sie erhalten keine weiteren E-Mails von diesem Absender.</p>`;

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token.trim();
  if (!/^[0-9a-f]{32}$/i.test(token)) return pageHtml(INVALID_BODY);

  const [row] = await db
    .select({
      toEmail: emailMessages.toEmail,
      unsubscribedAt: emailMessages.unsubscribedAt,
    })
    .from(emailMessages)
    .where(eq(emailMessages.unsubscribeToken, token))
    .limit(1);
  if (!row) return pageHtml(INVALID_BODY);
  if (row.unsubscribedAt) return pageHtml(DONE_BODY);

  return pageHtml(`
    <h1 style="margin:0 0 10px 0;font-size:20px;color:#1f1d2b;">Vom Newsletter abmelden?</h1>
    <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#71717a;">Sie erhalten dann keine weiteren E-Mails von diesem Absender an <strong>${row.toEmail.replace(/</g, "&lt;")}</strong>.</p>
    <form method="post">
      <button type="submit" style="display:inline-block;border:0;cursor:pointer;border-radius:999px;background:#1f1d2b;color:#ffffff;font-size:15px;font-weight:600;padding:13px 34px;">Abmelden</button>
    </form>`);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const result = await performUnsubscribe(params.token);
  if (!result.ok) return pageHtml(INVALID_BODY);
  return pageHtml(DONE_BODY);
}
