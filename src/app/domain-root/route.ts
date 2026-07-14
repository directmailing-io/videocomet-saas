export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /domain-root?_host=<hostname>
 *
 * Interne Route für die Root ("/") einer Custom-Domain. Die Middleware
 * rewritet `video.kunde.de/` hierher. Verhalten:
 *   - Domain hat `rootRedirectUrl` gesetzt → 302 auf diese URL.
 *   - Sonst (Default) → neutrale, white-label 404-Seite. Bewusst OHNE
 *     VIDEOCOMET-Branding: die Domain gehört dem Kunden, wir dürfen dort
 *     nicht als Absender auftreten (siehe Custom-Domain-Konzept).
 *
 * Früher fiel `/` auf Custom-Domains als Passthrough auf die
 * VIDEOCOMET-Marketing-Homepage durch — genau das soll nie passieren.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveCustomDomainHost } from "@/lib/custom-domain-host";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    return (
      { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[
        c
      ] ?? c
    );
  });
}

function notFoundPage(hostname: string | null): NextResponse {
  const host = hostname ? escapeHtml(hostname) : "";
  const body = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>404 — Seite nicht gefunden</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100%; }
  body {
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0d12;
    color: #e8eaf0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
    background-image:
      radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,.18), transparent),
      radial-gradient(ellipse 60% 50% at 80% 110%, rgba(56,189,248,.10), transparent);
  }
  main { text-align: center; max-width: 520px; }
  .code {
    font-size: clamp(88px, 20vw, 140px);
    font-weight: 800;
    letter-spacing: -.04em;
    line-height: 1;
    margin: 0;
    background: linear-gradient(135deg, #e8eaf0 30%, rgba(232,234,240,.25));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  h1 { font-size: 22px; font-weight: 650; margin: 18px 0 10px; }
  p { color: rgba(232,234,240,.55); margin: 0; font-size: 15px; }
  .host {
    display: inline-block;
    margin-top: 26px;
    padding: 6px 14px;
    border: 1px solid rgba(232,234,240,.14);
    border-radius: 999px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: rgba(232,234,240,.45);
  }
</style>
</head>
<body>
<main>
  <p class="code">404</p>
  <h1>Diese Seite gibt es hier nicht.</h1>
  <p>Wenn du einen persönlichen Link erhalten hast — zum Beispiel aus einem
  Brief oder per QR-Code — prüfe ihn bitte noch einmal auf Tippfehler.</p>
  ${host ? `<span class="host">${host}</span>` : ""}
</main>
</body>
</html>`;
  return new NextResponse(body, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // NICHT nextUrl.searchParams direkt lesen — nach Middleware-Rewrites
  // kommt `_host` in Node-Handlern unzuverlaessig an (bekanntes Next-14-
  // Verhalten, siehe ENGINEERING-NOTE in /v/[slug]/route.ts). Der Helper
  // faellt auf den Host-Header zurueck.
  const hostParam = resolveCustomDomainHost(req);
  if (!hostParam) return notFoundPage(null);

  const domain = await getDomainByHostname(hostParam);
  if (!domain || domain.status !== "active") {
    return notFoundPage(hostParam);
  }

  if (domain.rootRedirectUrl) {
    return NextResponse.redirect(domain.rootRedirectUrl, 302);
  }
  return notFoundPage(domain.hostname);
}
