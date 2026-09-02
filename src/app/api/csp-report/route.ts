export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/csp-report — Empfänger für Content-Security-Policy-Verstöße
 * (Report-Only-Phase, siehe next.config.mjs). Loggt kompakt ins Container-
 * Log; kein DB-Schreibzugriff, kein Auth (Browser senden ohne Cookie-
 * Kontext). Pro IP 60 Reports/Minute, Body max. 8 KB — reine Rausch-Bremse.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/tracking";

const MAX_BODY = 8 * 1024;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req) || "unknown";
  const rl = await checkRateLimit(`csp:${ip}`, 60, 60);
  if (!rl.ok) return new NextResponse(null, { status: 204 });

  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return new NextResponse(null, { status: 204 });

  try {
    const parsed = JSON.parse(text) as {
      "csp-report"?: Record<string, unknown>;
    };
    const r = parsed["csp-report"] ?? (parsed as Record<string, unknown>);
    console.warn(
      "[csp-report]",
      JSON.stringify({
        doc: r["document-uri"] ?? r["documentURL"],
        directive: r["violated-directive"] ?? r["effectiveDirective"],
        blocked: r["blocked-uri"] ?? r["blockedURL"],
        source: r["source-file"] ?? r["sourceFile"],
        line: r["line-number"] ?? r["lineNumber"],
      }),
    );
  } catch {
    // kein JSON → ignorieren
  }
  return new NextResponse(null, { status: 204 });
}
