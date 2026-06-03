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

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { mediaItems } from "../src/lib/db/schema";
import { probeVideoDuration } from "../src/lib/ffprobe";

/**
 * Lädt eine Bunny-CDN-URL mit Referer (Hotlink-Protection) und gibt einen
 * lokalen Dateipfad zurück. Caller muss aufräumen.
 */
async function downloadToTmp(url: string): Promise<string> {
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const res = await fetch(url, {
    headers: { Referer: referer, Origin: referer },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(tmpdir(), "videocomet-backfill");
  await mkdir(dir, { recursive: true });
  const ext = url.match(/\.(webm|mp4|mov)(?:\?|$)/i)?.[1] ?? "webm";
  const path = join(dir, `${randomUUID()}.${ext}`);
  await writeFile(path, buf);
  return path;
}

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
    let localPath: string | null = null;
    try {
      localPath = await downloadToTmp(item.publicUrl);
      const sec = await probeVideoDuration(localPath);
      if (sec === null) {
        console.warn(`[backfill] probe-FAIL id=${item.id} name=${item.name}`);
        fail += 1;
        continue;
      }
      const rounded = Math.round(sec);
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
    } finally {
      if (localPath) {
        try { await unlink(localPath); } catch { /* ignore */ }
      }
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
