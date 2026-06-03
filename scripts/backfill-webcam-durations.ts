/**
 * One-shot Backfill: für alle media_items mit type='webcam' und
 * duration_sec IS NULL die echte Dauer via ffprobe ermitteln und
 * eintragen.
 *
 * Hintergrund: vor dem Fix 2026-06-03 wurde der Webcam-Upload mit
 * `durationSec: null` gespeichert. Der Render-Worker fiel deshalb auf
 * den 30s-Fallback zurück und konnte Videos erzeugen, die länger als die
 * Webcam-Source waren.
 *
 * Aufruf im Container:
 *   docker exec videocomet-app sh -lc \
 *     'cd /app && node --experimental-strip-types scripts/backfill-webcam-durations.ts'
 *
 * Idempotent: Items mit gesetzter Dauer werden übersprungen.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { mediaItems } from "../src/lib/db/schema";
import { probeRemoteVideoDuration } from "../src/lib/ffprobe";

async function main() {
  const targets = await db
    .select({
      id: mediaItems.id,
      name: mediaItems.name,
      publicUrl: mediaItems.publicUrl,
    })
    .from(mediaItems)
    .where(and(eq(mediaItems.type, "webcam"), isNull(mediaItems.durationSec)));

  console.log(`[backfill] ${targets.length} webcam items ohne Dauer gefunden.`);
  let ok = 0;
  let fail = 0;
  for (const item of targets) {
    try {
      const sec = await probeRemoteVideoDuration(item.publicUrl);
      if (sec === null) {
        console.warn(`[backfill] probe-FAIL id=${item.id} name=${item.name}`);
        fail += 1;
        continue;
      }
      const rounded = Math.round(sec * 1000) / 1000;
      await db
        .update(mediaItems)
        .set({ durationSec: rounded })
        .where(eq(mediaItems.id, item.id));
      console.log(
        `[backfill] OK id=${item.id} name=${item.name} duration=${rounded}s`,
      );
      ok += 1;
    } catch (err) {
      console.error(
        `[backfill] ERR id=${item.id} name=${item.name}:`,
        err instanceof Error ? err.message : err,
      );
      fail += 1;
    }
  }
  console.log(`[backfill] done — ok=${ok} fail=${fail}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
