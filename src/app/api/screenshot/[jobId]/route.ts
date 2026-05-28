export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/screenshot/[jobId] — returns the current status of a screenshot
 * job and, when `done`, the CDN URL + image dimensions.
 *
 * Response shape:
 *   {
 *     status: "pending" | "running" | "done" | "failed",
 *     imageUrl?: string,   // present when status === "done"
 *     width?: number,      // image width in px (= viewport width, 1280)
 *     height?: number,     // full document height
 *     error?: string       // present when status === "failed"
 *   }
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

  const payload: {
    status: ScreenshotStatus;
    imageUrl?: string;
    width?: number;
    height?: number;
    error?: string;
  } = { status };

  if (status === "done") {
    if (fields.imageUrl) payload.imageUrl = fields.imageUrl;
    if (fields.width) payload.width = Number(fields.width);
    if (fields.height) payload.height = Number(fields.height);
  } else if (status === "failed") {
    if (fields.error) payload.error = fields.error;
  }

  return NextResponse.json(payload);
}
