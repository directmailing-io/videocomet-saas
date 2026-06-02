/**
 * 7-Tage-Cleanup für Preflight-Screenshots.
 *
 * Die Preflight-Phase erzeugt pro Lead eine Light-WebP-Aufnahme im Bunny-
 * Storage-Zone `videocomet-preflight`. Nach dem Quality-Check braucht der
 * Kunde sie nicht mehr — wir halten sie aber 7 Tage vor, damit User
 * notfalls einen Run nochmal QA-en können bevor Phase 2 läuft.
 *
 * Diese Funktion wird sowohl vom internal-API-Endpoint
 * `/api/internal/preflight-cleanup` (per Shell-Cron) aufgerufen als auch
 * potentiell von einem zukünftigen Worker-Tick. Sie ist idempotent durch
 * die Audit-Spalte `runs.preflight_purged_at`.
 *
 * ── Schema-Vertrag mit Agent 1 ─────────────────────────────────────────────
 *  Voraussetzung: Migration `0007_preflight_purged.sql` ist eingespielt, die
 *  die Spalte `runs.preflight_purged_at` (timestamptz, NULL) anlegt. Agent 1
 *  zieht das parallel in `src/lib/db/schema.ts` nach. SOLANGE das nicht
 *  passiert ist, lesen/schreiben wir die Spalte ausschließlich per Raw-SQL,
 *  ohne typed Drizzle-Builder — das ist der Grund warum hier so viel
 *  `sql`-Tagging zu finden ist.
 *
 * ── Defensives Verhalten ───────────────────────────────────────────────────
 *  - Fällt der Bunny-Bulk-Delete für einen Run aus, loggen wir und machen
 *    mit dem nächsten Run weiter. Der gescheiterte Run wird beim nächsten
 *    Cron-Lauf erneut versucht (`preflight_purged_at` bleibt NULL).
 *  - Wir setzen `preflight_purged_at` erst NACH dem erfolgreichen Bunny-
 *    Delete + Lead-Spalten-Reset. Ein partieller Run ist also schlimmer-
 *    falls "Bunny gelöscht, DB-Zeile zeigt noch URL" — das ist OK, der
 *    Hyperlink würde 404en, aber die UI prüft `preflight_purged_at` und
 *    blendet den Screenshot dann eh aus.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deletePreflightRun } from "@/lib/bunny/preflight-storage";

export interface CleanupResult {
  /** Anzahl Runs, deren Screenshots in diesem Lauf gelöscht wurden. */
  runsCleaned: number;
  /** Summierte Anzahl gelöschter Bunny-Objekte. */
  screenshotsDeleted: number;
  /** Runs die geprüft aber bereits purged waren — kein-op. */
  runsAlreadyPurged: number;
  /** Runs deren Cleanup gescheitert ist (Bunny-/DB-Fehler). */
  runsFailed: number;
}

interface EligibleRunRow {
  runId: string;
}

/**
 * Liefert alle Runs, deren Preflight älter als 7 Tage ist UND deren
 * `preflight_purged_at` noch NULL ist. `COALESCE` schützt uns falls die
 * Spalte aus irgendeinem Grund noch nicht migriert ist — dann fällt sie
 * auf NULL zurück und der Run wäre eligible. Bei FEHLENDER Spalte würde
 * der Query allerdings ohnehin werfen; das ist erwünscht, weil ein
 * Cleanup ohne Audit-Spalte ein Datenkorruptions-Risiko ist (wir hätten
 * keine Möglichkeit zu wissen, was schon gelöscht wurde).
 */
async function selectEligibleRuns(): Promise<EligibleRunRow[]> {
  const rows = (await db.execute(sql`
    SELECT id AS "runId"
    FROM runs
    WHERE preflight_completed_at IS NOT NULL
      AND preflight_completed_at < (NOW() - INTERVAL '7 days')
      AND COALESCE(preflight_purged_at, '1970-01-01'::timestamptz)
            < preflight_completed_at
    ORDER BY preflight_completed_at ASC
    LIMIT 200
  `)) as unknown;

  // postgres-js liefert ein Array; drizzle wrappt es in `{ rows }` für
  // andere Treiber. Wir unterstützen beide Shapes defensiv.
  if (Array.isArray(rows)) {
    return rows as EligibleRunRow[];
  }
  const wrapped = rows as { rows?: EligibleRunRow[] };
  return wrapped.rows ?? [];
}

/**
 * Für genau einen Run:
 *   1. Bunny-Bulk-Delete unter `runs/<runId>/preflight/`.
 *   2. `leads.preflight_screenshot_url = NULL` + `preflight_screenshot_key
 *      = NULL` für alle Leads dieses Runs.
 *   3. `runs.preflight_purged_at = NOW()` als Audit-Marker.
 *
 * Returns die Anzahl gelöschter Bunny-Objekte ODER null falls etwas
 * Geworfen wurde (Caller zählt dann den Run als `runsFailed`).
 */
async function purgeOneRun(runId: string): Promise<number | null> {
  try {
    const { deleted } = await deletePreflightRun(runId);
    await db.execute(sql`
      UPDATE leads
      SET preflight_screenshot_url = NULL,
          preflight_screenshot_key = NULL
      WHERE run_id = ${runId}
    `);
    await db.execute(sql`
      UPDATE runs
      SET preflight_purged_at = NOW()
      WHERE id = ${runId}
    `);
    return deleted;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[preflight/cleanup] purgeOneRun failed for run=${runId}:`,
      err,
    );
    return null;
  }
}

/**
 * Hauptentry: prüft eligibilität, läuft den Loop, summiert. Kein Try-Catch
 * um den Loop — der Caller (API-Handler) entscheidet wie er Errors an den
 * cron weiterreicht.
 */
export async function cleanupOldPreflightScreenshots(): Promise<CleanupResult> {
  const eligible = await selectEligibleRuns();
  let runsCleaned = 0;
  let screenshotsDeleted = 0;
  let runsAlreadyPurged = 0;
  let runsFailed = 0;

  for (const { runId } of eligible) {
    const deleted = await purgeOneRun(runId);
    if (deleted === null) {
      runsFailed += 1;
      continue;
    }
    if (deleted === 0) {
      // Bunny hatte schon nichts mehr — entweder Race oder manuell
      // gelöscht. Wir setzen `preflight_purged_at` trotzdem, das hat
      // `purgeOneRun` bereits getan.
      runsAlreadyPurged += 1;
    }
    runsCleaned += 1;
    screenshotsDeleted += deleted;
  }

  return {
    runsCleaned,
    screenshotsDeleted,
    runsAlreadyPurged,
    runsFailed,
  };
}
