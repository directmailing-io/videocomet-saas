export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cleanupOldPreflightScreenshots } from "@/lib/preflight/cleanup";

/**
 * POST /api/internal/preflight-cleanup
 *
 * Internal-Trigger für den 7-Tage-Cleanup-Job. Wird vom Server-Cron
 * (`scripts/preflight-cleanup-cron.sh`) per HTTPS angetriggert. Auth läuft
 * NICHT über das Session-System sondern über einen statischen Shared-
 * Secret-Header — Lucia-Sessions kann ein cron-Curl-Aufruf nicht halten,
 * und ein Service-Account-User wäre Overkill für eine einzige Cron-Route.
 *
 * Auth-Header
 * ────────────
 *   X-Cleanup-Secret: <env CRON_SECRET>
 *
 * Antworten
 * ─────────
 *   200 → { ok, runsCleaned, screenshotsDeleted, runsAlreadyPurged, runsFailed }
 *   401 → fehlender / falscher Header
 *   500 → unerwarteter Fehler (Bunny-Komplett-Outage etc.)
 *   503 → CRON_SECRET ist server-side nicht konfiguriert
 *
 * Idempotenz: der Cleanup selbst ist idempotent (siehe cleanup.ts). Mehrere
 * gleichzeitige Cron-Trigger sind kein Problem; der Audit-Marker
 * `runs.preflight_purged_at` verhindert Doppel-Löschungen.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_SECRET is not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  const provided = req.headers.get("x-cleanup-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await cleanupOldPreflightScreenshots();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api/internal/preflight-cleanup] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Cleanup failed — see server logs.",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
