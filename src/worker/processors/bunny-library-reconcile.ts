/**
 * Bunny-Library-Reconcile-Sweep (Review-Fund 4, "keine Leichen").
 *
 * Problem: der Purge-Worker (bunny-purge.ts) kennt nur Videos, die im
 * `bunny_assets`-Register stehen. Videos, die NIE getrackt wurden — z.B.
 * Uploads aus abgebrochenen Pipelines (Tracking lief erst nach dem
 * Encoding-Wait) oder Alt-Bestand von vor Paket B — bleiben für immer in
 * der Stream-Library liegen (Stand Juli 2026: >1200 Videos, viele davon
 * Retry-Duplikate).
 *
 * Dieser Sweep gleicht die KOMPLETTE Bunny-Library gegen die DB ab und
 * löscht nur Videos, die nachweislich nirgends referenziert sind.
 *
 * Sicherheits-Design (echte Kunden-Kampagnen dürfen NIE getroffen werden):
 *  1. Known-Set = ALLE UUID-förmigen Strings aus den kompletten Rows der
 *     Tabellen leads, runs, campaigns, media_items, landing_page_templates
 *     sowie bunny_assets (ohne purge_state='purged'). Ganze Rows als Text
 *     gescannt → auch GUIDs in JSONB-Blöcken (LP-Block-Configs, Segments)
 *     oder eingebettet in CDN-/Embed-URLs sind geschützt. Falsch-Positive
 *     (z.B. Lead-IDs) schützen nur MEHR — nie weniger.
 *  2. Altersschwelle: nur Videos, deren Bunny-Upload älter als
 *     MIN_AGE_MS (24h) ist. In-flight-Pipelines persistieren ihre GUID
 *     zwar binnen Sekunden, aber die Schwelle macht Races strukturell
 *     unmöglich.
 *  3. Double-Check: das Known-Set wird unmittelbar vor der Delete-Phase
 *     ERNEUT aus der DB gebaut und die Kandidaten nochmal gefiltert.
 *  4. Bounded: max MAX_DELETES_PER_TICK Deletes pro Tick, Parallelität 4,
 *     250ms Pause zwischen Batches (gleiche Rate-Limits wie bunny-purge).
 *
 * `dryRun: true` liefert nur den Report, löscht nichts.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BunnyApiError } from "@/lib/bunny/_fetch";
import {
  deleteVideo,
  listVideosPage,
  type StreamLibraryVideo,
} from "@/lib/bunny/stream";

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // Hart-Cap: 10.000 Videos pro Tick reichen.
const MAX_DELETES_PER_TICK = 300;
const PARALLELISM = 4;
const INTER_BATCH_DELAY_MS = 250;
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // alle 6h

const UUID_RE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function log(level: "info" | "warn" | "error", msg: string): void {
  // eslint-disable-next-line no-console
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[bunny-reconcile] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Baut das Known-Set: jede UUID, die IRGENDWO in den relevanten Tabellen
 * auftaucht (ganze Row als Text gescannt, inkl. JSONB). Superset-Ansatz:
 * lieber zu viel schützen als ein echtes Video löschen.
 */
async function buildKnownGuidSet(): Promise<Set<string>> {
  const query = sql.raw(`
    SELECT DISTINCT lower(m[1]) AS guid FROM (
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') AS m FROM leads t
      UNION ALL
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') FROM runs t
      UNION ALL
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') FROM campaigns t
      UNION ALL
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') FROM media_items t
      UNION ALL
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') FROM landing_page_templates t
      UNION ALL
      SELECT regexp_matches(t::text, '${UUID_RE}', 'gi') FROM bunny_assets t
      WHERE t.purge_state <> 'purged'
    ) s
  `);
  const rows = (await db.execute(query)) as unknown as Array<{ guid: string }>;
  const set = new Set<string>();
  for (const r of rows) set.add(r.guid);
  return set;
}

