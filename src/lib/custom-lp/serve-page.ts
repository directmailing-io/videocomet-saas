/**
 * Shared Custom-LP page serving — used by BOTH `/cv/[slug]` (entry HTML)
 * and `/cv/[slug]/[...assetPath]` (sub-pages like `beratung.html`).
 *
 * Vorher lief NUR die index.html durch den Platzhalter-Renderer; jede
 * weitere HTML-Seite wurde von der Asset-Route roh von Bunny durchgereicht
 * — Besucher sahen dort wörtlich `{{vorname|}}` statt ihrer Daten und es
 * gab kein Tracking. Deshalb: eine Render-Pipeline für alle HTML-Seiten.
 */

import { NextResponse } from "next/server";
import { buildCustomLpCspHeader } from "./csp";
import { renderCustomLp } from "./renderer";
import { sanitizeIndexHtml } from "./sanitizer";
import { getCustomLpStorageEnv } from "./storage";
import { bunnyFetch } from "@/lib/bunny/_fetch";
import { buildPageUrlShort } from "@/lib/placeholders/page-url";
import type { CustomLpPublicContext } from "@/lib/db/queries/custom-lp-public";

// Absolute URL — damit der Browser die Bridge IMMER von der App-Origin
// holt, egal auf welchem Host die Landingpage liegt (lp.videocomet.de oder
// einer Custom-Domain). Eine root-relative URL würde sonst auf
// `lp.videocomet.de/__videocomet-bridge.js` zeigen — wird von der
// Middleware aber zu `/cv/__videocomet-bridge.js` rewritet → 404 → kein
// Tracking. Ein absolute URL umgeht das Rewrite sauber.
const TRACKING_BRIDGE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
  "https://app.videocomet.de";
export const TRACKING_BRIDGE_SCRIPT = `${TRACKING_BRIDGE_URL}/__videocomet-bridge.js`;

/**
 * GETs a single object from Bunny Edge Storage (Custom-LP zone, NICHT die
 * PDF-Zone) using the readonly key.
 */
export async function fetchCustomLpObject(remotePath: string): Promise<Buffer> {
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
    // fast-fail; the visitor is waiting on this. Bunny kann bei kaputten
    // Objekten 60s bis zum 504 brauchen — deshalb hartes Attempt-Timeout.
    { retries: 1, timeoutMs: 10_000 },
  );
  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * Joins a storagePath prefix with an entry path, producing a single
 * forward-slash-separated string.
 */
export function joinStoragePath(prefix: string, entry: string): string {
  const p = prefix.replace(/\/+$/, "");
  const e = entry.replace(/^\/+/, "");
  return `${p}/${e}`;
}

/**
 * Sanitise + render a Custom-LP HTML page (placeholders, video-inject,
 * tracking-bridge) and wrap it in the standard response headers.
 * Throws on renderer errors — caller decides on the error page.
 */
export function renderCustomLpHtmlResponse(args: {
  context: CustomLpPublicContext;
  slug: string;
  /** Custom-Domain-Hostname aus der Middleware, sonst null. */
  hostParam: string | null;
  /** Raw HTML bytes as fetched from Bunny. */
  html: string;
}): Response {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://app.videocomet.de";
  const pageUrl = buildPageUrlShort(args.hostParam, args.slug, appUrl);

  const sanitised = sanitizeIndexHtml(args.html);
  const rewritten = renderCustomLp({
    html: sanitised,
    leadData: args.context.leadData,
    slug: args.slug,
    trackingBridgeUrl: TRACKING_BRIDGE_SCRIPT,
    annotations: args.context.annotations,
    videoUrl: args.context.videoUrl,
    videoMp4Url: args.context.videoMp4Url,
    thumbnailUrl: args.context.thumbnailUrl,
    videoOrientation: args.context.videoOrientation,
    pageUrl,
  });

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": buildCustomLpCspHeader(),
      // Lead data is baked into the response → cannot be shared between
      // visitors. Also keeps stale versions out of intermediary caches.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
