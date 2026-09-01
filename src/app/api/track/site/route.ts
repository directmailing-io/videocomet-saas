export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { siteEvents } from "@/lib/db/schema";
import {
  getClientIp,
  getTrackingSecret,
  hashIp,
  isBotUserAgent,
} from "@/lib/tracking";

/**
 * POST /api/track/site — Beacon-Endpoint für unsere eigene Mini-Analytics
 * auf videocomet.de (Marketing). First-Party, keine Cookies, DSGVO-frei.
 *
 * Payload:
 *   {
 *     sessionId: string,     // pflicht — kommt aus sessionStorage
 *     event: string,         // 'page_view' | 'click' | 'session_start' | ...
 *     path?: string,
 *     referrer?: string,
 *     utm?: { source?, medium?, campaign?, content?, term? },
 *     meta?: Record<string, unknown>,
 *   }
 *
 * Fehler werden geschluckt (keep-alive-Beacon darf nie den Client blocken).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId?: unknown;
      event?: unknown;
      path?: unknown;
      referrer?: unknown;
      utm?: {
        source?: unknown;
        medium?: unknown;
        campaign?: unknown;
        content?: unknown;
        term?: unknown;
      };
      meta?: unknown;
    };

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "";
    const eventName = typeof body.event === "string" ? body.event.slice(0, 40) : "";
    if (!sessionId || !eventName) {
      return NextResponse.json({ ok: true });
    }

    const path = typeof body.path === "string" ? body.path.slice(0, 500) : null;
    const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null;
    const utm = body.utm && typeof body.utm === "object" ? body.utm : {};
    const utmSource = typeof utm.source === "string" ? utm.source.slice(0, 100) : null;
    const utmMedium = typeof utm.medium === "string" ? utm.medium.slice(0, 100) : null;
    const utmCampaign = typeof utm.campaign === "string" ? utm.campaign.slice(0, 100) : null;
    const utmContent = typeof utm.content === "string" ? utm.content.slice(0, 100) : null;
    const utmTerm = typeof utm.term === "string" ? utm.term.slice(0, 100) : null;
    const meta =
      body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? (body.meta as Record<string, unknown>)
        : {};

    const userAgent = req.headers.get("user-agent") ?? "";
    if (isBotUserAgent(userAgent)) {
      // Bots stumm verwerfen — verzerren die Zahlen sonst massiv.
      return NextResponse.json({ ok: true });
    }
    const ip = getClientIp(req);
    const ipH = hashIp(ip, getTrackingSecret());

    await db.insert(siteEvents).values({
      sessionId,
      eventName,
      path,
      referrer,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      meta,
      ipHash: ipH,
      userAgent: userAgent.slice(0, 500),
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Tracking darf niemals fehlschlagen — silent drop.
    return NextResponse.json({ ok: true });
  }
}