async function listAllLibraryVideos(): Promise<StreamLibraryVideo[]> {
  const all: StreamLibraryVideo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, totalItems } = await listVideosPage(page, PAGE_SIZE);
    all.push(...items);
    if (all.length >= totalItems || items.length === 0) break;
  }
  return all;
}

function isAlreadyGoneError(err: unknown): boolean {
  return (
    err instanceof BunnyApiError && (err.status === 404 || err.status === 410)
  );
}

export interface ReconcileTickResult {
  libraryTotal: number;
  knownGuids: number;
  candidates: number;
  deleted: number;
  failed: number;
  dryRun: boolean;
}

export async function runBunnyLibraryReconcileTick(
  options: { dryRun?: boolean } = {},
): Promise<ReconcileTickResult> {
  const dryRun = options.dryRun ?? false;
  const known = await buildKnownGuidSet();
  const library = await listAllLibraryVideos();
  const cutoff = Date.now() - MIN_AGE_MS;

  let candidates = library.filter((v) => {
    if (!v.guid || known.has(v.guid.toLowerCase())) return false;
    const uploadedAt = Date.parse(v.dateUploaded);
    // Unparsbares Datum → konservativ behalten.
    if (!Number.isFinite(uploadedAt)) return false;
    return uploadedAt < cutoff;
  });

  if (candidates.length === 0 || dryRun) {
    log(
      "info",
      `tick: library=${library.length} known=${known.size} candidates=${candidates.length}${dryRun ? " (dry-run, no deletes)" : ""}`,
    );
    return {
      libraryTotal: library.length,
      knownGuids: known.size,
      candidates: candidates.length,
      deleted: 0,
      failed: 0,
      dryRun,
    };
  }

  // Double-Check unmittelbar vor der Delete-Phase: Known-Set frisch bauen
  // und erneut filtern — schließt das Fenster, in dem zwischen dem ersten
  // Set-Build und jetzt eine neue Referenz entstanden sein könnte.
  const recheck = await buildKnownGuidSet();
  candidates = candidates.filter((v) => !recheck.has(v.guid.toLowerCase()));
  candidates = candidates.slice(0, MAX_DELETES_PER_TICK);

  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < candidates.length; i += PARALLELISM) {
    const chunk = candidates.slice(i, i + PARALLELISM);
    const settled = await Promise.allSettled(
      chunk.map(async (v) => {
        try {
          await deleteVideo(v.guid);
        } catch (err) {
          if (!isAlreadyGoneError(err)) throw err;
        }
      }),
    );
    for (let j = 0; j < settled.length; j++) {
      if (settled[j].status === "fulfilled") {
        deleted += 1;
      } else {
        failed += 1;
        const reason = (settled[j] as PromiseRejectedResult).reason;
        log(
          "warn",
          `delete failed for ${chunk[j].guid}: ${(reason as Error)?.message ?? reason}`,
        );
      }
    }
    if (i + PARALLELISM < candidates.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  log(
    "info",
    `tick done: library=${library.length} known=${known.size} candidates=${candidates.length} deleted=${deleted} failed=${failed}`,
  );
  return {
    libraryTotal: library.length,
    knownGuids: known.size,
    candidates: candidates.length,
    deleted,
    failed,
    dryRun,
  };
}

/**
 * Startet den Reconcile-Loop (Boot-Tick sofort, danach alle 6h). Mirror-API
 * zu `startBunnyPurger()` — liefert eine stop()-Funktion.
 */
export function startBunnyLibraryReconciler(): () => void {
  void runBunnyLibraryReconcileTick().catch((err) => {
    log("error", `initial tick crashed: ${(err as Error)?.message ?? err}`);
  });
  const t = setInterval(() => {
    runBunnyLibraryReconcileTick().catch((err) => {
      log("error", `periodic tick crashed: ${(err as Error)?.message ?? err}`);
    });
  }, RECONCILE_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
