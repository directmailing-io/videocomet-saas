export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/screenshot/[jobId] — returns the current status of a screenshot
 * job and, when `done`, either the website-flow result (single image) or the
 * Google-Docs-flow result (multi-page HTML preview + page count + dims).
 *
 * Response shapes:
 *
 *   Website flow (Redis hash has `imageUrl`):
 *     {
 *       status: "pending" | "running" | "done" | "failed",
 *       imageUrl?: string,   // present when status === "done"
 *       width?: number,      // image width in px (= viewport width, 1280)
 *       height?: number,     // full document height
 *       error?: string       // present when status === "failed"
 *     }
 *
 *   Google-Docs flow (Redis hash has `previewUrl`):
 *     {
 *       status: "done",
 *       previewUrl: "/api/gdocs/preview/<jobId>",   // SAME-ORIGIN proxy URL
 *       docWidth: number,   // doc canvas width in CSS px (e.g. 850)
 *       docHeight: number,  // sum of rendered page heights + gaps in CSS px
 *       pageCount: number,
 *       pageImageUrls?: string[]  // permanente Bunny-CDN-Seiten-URLs
 *                                 // (sofern der Worker sie geschrieben hat)
 *     }
 *
 *   Pending / running / failed:
 *     {
 *       status: "pending" | "running" | "failed",
 *       error?: string   // present when status === "failed"
 *     }
 *
 * Tenant guard: the job's `userId` field (seeded by POST) must match the
 * caller. Unknown / expired jobs return 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getScreenshotJobRedisKey } from "@/worker/screenshot-queue";
import { getRedisConnection } from "@/worker/queue";

type ScreenshotStatus = "pending" | "running" | "done" | "failed";

function isStatus(s: string | undefined): s is ScreenshotStatus {
  return (
    s === "pending" || s === "running" || s === "done" || s === "failed"
  );
}

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

  // hgetall returns {} for missing keys.
  if (!fields || Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "Job nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  // Tenant guard: a job is only visible to its owner.
  if (fields.userId && fields.userId !== auth.user.id) {
    return NextResponse.json(
      { error: "Job nicht gefunden oder abgelaufen." },
      { status: 404 },
    );
  }

  const status: ScreenshotStatus = isStatus(fields.status)
    ? fields.status
    : "pending";

  // ── Non-`done` short-circuits ─────────────────────────────────────────────
  if (status !== "done") {
    const payload: { status: ScreenshotStatus; error?: string } = { status };
    if (status === "failed" && fields.error) payload.error = fields.error;
    return NextResponse.json(payload);
  }

  // ── status === "done": pick gdocs vs website shape ────────────────────────
  // The worker writes EITHER `previewUrl` (gdocs flow) OR `imageUrl` (website
  // flow). Prefer the gdocs shape when present so a stale/old `imageUrl`
  // field never poisons the response — but in practice only one of the two
  // is ever written for a given job.
  if (fields.previewUrl) {
    // Permanente Bunny-Seiten-URLs (JSON-Array im Hash-Feld `pageImageUrls`,
    // vom Worker geschrieben). Defensiv parsen — fehlt das Feld oder ist es
    // korrupt, bleibt die Response wie bisher (das Scroll-Recorder-Modal
    // hängt an previewUrl/docWidth/docHeight/pageCount).
    let pageImageUrls: string[] | undefined;
    if (fields.pageImageUrls) {
      try {
        const parsed: unknown = JSON.parse(fields.pageImageUrls);
        if (
          Array.isArray(parsed) &&
          parsed.every((u): u is string => typeof u === "string")
        ) {
          pageImageUrls = parsed;
        }
      } catch {
        // korruptes JSON → Feld weglassen
      }
    }
    return NextResponse.json({
      status: "done" as const,
      // SAME-ORIGIN proxy URL — the Bunny CDN URL itself stays server-side.
      previewUrl: `/api/gdocs/preview/${encodeURIComponent(jobId)}`,
      docWidth: fields.docWidth ? Number(fields.docWidth) : 0,
      docHeight: fields.docHeight ? Number(fields.docHeight) : 0,
      pageCount: fields.pageCount ? Number(fields.pageCount) : 0,
      ...(pageImageUrls ? { pageImageUrls } : {}),
    });
  }

  // Website flow.
  const payload: {
    status: ScreenshotStatus;
    imageUrl?: string;
    width?: number;
    height?: number;
  } = { status };
  if (fields.imageUrl) payload.imageUrl = fields.imageUrl;
  if (fields.width) payload.width = Number(fields.width);
  if (fields.height) payload.height = Number(fields.height);
  return NextResponse.json(payload);
}
