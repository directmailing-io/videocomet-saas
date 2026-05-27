export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { recordEvent } from "@/lib/db/queries/analytics";
import {
  getClientIp,
  getTrackingSecret,
  hashIp,
  isBotUserAgent,
} from "@/lib/tracking";

/**
 * POST /api/track/video-start  body: { leadId: string }
 *
 * Always returns 204 — failures are swallowed so tracking calls don't
 * raise client-side error overlays.
 */
export async function POST(req: NextRequest) {
  const ok = new Response(null, { status: 204 });

  let leadId = "";
  try {
    const body = (await req.json()) as { leadId?: unknown };
    if (typeof body?.leadId === "string") leadId = body.leadId;
  } catch {
    // sendBeacon sometimes posts with a Blob content-type that fails
    // json parsing; we still want to ack with 204.
    return ok;
  }

  if (!leadId || !/^[0-9a-fA-F-]{20,40}$/.test(leadId)) return ok;

  try {
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    if (!row) return ok;

    const userAgent = req.headers.get("user-agent") ?? "";
    const bot = isBotUserAgent(userAgent);
    const ip = getClientIp(req);
    await recordEvent({
      leadId,
      eventType: "video_start",
      eventData: { bot },
      userAgent,
      ipHash: hashIp(ip, getTrackingSecret()),
    });
  } catch {
    /* swallow */
  }

  return ok;
}
