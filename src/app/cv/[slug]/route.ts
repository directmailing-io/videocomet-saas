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
import { buildCustomLpCspHeader } from "@/lib/custom-lp/csp";
import { renderCustomLp } from "@/lib/custom-lp/renderer";
import { sanitizeIndexHtml } from "@/lib/custom-lp/sanitizer";
import {
  getCustomLpContextBySlug,
  getCustomLpContextBySlugAndDomain,
  type CustomLpPublicContext,
} from "@/lib/db/queries/custom-lp-public";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";
import { getCustomLpStorageEnv } from "@/lib/custom-lp/storage";
import { bunnyFetch, BunnyApiError } from "@/lib/bunny/_fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRACKING_BRIDGE_URL = "/__videocomet-bridge.js";

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
  const hostParam = req.nextUrl.searchParams.get("_host");
  let context: CustomLpPublicContext | null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") {
      return renderErrorPage(404, "Seite nicht gefunden");
    }
    context = await getCustomLpContextBySlugAndDomain(slug, domain.id);
  } else {
    context = await getCustomLpContextBySlug(slug);
  }
  if (!context) {
    return renderErrorPage(404, "Seite nicht gefunden");
  }

  // 2. Fetch the entry HTML from Bunny Storage.
  let htmlBuffer: Buffer;
  try {
    htmlBuffer = await fetchFromBunnyStorage(
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

  // 3. Sanitise + render + inject tracking-bridge bootstrap.
  let rewritten: string;
  try {
    const html = htmlBuffer.toString("utf-8");
    const sanitised = sanitizeIndexHtml(html);
    rewritten = renderCustomLp({
      html: sanitised,
      leadData: context.leadData,
      slug,
      trackingBridgeUrl: TRACKING_BRIDGE_URL,
      annotations: context.annotations,
      videoUrl: context.videoUrl,
      videoMp4Url: context.videoMp4Url,
      thumbnailUrl: context.thumbnailUrl,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cv] failed to render Custom-LP:", err);
    return renderErrorPage(500, "Interner Fehler");
  }

  // 4. Respond. CSP is loose-but-shielded (see csp.ts).
  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": buildCustomLpCspHeader(),
      // Lead data is baked into the response → cannot be shared between
      // visitors. Also keeps stale versions out of intermediary caches.
      "Cache-Control": "private, no-store, max-age=0",
      // Defence in depth — even with CSP frame-ancestors none.
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ─── Bunny fetch helper ──────────────────────────────────────────────────
/**
 * GETs a single object from Bunny Edge Storage using the readonly key.
 * Returns the raw buffer; the caller decides what to do with it.
 *
 * Intentionally NOT moved into `src/lib/custom-lp/storage.ts` — that
 * file is Agent A's territory. Once Agent A publishes a generic
 * `readObject(path)` we'll replace this inline helper.
 */
async function fetchFromBunnyStorage(remotePath: string): Promise<Buffer> {
  // WICHTIG: Custom-LPs liegen in der videocomet-custom-lp Zone, NICHT in
  // der PDF-Zone. Vorher wurde versehentlich getBunnyStorageEnv (=PDF-Zone)
  // benutzt -> 404 für jeden Lead.
  const env = getCustomLpStorageEnv();
  const cleanedPath = remotePath.replace(/^\/+/, "");
  const url = `https://storage.bunnycdn.com/${env.zone}/${cleanedPath}`;
  const response = await bunnyFetch(
    url,
    {
      method: "GET",
      headers: {
        AccessKey: env.readonlyKey || env.accessKey,
      },
    },
    { retries: 1 }, // fast-fail; the visitor is waiting on this
  );
  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * Joins a storagePath prefix with an entry path, producing a single
 * forward-slash-separated string. `storagePath` is documented to end
 * with `/` per the schema but we defend against rogue trailing slashes
 * either way.
 */
function joinStoragePath(prefix: string, entry: string): string {
  const p = prefix.replace(/\/+$/, "");
  const e = entry.replace(/^\/+/, "");
  return `${p}/${e}`;
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
