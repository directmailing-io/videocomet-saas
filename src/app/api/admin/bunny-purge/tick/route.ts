export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * POST /api/admin/bunny-purge/tick — Trigger-Endpoint für sofortige
 * Bunny-Purge nach API-Delete (Paket G).
 *
 * Status: Stub. Der echte Purge-Worker läuft im separaten Worker-
 * Container (Paket B) und kann von hier aus nicht direkt aufgerufen
 * werden — der App-Container hat weder ffmpeg noch das Stream-SDK in
 * der Process-Singleton-Konfiguration des Workers.
 *
 * Aktuell:
 *  - Auth via Shared-Secret-Header (`x-bunny-purge-secret`), damit der
 *    Self-POST aus dem App-Container die Auth-Schwelle einfach passiert
 *    und externe Aufrufe abgewiesen werden.
 *  - No-Op-Body: logger-Output + 202. Der Cron alle 60s im Worker
 *    erledigt den echten Purge.
 *
 * Zukunft: BullMQ-Job `bunny-purge` enqueuen, den der Worker pickt.
 * Bis dahin garantiert der 60s-Cron die Akzeptanz "binnen 60s gelöscht".
 */

const SECRET = process.env.BUNNY_PURGE_TRIGGER_SECRET ?? "";

export async function POST(req: NextRequest) {
  // Auth: Shared-Secret, fail-closed. Ohne konfiguriertes Secret ist der
  // Endpoint deaktiviert (der Host-Header waere client-kontrollierbar und
  // taugt nicht als Localhost-Nachweis). Der 60s-Worker-Cron purgt auch
  // ohne diesen Trigger.
  if (!SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const got = req.headers.get("x-bunny-purge-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let reason = "unknown";
  try {
    const body = (await req.json()) as { reason?: string };
    if (typeof body?.reason === "string") reason = body.reason;
  } catch {
    // Body optional — kein Hard-Fail.
  }

  // eslint-disable-next-line no-console
  console.info(`[bunny-purge:tick] received trigger reason=${reason}`);

  // No-Op: Worker-Cron alle 60s erledigt den echten Purge. Wir antworten
  // 202 Accepted, weil die Arbeit ausserhalb des Request-Lifecycles
  // passieren wird.
  return NextResponse.json({ ok: true, queued: false, reason }, { status: 202 });
}
