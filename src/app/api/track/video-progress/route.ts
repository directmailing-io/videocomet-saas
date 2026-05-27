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

const ALLOWED_PERCENTS = new Set([25, 50, 75, 100]);

/**
 * POST /api/track/video-progress  body: { leadId: string, percent: number }
 *
 * Only the four milestones (25/50/75/100) are persisted. Other values are
 * silently dropped — but we still return 204 so the client doesn't see
 * any error.
 */
export async function POST(req: NextRequest) {
  const ok = new Response(null, { status: 204 });

  let leadId = "";
  let percent = 0;
  try {
    const body = (await req.json()) as { leadId?: unknown; percent?: unknown };
    if (typeof body?.leadId === "string") leadId = body.leadId;
    if (typeof body?.percent === "number") percent = body.percent;
  } catch {
    return ok;
  }

  if (!leadId || !/^[0-9a-fA-F-]{20,40}$/.test(leadId)) return ok;
  if (!ALLOWED_PERCENTS.has(percent)) return ok;

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
      eventType: "video_progress",
      // `progress` is what getRunAnalytics() reads via JSON->>'progress'.
      eventData: { progress: percent, bot },
      userAgent,
      ipHash: hashIp(ip, getTrackingSecret()),
    });
  } catch {
    /* swallow */
  }

  return ok;
}
