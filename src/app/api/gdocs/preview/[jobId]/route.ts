export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/gdocs/preview/[jobId] — same-origin proxy for the Bunny-hosted
 * Google-Docs preview HTML.
 *
 * Flow:
 *   1. Auth + tenant guard via the `screenshot:<jobId>` Redis hash.
 *   2. Fetch the HTML from `previewUrl` (a Bunny CDN URL written by the
 *      worker's Google-Docs branch).
 *   3. Rewrite every `src="…/screenshots/<jobId>/page-N.png"` reference to
 *      `src="/api/gdocs/preview/<jobId>/page/N"` so the iframe + its page
 *      assets are all SAME-ORIGIN. This lets the embedding Modal read the
 *      iframe's scroll position via JavaScript (no cross-origin lockout).
 *   4. Serve as `text/html` with no `X-Frame-Options` and a `frame-ancestors
 *      'self'` CSP so only our own pages can iframe it.
 *
 * Why proxy instead of redirect/iframe-direct: iframing a Bunny CDN origin
 * makes the iframe document cross-origin, which blocks the parent from
 * reading `contentWindow.scrollY` (used to drive the doc-scroll → video-time
 * mapping in the Modal). Routing the HTML + its <img> references through
 * the app origin makes the iframe document same-origin again.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getScreenshotJobRedisKey } from "@/worker/screenshot-queue";
import { getRedisConnection } from "@/worker/queue";

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const jobId = params.jobId;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "Ungültige Job-ID." }, { status: 400 });
  }

  const redis = getRedisConnection();
  const key = getScreenshotJobRedisKey(jobId);
  const fields = await redis.hgetall(key);

  if (!fields || Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "Vorschau nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Tenant guard: a job's preview is only visible to its owner.
  if (fields.userId && fields.userId !== auth.user.id) {
    return NextResponse.json(
      { error: "Vorschau nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  const previewUrl = fields.previewUrl;
  if (!previewUrl) {
    return NextResponse.json(
      { error: "Vorschau nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  let html: string;
  try {
    const upstream = await fetch(previewUrl, {
      // Bunny is public — no auth — but disable Next's fetch cache to make
      // sure tenant-rotated URLs aren't accidentally shared across requests.
      cache: "no-store",
    });
    if (!upstream.ok) {
      console.error(
        `[api/gdocs/preview] Bunny fetch failed for jobId=${jobId} url=${previewUrl} status=${upstream.status}`,
      );
      return NextResponse.json(
        { error: "Vorschau konnte nicht geladen werden." },
        { status: 502 },
      );
    }
    html = await upstream.text();
  } catch (err) {
    console.error(
      `[api/gdocs/preview] Bunny fetch threw for jobId=${jobId} url=${previewUrl}:`,
      err,
    );
    return NextResponse.json(
      { error: "Vorschau konnte nicht geladen werden." },
      { status: 502 },
    );
  }

  // Rewrite absolute Bunny URLs that point at this job's page PNGs to
  // same-origin proxy paths. Anchor on `/screenshots/<jobId>/page-N.png`
  // (any host, http(s) or otherwise) — the Bunny CDN host can vary by env.
  const escapedJobId = jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rewriteRe = new RegExp(
    `src="[^"]*\\/screenshots\\/${escapedJobId}\\/page-(\\d+)\\.png"`,
    "g",
  );
  const proxiedJobId = encodeURIComponent(jobId);
  const rewritten = html.replace(
    rewriteRe,
    (_match, n: string) => `src="/api/gdocs/preview/${proxiedJobId}/page/${n}"`,
  );

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Match the 30-min Redis TTL with a private 5-min browser cache — short
      // enough that a re-run job's freshly-uploaded HTML is picked up soon.
      "Cache-Control": "private, max-age=300",
      // Lock iframing to our own origin. Note: deliberately NO
      // `X-Frame-Options` header — we want the Modal's <iframe> to load this.
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
