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
 * POST /api/track/cta-click  body: { leadId, label, href }
 *
 * Designed to be called via `navigator.sendBeacon` from CTA buttons.
 * Returns 204 on every code path so the calling page never sees errors.
 */
export async function POST(req: NextRequest) {
  const ok = new Response(null, { status: 204 });

  let leadId = "";
  let label = "";
  let href = "";
  try {
    const body = (await req.json()) as {
      leadId?: unknown;
      label?: unknown;
      href?: unknown;
    };
    if (typeof body?.leadId === "string") leadId = body.leadId;
    if (typeof body?.label === "string") label = body.label.slice(0, 200);
    if (typeof body?.href === "string") href = body.href.slice(0, 1000);
  } catch {
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
      eventType: "cta_click",
      eventData: { label, href, bot },
      userAgent,
      ipHash: hashIp(ip, getTrackingSecret()),
    });
  } catch {
    /* swallow */
  }

  return ok;
}
