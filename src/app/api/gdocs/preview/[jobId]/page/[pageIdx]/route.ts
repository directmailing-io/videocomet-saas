export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/gdocs/preview/[jobId]/page/[pageIdx] — same-origin proxy for the
 * Bunny-hosted page PNGs referenced by a Google-Docs preview HTML.
 *
 * Page indices are 1-based to match the `page-N.png` naming convention
 * used by the worker. Out-of-range / non-numeric indices return 404.
 *
 * Why proxy: the preview HTML is served same-origin via
 * /api/gdocs/preview/[jobId] (see ../route.ts) and references the page PNGs
 * by relative-to-app URLs. Routing the actual image bytes through here
 * keeps every byte in the iframe same-origin so the parent Modal can read
 * the iframe's scroll position.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getScreenshotJobRedisKey } from "@/worker/screenshot-queue";
import { getRedisConnection } from "@/worker/queue";

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string; pageIdx: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const { jobId, pageIdx } = params;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "Ungültige Job-ID." }, { status: 400 });
  }

  const redis = getRedisConnection();
  const key = getScreenshotJobRedisKey(jobId);
  const fields = await redis.hgetall(key);

  if (!fields || Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "Seite nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Tenant guard.
  if (fields.userId && fields.userId !== auth.user.id) {
    return NextResponse.json(
      { error: "Seite nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Parse `pageImageUrls` JSON. Tolerate malformed JSON / wrong-shape arrays.
  let pageUrls: string[] = [];
  if (fields.pageImageUrls) {
    try {
      const parsed = JSON.parse(fields.pageImageUrls);
      if (Array.isArray(parsed)) {
        pageUrls = parsed.filter((u): u is string => typeof u === "string");
      }
    } catch (err) {
      console.error(
        `[api/gdocs/preview/page] failed to parse pageImageUrls for jobId=${jobId}:`,
        err,
      );
    }
  }

  if (pageUrls.length === 0) {
    return NextResponse.json(
      { error: "Seite nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Validate page index: 1-indexed, must be a positive integer in range.
  const n = Number.parseInt(pageIdx, 10);
  if (!Number.isFinite(n) || n < 1 || n > pageUrls.length) {
    return NextResponse.json(
      { error: "Seite nicht gefunden." },
      { status: 404 },
    );
  }

  const upstreamUrl = pageUrls[n - 1];
  if (!upstreamUrl) {
    return NextResponse.json(
      { error: "Seite nicht gefunden." },
      { status: 404 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { cache: "no-store" });
  } catch (err) {
    console.error(
      `[api/gdocs/preview/page] Bunny fetch threw for jobId=${jobId} idx=${n} url=${upstreamUrl}:`,
      err,
    );
    return NextResponse.json(
      { error: "Seite konnte nicht geladen werden." },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    console.error(
      `[api/gdocs/preview/page] Bunny fetch failed for jobId=${jobId} idx=${n} url=${upstreamUrl} status=${upstream.status}`,
    );
    return NextResponse.json(
      { error: "Seite konnte nicht geladen werden." },
      { status: 502 },
    );
  }

  // Forward the byte stream rather than buffering the entire PNG in memory.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
