/**
 * Custom-LP asset pass-through — serves files referenced by the rendered
 * HTML page at `/cv/<slug>/<any/asset/path>`.
 *
 * Look-up is the same lead-→-version walk as the page renderer (one DB
 * round-trip via custom-lp-public). Once we know the version we read
 * `<storagePath>/<assetPath>` straight off Bunny Storage and stream the
 * bytes back to the client.
 *
 * Why proxy instead of 302-redirect (v1 decision):
 *  - We control caching headers — Bunny CDN's defaults aren't tuned for
 *    version-pinned immutable assets.
 *  - We can enforce/relax CORS centrally so the page on lp.videocomet.de
 *    can pull from the same origin without preflight surprises.
 *  - We keep the customer's Bunny zone hidden — they only ever see
 *    `lp.videocomet.de` in DevTools network panel.
 *
 * Tradeoff: large videos go through our Node process. For files
 * >50 MB the proxy is slow; a v2 enhancement should detect content-length
 * and 302-redirect to the Bunny CDN URL with a signed-token if needed.
 */

import { NextResponse, type NextRequest } from "next/server";
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

// 1 week, immutable — assets live under a version-pinned storage prefix
// so a given URL ALWAYS resolves to the same bytes.
const ASSET_CACHE_CONTROL = "public, max-age=604800, immutable";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Max-Age": "86400",
};

interface RouteContext {
  params: Promise<{ slug: string; assetPath: string[] }>;
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function HEAD(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  // Reuse GET but drop the body. Cheap enough; we already read headers
  // anyway when proxying so there's no fast-path win in a dedicated impl.
  const resp = await GET(req, ctx);
  // Build a new Response stripping the body but preserving status + headers.
  return new NextResponse(null, {
    status: resp.status,
    headers: resp.headers,
  });
}

export async function GET(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { slug, assetPath } = await ctx.params;

  if (!Array.isArray(assetPath) || assetPath.length === 0) {
    return errorResponse(404);
  }

  // Defence: assetPath segments come from the URL path so Next has
  // already normalised them, but be extra cautious about traversal.
  for (const seg of assetPath) {
    if (seg === ".." || seg === "." || seg === "" || seg.includes("\\")) {
      return errorResponse(400);
    }
  }
  const relativePath = assetPath.join("/");

  // Resolve lead → version (same as the HTML route).
  const hostParam = req.nextUrl.searchParams.get("_host");
  let context: CustomLpPublicContext | null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") {
      return errorResponse(404);
    }
    context = await getCustomLpContextBySlugAndDomain(slug, domain.id);
  } else {
    context = await getCustomLpContextBySlug(slug);
  }
  if (!context) return errorResponse(404);

  // Proxy fetch + stream.
  try {
    return await proxyBunnyAsset({
      storagePath: context.storagePath,
      relativePath,
      rangeHeader: req.headers.get("range"),
    });
  } catch (err) {
    if (err instanceof BunnyApiError && err.status === 404) {
      return errorResponse(404);
    }
    // eslint-disable-next-line no-console
    console.error("[cv/asset] proxy failed:", err);
    return errorResponse(502);
  }
}

// ─── Proxy implementation ────────────────────────────────────────────────
async function proxyBunnyAsset(args: {
  storagePath: string;
  relativePath: string;
  rangeHeader: string | null;
}): Promise<Response> {
  // Custom-LP-Zone, NICHT die PDF-Zone (siehe /cv/[slug]/route.ts).
  const env = getCustomLpStorageEnv();
  const prefix = args.storagePath.replace(/\/+$/, "");
  const remote = `${prefix}/${args.relativePath}`.replace(/^\/+/, "");
  const url = `https://storage.bunnycdn.com/${env.zone}/${remote}`;

  // We deliberately bypass `bunnyFetch` here so we can forward `Range`
  // (HTML5 video seeks use it) and avoid the helper's auto-throw on 4xx
  // (we want to translate 404 differently).
  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      AccessKey: env.readonlyKey || env.accessKey,
      ...(args.rangeHeader ? { Range: args.rangeHeader } : {}),
    },
  });

  if (upstream.status === 404) return errorResponse(404);
  if (upstream.status >= 400) {
    // eslint-disable-next-line no-console
    console.error(
      `[cv/asset] upstream ${upstream.status} for ${url}`,
    );
    return errorResponse(502);
  }

  // Build response headers — set Content-Type from URL extension since
  // Bunny doesn't always echo a meaningful one for non-image binaries.
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", resolveMimeFromPath(args.relativePath));
  headers.set("Cache-Control", ASSET_CACHE_CONTROL);
  headers.set("X-Content-Type-Options", "nosniff");
  const upstreamLen = upstream.headers.get("content-length");
  if (upstreamLen) headers.set("Content-Length", upstreamLen);
  const upstreamRange = upstream.headers.get("content-range");
  if (upstreamRange) headers.set("Content-Range", upstreamRange);
  const upstreamAcceptRanges = upstream.headers.get("accept-ranges");
  if (upstreamAcceptRanges) headers.set("Accept-Ranges", upstreamAcceptRanges);
  const upstreamLastMod = upstream.headers.get("last-modified");
  if (upstreamLastMod) headers.set("Last-Modified", upstreamLastMod);
  const upstreamEtag = upstream.headers.get("etag");
  if (upstreamEtag) headers.set("ETag", upstreamEtag);

  // 206 Partial Content for range requests, else 200.
  const status = upstream.status === 206 ? 206 : 200;

  return new NextResponse(upstream.body, { status, headers });
}

// ─── MIME resolution ────────────────────────────────────────────────────
/**
 * Conservative content-type lookup — only the allow-listed extensions
 * from `CUSTOM_LP_ALLOWED_EXTENSIONS` (in types.ts) can ever arrive
 * here, so we exhaustively cover them. Anything else falls through to
 * `application/octet-stream` (browser will decline to render arbitrary
 * binaries which is what we want).
 *
 * Not using `mime-types` here to keep this route tree-shake-safe and
 * dependency-free — the table is small enough.
 */
function resolveMimeFromPath(p: string): string {
  const ext = (p.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "js":
    case "mjs":
      return "application/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "ico":
      return "image/x-icon";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "vtt":
      return "text/vtt; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

// ─── Error helper ───────────────────────────────────────────────────────
function errorResponse(status: number): Response {
  const messages: Record<number, string> = {
    400: "Ungültige Anfrage",
    404: "Datei nicht gefunden",
    502: "Vorübergehend nicht erreichbar",
  };
  const msg = messages[status] ?? "Fehler";
  return new NextResponse(msg, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}
