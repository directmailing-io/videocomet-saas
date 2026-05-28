export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/screenshot — enqueues a fullPage screenshot job.
 *
 * Body: { url: string } — any http(s) URL (Google Docs, website, …).
 * Response 201: { jobId: string }
 *
 * The worker (see `src/worker/processors/screenshot.ts`) captures the URL
 * with Puppeteer, uploads the JPEG to Bunny Storage, and stores
 * status/result in Redis under `screenshot:<jobId>`. The frontend then
 * polls GET /api/screenshot/[jobId] until status === "done".
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getScreenshotJobRedisKey,
  screenshotQueue,
  SCREENSHOT_REDIS_TTL_SECONDS,
} from "@/worker/screenshot-queue";
import { getRedisConnection } from "@/worker/queue";

const bodySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(
      (s) => {
        try {
          const u = new URL(s);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "URL muss mit http:// oder https:// beginnen." },
    ),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const jobId = randomUUID();

  // Seed Redis with a `pending` record (with owner) BEFORE enqueueing so the
  // GET endpoint can authorise the request as soon as the client starts
  // polling — even if the worker hasn't picked up the job yet.
  try {
    const redis = getRedisConnection();
    const key = getScreenshotJobRedisKey(jobId);
    await redis.hset(key, {
      status: "pending",
      userId: auth.user.id,
      url: body.url,
    });
    await redis.expire(key, SCREENSHOT_REDIS_TTL_SECONDS);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Konnte Job nicht initialisieren.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }

  try {
    await screenshotQueue().add(
      "capture",
      { jobId, userId: auth.user.id, url: body.url },
      { jobId },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Konnte Job nicht einreihen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId }, { status: 201 });
}
