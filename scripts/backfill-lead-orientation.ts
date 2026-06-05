/**
 * One-shot Backfill: füllt `leads.video_width / video_height /
 * video_orientation / video_mp4_url` für bestehende Leads, deren Video in
 * Bunny Stream liegt aber deren Orientation-Felder noch NULL sind.
 *
 * Hintergrund (Paket A, Migration 0015):
 *  Neue Spalten an `leads` cachen die Bunny-Stream-Dimensionen, damit der
 *  Public-Player und die PDF-Thumbnail-Pipeline nicht jedes Mal die
 *  Bunny-API anfragen. Bestehende Leads haben die Spalten NULL — ohne
 *  Backfill würde der LP-Renderer auf Landscape-Fallback gehen, was bei
 *  Portrait-Webcams die Player-Box falsch dimensioniert.
 *
 * API-Calls:
 *  - `getVideo(guid)` → liefert `width`, `height`, `availableResolutions`,
 *    `hasOriginal`.
 *  - `getVideoDownloadUrls(guid, cdnHostname)` → liefert sortierte MP4-
 *    Liste; wir nehmen die erste (höchste Auflösung).
 *
 * Rate-Limit: max 4 parallel Bunny-API-Calls. Damit halten wir uns weit
 * unter dem Bunny-Limit (60 req/s pro Library) und stören laufende
 * Renderings nicht.
 *
 * Idempotent: WHERE-Filter überspringt bereits befüllte Leads.
 *
 * Aufruf:
 *   tsx scripts/backfill-lead-orientation.ts
 */

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads } from "../src/lib/db/schema";
import { updateLeadStatus } from "../src/lib/db/queries/leads";
import { getVideo, getVideoDownloadUrls } from "../src/lib/bunny/stream";
import { getBunnyStreamEnv } from "../src/lib/bunny/env";

type Orientation = "landscape" | "portrait" | "square";

function classifyOrientation(width: number, height: number): Orientation {
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
}

interface BackfillTarget {
  id: string;
  bunnyVideoId: string;
}

interface BackfillResult {
  id: string;
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  orientation?: Orientation;
  mp4Url?: string | null;
}

async function processOne(
  target: BackfillTarget,
  cdnHostname: string,
): Promise<BackfillResult> {
  try {
    const meta = await getVideo(target.bunnyVideoId);
    const width = Number(meta.width ?? 0);
    const height = Number(meta.height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) {
      return {
        id: target.id,
        ok: false,
        error: `Bunny meta missing dims (width=${meta.width} height=${meta.height})`,
      };
    }
    const orientation = classifyOrientation(width, height);

    let mp4Url: string | null = null;
    try {
      const urls = await getVideoDownloadUrls(target.bunnyVideoId, cdnHostname);
      mp4Url = urls[0]?.url ?? null;
    } catch (err) {
      // MP4-URL ist Nice-to-have, kein Hard-Fail. Wir behalten width/height
      // und lassen mp4Url NULL — der Renderer fällt dann auf HLS zurück.
      console.warn(
        `[backfill-lead-orientation] mp4 lookup failed id=${target.id}:`,
        err instanceof Error ? err.message : err,
      );
    }

    await updateLeadStatus(target.id, {
      videoWidth: width,
      videoHeight: height,
      videoOrientation: orientation,
      videoMp4Url: mp4Url,
    });

    return { id: target.id, ok: true, width, height, orientation, mp4Url };
  } catch (err) {
    return {
      id: target.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Simple concurrency-Pool: feuert maximal `limit` `processOne`-Aufrufe
 * gleichzeitig. Sobald einer fertig wird, rückt der nächste nach. Liefert
 * alle Ergebnisse in Eingabe-Reihenfolge nicht garantiert (wir aggregieren
 * Counts, also ist die Reihenfolge egal).
 */
async function runWithConcurrency(
  targets: BackfillTarget[],
  limit: number,
  cdnHostname: string,
): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];
  let cursor = 0;
  let processed = 0;
  async function worker() {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= targets.length) return;
      const r = await processOne(targets[i], cdnHostname);
      results.push(r);
      processed += 1;
      if (processed % 25 === 0) {
        const ok = results.filter((x) => x.ok).length;
        const fail = results.filter((x) => !x.ok).length;
        console.log(
          `[backfill-lead-orientation] progress ${processed}/${targets.length} ok=${ok} fail=${fail}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => worker()));
  return results;
}

async function main() {
  const env = getBunnyStreamEnv();
  const targets = await db
    .select({
      id: leads.id,
      bunnyVideoId: leads.bunnyVideoId,
    })
    .from(leads)
    .where(
      and(
        isNotNull(leads.bunnyVideoId),
        // Wir wollen Leads, deren Orientation-Cache noch unvollständig ist.
        // Wenn videoWidth ODER videoOrientation NULL ist, läuft der
        // Backfill. (Mp4Url darf NULL bleiben — z.B. wenn Bunny noch keine
        // MP4-Fallbacks erstellt hat.)
        or(isNull(leads.videoWidth), isNull(leads.videoOrientation)),
      ),
    );

  const filtered = targets.filter(
    (t): t is BackfillTarget =>
      typeof t.bunnyVideoId === "string" && t.bunnyVideoId.length > 0,
  );
  console.log(
    `[backfill-lead-orientation] ${filtered.length} leads to backfill (concurrency=4)`,
  );
  if (filtered.length === 0) return;

  const t0 = Date.now();
  const results = await runWithConcurrency(filtered, 4, env.cdnHostname);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const failures = results.filter((r) => !r.ok).slice(0, 20);
  console.log(
    `[backfill-lead-orientation] done in ${Date.now() - t0}ms — ok=${ok} fail=${fail}`,
  );
  for (const f of failures) {
    console.warn(`  fail id=${f.id} — ${f.error}`);
  }
  // Drizzle-Operator-Import-Hygiene: `eq` ist hier import-ed um zukünftige
  // Lead-spezifische Filter zu erleichtern. Verhindere "unused import"-Warn.
  void eq;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-lead-orientation] FATAL:", err);
    process.exit(1);
  });
