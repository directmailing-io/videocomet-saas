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
  transparentGif,
} from "@/lib/tracking";

/**
 * GET /api/track/page-view?leadId=<uuid>
 *
 * Returns a 1x1 transparent GIF so it can be embedded as <img>. Tracking
 * itself never returns an error to the client — bad input is silently
 * dropped (still returns the GIF) so we never break the page render.
 */
async function pixelResponse(): Promise<Response> {
  const gif = transparentGif();
  return new Response(new Uint8Array(gif), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(gif.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

async function lookupLead(leadId: string): Promise<boolean> {
  if (!leadId) return false;
  // UUID-ish guard to avoid hammering the DB on garbage input.
  if (!/^[0-9a-fA-F-]{20,40}$/.test(leadId)) return false;
  try {
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    return !!row;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId") ?? "";
  const userAgent = req.headers.get("user-agent") ?? "";
  const ip = getClientIp(req);
  const ipHashed = hashIp(ip, getTrackingSecret());
  const bot = isBotUserAgent(userAgent);

  // Fire-and-forget DB write; we never block the pixel response on it.
  if (await lookupLead(leadId)) {
    try {
      await recordEvent({
        leadId,
        eventType: "page_view",
        eventData: { bot, referrer: req.headers.get("referer") ?? null },
        userAgent,
        ipHash: ipHashed,
      });
    } catch {
      /* swallow — tracking must never throw */
    }
  }

  return pixelResponse();
}
