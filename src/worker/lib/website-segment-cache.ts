/**
 * Cache für FIXE Website-Segmente (`personalized === false`).
 *
 * Hintergrund (Incident 2026-08-19/20, Run „2. Runde 20.8.2026"): ein fixes
 * Website-Segment zeigt für ALLE Leads dieselbe URL — trotzdem wurde es pro
 * Lead in Realzeit neu aufgenommen. Bei 77 parallelen Leads staute sich der
 * Host-Slot-Throttle (max. 2 Loads/Host) so lange, dass 49 Captures ins
 * 90s-Hard-Timeout liefen und still durch den „Website nicht erreichbar"-
 * Platzhalter ersetzt wurden.
 *
 * Lösung: das fertige Segment-MP4 wird pro Cache-Key genau EINMAL pro
 * Prozess gerendert (parallele Leads teilen die Promise) und danach nur
 * noch kopiert. Muster 1:1 vom PDF-Segment-Cache in pdf-segment-render.ts
 * (in-memory Promise-Dedupe + atomares .tmp+rename, ffprobe-validierte
 * Disk-Hits nach Worker-Restart, TTL-Sweep 2h mit mtime-Touch bei Hits).
 *
 * WICHTIG: der geteilte Render bekommt KEIN per-Lead-AbortSignal — der
 * Stage-Timeout EINES Leads darf den Render für alle Wartenden nicht
 * killen. Frames landen deshalb in einem cache-eigenen Work-Dir statt im
 * Lead-Workdir (das beim Stage-Timeout gelöscht wird). Caller prüfen ihr
 * eigenes Signal nach dem await.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import type { ScrollFrame, CursorFrame } from "@/lib/segments/types";
import { renderWebsiteCapture } from "./website-render-pipeline";
import { imageSeqToMp4 } from "./ffmpeg";

export interface RenderFixedWebsiteSegmentOpts {
  url: string;
  /** Geplante (ggf. geclampte) Segment-Dauer in ms. */
  durationMs: number;
  mode: "static-hero" | "scroll-recorded";
  scrollFrames?: ScrollFrame[];
  cursorFrames?: CursorFrame[];
  /** Zielpfad des fertigen Segment-MP4 (per-Lead). */
  outputPath: string;
  fps?: number;
}

const WEB_SEG_CACHE_DIR = "/tmp/videocomet-webseg-cache";
const WEB_SEG_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const WEB_SEG_CACHE = new Map<string, Promise<string>>();

async function sweepWebSegCache(): Promise<void> {
  try {
    const entries = await readdir(WEB_SEG_CACHE_DIR);
    const now = Date.now();
    for (const name of entries) {
      const p = join(WEB_SEG_CACHE_DIR, name);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > WEB_SEG_CACHE_TTL_MS) {
          await rm(p, { recursive: true, force: true });
        }
      } catch {
        // best-effort — Datei kann parallel verschwunden sein
      }
    }
  } catch {
    // Cache-Dir existiert noch nicht — ok
  }
}

function buildCacheKey(
  opts: RenderFixedWebsiteSegmentOpts,
  fps: number,
): string {
  const payload = JSON.stringify({
    v: 1,
    url: opts.url,
    durationMs: opts.durationMs,
    fps,
    mode: opts.mode,
    scrollFrames: opts.scrollFrames ?? [],
    cursorFrames: opts.cursorFrames ?? [],
  });
  return createHash("sha1").update(payload).digest("hex");
}

/**
 * Rendert ein fixes Website-Segment nach `opts.outputPath` — pro Cache-Key
 * genau einmal pro Prozess, danach nur noch Copy aus dem Cache.
 */
export async function renderFixedWebsiteSegment(
  opts: RenderFixedWebsiteSegmentOpts,
): Promise<void> {
  const fps = opts.fps ?? 30;
  const key = buildCacheKey(opts, fps);
  const target = join(WEB_SEG_CACHE_DIR, `${key}.mp4`);

  const existing = WEB_SEG_CACHE.get(key);
  if (existing) {
    try {
      const p = await existing;
      if (existsSync(p)) {
        // mtime touchen, damit der TTL-Sweep aktive Einträge nicht killt.
        const now = new Date();
        await utimes(p, now, now).catch(() => {});
        // eslint-disable-next-line no-console
        console.log(`[webseg-cache] cache hit (${key.slice(0, 8)})`);
        await copyFile(p, opts.outputPath);
        return;
      }
    } catch {
      // rejected — unten frisch aufbauen
    }
    WEB_SEG_CACHE.delete(key);
  }

  const job = (async () => {
    await mkdir(WEB_SEG_CACHE_DIR, { recursive: true });
    void sweepWebSegCache();

    if (existsSync(target)) {
      // Disk-Hit ohne Memory-Eintrag (z.B. nach Worker-Restart) — nicht
      // blind vertrauen: könnte ein Torso eines gekillten Prozesses sein.
      try {
        const { probeVideoDuration } = await import("../../lib/ffprobe");
        const d = await probeVideoDuration(target);
        if (typeof d === "number" && d > 0) {
          const now = new Date();
          await utimes(target, now, now).catch(() => {});
          // eslint-disable-next-line no-console
          console.log(
            `[webseg-cache] cache hit from disk (${key.slice(0, 8)})`,
          );
          return target;
        }
      } catch {
        // invalide — neu aufbauen
      }
      await rm(target, { force: true }).catch(() => {});
    }

    const workDir = join(
      WEB_SEG_CACHE_DIR,
      `work-${key.slice(0, 8)}-${process.pid}-${Date.now()}`,
    );
    // MUSS auf .mp4 enden — ffmpeg leitet das Container-Format aus der
    // Endung ab (Incident 2026-08-19: ohne Endung wurden alle Szenen
    // schwarze Ersatz-Clips).
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}.mp4`;
    try {
      const fr = await renderWebsiteCapture({
        url: opts.url,
        outputDir: workDir,
        durationMs: opts.durationMs,
        mode: opts.mode,
        scrollFrames: opts.scrollFrames,
        cursorFrames: opts.cursorFrames,
        fps,
      });
      await imageSeqToMp4({
        framesDir: fr.framesDir,
        outputPath: tmp,
        fps: fr.fps,
      });
      await rename(tmp, target); // atomar (gleiches FS)
      return target;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      await rm(tmp, { force: true }).catch(() => {});
    }
  })();

  WEB_SEG_CACHE.set(key, job);
  try {
    const p = await job;
    await copyFile(p, opts.outputPath);
  } catch (e) {
    // Fehlgeschlagene Renders nicht cachen — nächster Lead versucht frisch.
    WEB_SEG_CACHE.delete(key);
    throw e;
  }
}
