/**
 * Custom-LP sandbox renderer — main HTML page for `/cv/<slug>`.
 *
 * SPEC-DEVIATION: the task brief named this file `page.tsx`. Next.js
 * App-Router pages MUST return React JSX — they cannot return a
 * `NextResponse` with a custom HTML body. Since the whole point of this
 * route is to serve the CUSTOMER's verbatim HTML (with our renderer
 * rewrites), we have to use a `route.ts` Route-Handler. The page.tsx
 * alternative (dangerouslySetInnerHTML wrapped in a shell) would inject
 * our `<html>/<body>` around the customer's, breaking their layout.
 *
 * SCOPE NOTES (v1 limitations — do not remove without product review):
 *  - Custom-LPs are ONLY served on `lp.videocomet.de` in v1. The
 *    middleware does NOT yet route customer Custom-Domains
 *    (video.kunde.de) to /cv/. Combining a Custom-LP campaign with a
 *    Custom-Domain is therefore unsupported until v2.
 *  - The asset proxy fetches via `fetch()` and streams the body back —
 *    fine for files up to ~50 MB. For >50 MB videos we should switch to
 *    302-redirects to the Bunny CDN URL directly (phase 2).
 *  - Cache-Control for HTML is `no-store` because lead-data is injected
 *    per-visit. Assets are version-pinned and `public, max-age=1w`.
 *
 * Look-up flow (single DB round-trip via Drizzle join):
 *   slug → lead → run → campaign → customLpTemplate → customLpVersion
 *
 * Then: GET `<version.storagePath>/<version.entryHtml>` from Bunny,
 * sanitise it, render with placeholders + tracking-bridge bootstrap,
 * return as text/html with the loose-sandbox CSP header.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  getCustomLpContextBySlugForDefaultDomain,
  getCustomLpContextBySlugAndDomain,
  type CustomLpPublicContext,
} from "@/lib/db/queries/custom-lp-public";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";
import { resolveCustomDomainHost } from "@/lib/custom-domain-host";
import {
  fetchCustomLpObject,
  joinStoragePath,
  renderCustomLpHtmlResponse,
} from "@/lib/custom-lp/serve-page";
import { BunnyApiError } from "@/lib/bunny/_fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { slug } = await ctx.params;

  // 1. Resolve lead → version. The middleware sets `_host` when the
  //    request arrived through a customer custom-domain so the lookup
  //    can be domain-scoped (slug uniqueness is per-domain in that
  //    namespace).
  const hostParam = resolveCustomDomainHost(req);
  let context: CustomLpPublicContext | null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") {
      // eslint-disable-next-line no-console
      console.warn("[cv] unknown or inactive _host param", { hostParam, slug });
      return renderErrorPage(404, "Seite nicht gefunden");
    }
    context = await getCustomLpContextBySlugAndDomain(slug, domain.id);
  } else {
    // TENANT-SAFETY: ohne _host laufen wir auf der Default-Domain — der
    // Lookup muss `domain_id IS NULL` erzwingen, sonst kann ein gleichnamiger
    // Custom-Domain-Slug des Tenants A an einen Visitor von B ausgespielt
    // werden.
    context = await getCustomLpContextBySlugForDefaultDomain(slug);
  }
  if (!context) {
    return renderErrorPage(404, "Seite nicht gefunden");
  }

  // 2. Fetch the entry HTML from Bunny Storage.
  let htmlBuffer: Buffer;
  try {
    htmlBuffer = await fetchCustomLpObject(
      joinStoragePath(context.storagePath, context.entryHtml),
    );
  } catch (err) {
    if (err instanceof BunnyApiError && err.status === 404) {
      return renderErrorPage(404, "Seite nicht gefunden");
    }
    // eslint-disable-next-line no-console
    console.error("[cv] failed to fetch index.html from Bunny:", err);
    return renderErrorPage(502, "Vorübergehend nicht erreichbar");
  }

  // 3. Sanitise + render + respond (shared with the asset route so
  //    HTML sub-pages get the same treatment).
  try {
    return renderCustomLpHtmlResponse({
      context,
      slug,
      hostParam,
      html: htmlBuffer.toString("utf-8"),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cv] failed to render Custom-LP:", err);
    return renderErrorPage(500, "Interner Fehler");
  }
}

// ─── German error pages ────────────────────────────────────────────────
/**
 * Minimal HTML for the small handful of error states we render. Inlined
 * here so we don't pull React into a route handler that runs on every
 * 404 of a missing slug.
 */
function renderErrorPage(status: number, title: string): Response {
  const safeTitle = title.replace(/[<>&"']/g, (c) => {
    return (
      { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c
    );
  });
  const body = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#717171;margin:0;max-width:480px}</style></head><body><main><h1>${safeTitle}</h1><p>Bitte prüfe den Link oder versuche es später erneut.</p></main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  });
}
