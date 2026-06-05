/**
 * Trigger-Helper für den Bunny-Purge-Worker (Paket G).
 *
 * Wenn ein User eine Kampagne / einen Run / ein Mediathek-Item löscht,
 * wollen wir den Bunny-Cleanup nicht erst beim nächsten 60s-Cron-Tick,
 * sondern unmittelbar anstossen. Der App-Container hat aber weder
 * BullMQ-Producer-Singletons für diese Queue noch ffmpeg/Bunny-Stream-
 * SDK-State — er kann den Purge selbst nicht ausführen.
 *
 * Lösung: Wir POSTen an einen lokalen Trigger-Endpoint
 * (`/api/admin/bunny-purge/tick`), den der Worker via internem HTTP-Watch
 * (oder Cron) pollen kann. Aktuell ist der Endpoint ein No-Op (returnt
 * `{ ok: true }`), weil der Worker-Cron alle 60s sowieso läuft — Paket B
 * versorgt die eigentliche Purge-Logik. Sobald ein BullMQ-Bunny-Purge-
 * Queue verfügbar ist, kann dieser Helper einen Job enqueuen.
 *
 * Fire-and-forget: Caller `void`'t den Promise. Fehler werden
 * geschluckt, der 60s-Cron ist der Fallback.
 */

const PURGE_TICK_PATH = "/api/admin/bunny-purge/tick";
const TRIGGER_SECRET = process.env.BUNNY_PURGE_TRIGGER_SECRET ?? "";

/**
 * Stösst den Purge-Worker an. Reason ist nur fürs Logging — der
 * Endpoint loggt ihn, damit man im Worker-Log nachvollziehen kann,
 * welche User-Action den Tick ausgelöst hat.
 */
export async function triggerBunnyPurgeTick(reason: string): Promise<void> {
  // Kein Self-POST wenn wir nicht in einer HTTP-Umgebung sind (Tests,
  // CLI-Scripts). Der Endpoint-Pfad braucht einen Origin — wir nutzen
  // ENV oder fallen auf localhost zurück.
  const base =
    process.env.APP_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  try {
    const res = await fetch(`${base}${PURGE_TICK_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(TRIGGER_SECRET ? { "x-bunny-purge-secret": TRIGGER_SECRET } : {}),
      },
      body: JSON.stringify({ reason }),
      // Kein await im Caller — wir wollen die User-Response nicht blocken.
      // Timeout via AbortController, damit ein hängender Self-Call den
      // Node-Event-Loop nicht ewig blockiert.
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bunny:purge-trigger] tick non-200 (${res.status}) for reason=${reason}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[bunny:purge-trigger] tick failed for reason=${reason}:`, err);
  }
}
