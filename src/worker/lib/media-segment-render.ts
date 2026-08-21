/**
 * Media-Segment-Renderer (Studio-Szenen „Bild" und „Video", NICHT
 * personalisiert).
 *
 * Bild-Segment:
 *   Download → sharp contain auf 1280x720 mit MEDIA_STAGE_BG-Grund (exakt
 *   die Bühnen-Optik aus studio-stage.tsx) → Still-MP4 (loop + anullsrc).
 *
 * Video-Segment (Studio-Wiedergabefenster, siehe VideoPlaybackWindow in
 * segments/types.ts):
 *   Download der besten MP4-Variante (Bunny-Stream-HLS-Auflösung wie
 *   fetchToFile in video-render.ts) → Stückliste aus Standbildern und
 *   Play-Abschnitten:
 *
 *     [Poster-Still bis startMs] [Play ab akkumulierter Quellposition]
 *     [Freeze-Frame nach stopMs] … [Tail-Still bis Segmentende]
 *
 *   Gesamtdauer == durationMs (Fenster werden defensiv auf [0, durationMs]
 *   und die verfügbare Quelllänge geclampt; erschöpfte Quelle → Freeze).
 *   Ohne Fenster: Poster-Standbild über die gesamte Dauer.
 *
 * Audio: JEDES Teilstück trägt eine AAC-Stereo-44100-Spur (Play-Stücke den
 * Original-Ton, Stills anullsrc-Stille). Dadurch bleibt der concat-Demuxer
 * (`-c copy`) layout-konsistent und die Base-Audio-Timeline exakt — Grundlage
 * für composePip's mixBaseAudio (amix Base-Ton + Webcam-Stimme).
 *
 * Cache: Beide Segment-Typen sind für alle Leads identisch → fertiges MP4
 * prozessweit auf Disk cachen. Muster 1:1 von pdf-segment-render.ts
 * (in-memory Promise-Dedupe + atomares .tmp+rename, ffprobe-validierte
 * Disk-Hits nach Worker-Restart, TTL-Sweep 2h mit mtime-Touch bei Hits).
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
import sharp from "sharp";
import type {
  ImageSegment,
  VideoPlaybackWindow,
  VideoSegment,
} from "@/lib/segments/types";
import { MEDIA_STAGE_BG, videoSegmentVolume } from "@/lib/segments/types";
import { probeHasAudioStream, probeVideoDuration } from "@/lib/ffprobe";
import { concatClips, runFfmpeg } from "./ffmpeg";
import { fetchToFile } from "../processors/video-render";

const OUT_W = 1280;
const OUT_H = 720;
const DEFAULT_FPS = 30;
const HARD_TIMEOUT_MS = 240_000;
/**
 * Stücke unterhalb ~1 Frame (30fps ≈ 33ms) sind für ffmpeg problematisch —
 * sie werden in den Nachbarn gemerged, damit die Gesamtdauer exakt bleibt.
 */
const MIN_PIECE_MS = 40;

/** MEDIA_STAGE_BG für ffmpeg-Filtergraphen (`#101014` → `0x101014`). */
const FFMPEG_BG = MEDIA_STAGE_BG.replace("#", "0x");

/** scale+pad auf 1280x720 contain mit Bühnen-Hintergrund. */
const CONTAIN_VF = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:${FFMPEG_BG},setsar=1`;

const ANULLSRC = "anullsrc=channel_layout=stereo:sample_rate=44100";

/* -------------------------------------------------------------------------- */
/* Segment-MP4-Cache (Muster: pdf-segment-render.ts)                          */
/* -------------------------------------------------------------------------- */

const MEDIA_SEG_CACHE_DIR = "/tmp/videocomet-mediaseg-cache";
// 6h TTL: erlaubt Cache-Reuse über die typische Runden-Dauer hinweg
// (Bulk-Runs à 100+ Leads laufen locker 1-2h). Der Cache-Ordner wird
// regelmäßig gepflegt (siehe cleanupMediaSegCache unten), Disk-Overhead
// bleibt gering (typisch <500 MB pro Prozess).
const MEDIA_SEG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MEDIA_SEG_CACHE = new Map<string, Promise<string>>();

async function sweepMediaSegCache(): Promise<void> {
  try {
    const entries = await readdir(MEDIA_SEG_CACHE_DIR);
    const now = Date.now();
    for (const name of entries) {
      const p = join(MEDIA_SEG_CACHE_DIR, name);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > MEDIA_SEG_CACHE_TTL_MS) {
          await rm(p, { force: true });
        }
      } catch {
        // best-effort — Datei kann parallel verschwunden sein
      }
    }
  } catch {
    // Cache-Dir existiert noch nicht — ok
  }
}

/**
 * Rendert einmal pro Cache-Key und Prozess (parallele Leads teilen die
 * Promise), kopiert danach nur noch aus dem Cache. `produce` schreibt das
 * fertige MP4 nach `tmpPath` (atomarer rename ins Cache-Target).
 */
export async function renderCached(
  key: string,
  outputPath: string,
  label: string,
  produce: (tmpPath: string) => Promise<void>,
): Promise<void> {
  const target = join(MEDIA_SEG_CACHE_DIR, `${key}.mp4`);

  const existing = MEDIA_SEG_CACHE.get(key);
  if (existing) {
    try {
      const p = await existing;
      if (existsSync(p)) {
        // mtime touchen, damit der TTL-Sweep aktive Einträge nicht killt.
        const now = new Date();
        await utimes(p, now, now).catch(() => {});
        // eslint-disable-next-line no-console
        console.log(`[media-segment] ${label} cache hit (${key.slice(0, 8)})`);
        await copyFile(p, outputPath);
        return;
      }
    } catch {
      // rejected — unten frisch aufbauen
    }
    MEDIA_SEG_CACHE.delete(key);
  }

  const job = (async () => {
    await mkdir(MEDIA_SEG_CACHE_DIR, { recursive: true });
    void sweepMediaSegCache();

    if (existsSync(target)) {
      // Disk-Hit ohne Memory-Eintrag (z.B. nach Worker-Restart) — nicht
      // blind vertrauen: könnte ein Torso eines gekillten Prozesses sein.
      try {
        const d = await probeVideoDuration(target);
        if (typeof d === "number" && d > 0) {
          const now = new Date();
          await utimes(target, now, now).catch(() => {});
          // eslint-disable-next-line no-console
          console.log(
            `[media-segment] ${label} cache hit from disk (${key.slice(0, 8)})`,
          );
          return target;
        }
      } catch {
        // invalide — neu aufbauen
      }
      await rm(target, { force: true }).catch(() => {});
    }

    // KRITISCH: `.mp4` MUSS die letzte Extension sein (2026-08-18 Bug).
    // ffmpeg leitet das Output-Format aus der Dateiendung ab. Ohne `.mp4`
    // am Ende wirft es "Unable to find a suitable output format for
    // <path>.tmp.<pid>.<ts>" und der Video-Segment-Renderer failt, der
    // Composite-Fallback rendert dann einen SCHWARZEN Clip an Stelle des
    // Video-Segments → alle Video-Szenen im finalen Lead-Video schwarz.
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}.mp4`;
    try {
      await withTimeout(produce(tmp), HARD_TIMEOUT_MS, label);
      // Output validieren BEVOR es in den Cache wandert: ein kaputtes MP4
      // (0 Bytes, Torso, falsches Format) würde sonst still gecached und
      // an ALLE Leads der Runde ausgeliefert. Lieber laut failen — der
      // Fallback im video-render meldet das dann als error-Event.
      const producedSec = await probeVideoDuration(tmp).catch(() => null);
      if (typeof producedSec !== "number" || producedSec <= 0) {
        throw new Error(
          `[media-segment] ${label} render produced invalid MP4 (duration=${producedSec ?? "unlesbar"})`,
        );
      }
      await rename(tmp, target); // atomar (gleiches FS)
      return target;
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  })();

  MEDIA_SEG_CACHE.set(key, job);
  job.catch(() => MEDIA_SEG_CACHE.delete(key));

  const cachedPath = await job;
  await copyFile(cachedPath, outputPath);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Wraps a promise with a hard wall-clock timeout. */
async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`[media-segment] ${label} timed out after ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Encodiert ein einzelnes Bild als Standbild-MP4 exakter Dauer mit
 * anullsrc-AAC-Stille (Codec-Parameter passend zu concatClips `-c copy`).
 */
async function stillToMp4(opts: {
  imagePath: string;
  durationMs: number;
  outputPath: string;
  fps: number;
}): Promise<void> {
  const durationSec = Math.max(0.05, opts.durationMs / 1000);
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(opts.fps),
    "-t",
    durationSec.toFixed(3),
    "-i",
    opts.imagePath,
    "-f",
    "lavfi",
    "-i",
    ANULLSRC,
    "-shortest",
    "-vf",
    CONTAIN_VF,
    "-r",
    String(opts.fps),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    opts.outputPath,
  ]);
}

/**
 * Extrahiert einen Frame an `sourcePosMs` als JPG. Positionen nahe am
 * Dateiende liefern gern keinen Frame → Rückzug in 2 Stufen (Pos-150ms, 0).
 */
async function extractFrame(opts: {
  sourcePath: string;
  sourcePosMs: number;
  outputPath: string;
}): Promise<void> {
  const tryAt = async (posMs: number) => {
    await runFfmpeg([
      "-y",
      "-ss",
      (Math.max(0, posMs) / 1000).toFixed(3),
      "-i",
      opts.sourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      opts.outputPath,
    ]);
    if (!existsSync(opts.outputPath)) {
      throw new Error(`[media-segment] no frame at ${posMs}ms`);
    }
  };
  try {
    await tryAt(opts.sourcePosMs);
  } catch {
    try {
      await tryAt(opts.sourcePosMs - 150);
    } catch {
      await tryAt(0);
    }
  }
}

/**
 * FFmpeg-Audio-Filter für die Segment-Lautstärke. Pure Funktion, exportiert
 * für Tests: volume=1 (Default) ergibt KEINEN Filter — bitidentisch zum
 * Verhalten vor Einführung des Volume-Features.
 */
export function volumeAudioFilterArgs(
  hasAudio: boolean,
  volume: number,
): string[] {
  if (!hasAudio || volume === 1) return [];
  return ["-af", `volume=${volume.toFixed(4)}`];
}

/**
 * Encodiert einen Play-Abschnitt: Quelle ab `sourcePosMs` für `durationMs`,
 * 1280x720 contain, 30fps. Mit Quell-Audio (resampled 44100/stereo) oder —
 * wenn die Quelle keinen Audio-Stream hat — anullsrc-Stille.
 */
async function playPieceToMp4(opts: {
  sourcePath: string;
  sourcePosMs: number;
  durationMs: number;
  outputPath: string;
  fps: number;
  hasAudio: boolean;
  /** Lautstärke des Quell-Tons 0..1 (Segment-Einstellung). Default 1. */
  volume?: number;
}): Promise<void> {
  const args: string[] = [
    "-y",
    "-ss",
    (Math.max(0, opts.sourcePosMs) / 1000).toFixed(3),
    "-i",
    opts.sourcePath,
  ];
  if (!opts.hasAudio) {
    args.push("-f", "lavfi", "-i", ANULLSRC, "-map", "0:v:0", "-map", "1:a:0");
  }
  args.push(...volumeAudioFilterArgs(opts.hasAudio, opts.volume ?? 1));
  args.push(
    "-t",
    (opts.durationMs / 1000).toFixed(3),
    "-shortest",
    "-vf",
    `${CONTAIN_VF},fps=${opts.fps}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    opts.outputPath,
  );
  await runFfmpeg(args);
}

/* -------------------------------------------------------------------------- */
/* Stückliste (Fenster → Stills + Play-Abschnitte)                            */
/* -------------------------------------------------------------------------- */

export interface MediaPiece {
  type: "still" | "play";
  /** Quellposition in ms (Still: Frame-Position, Play: Startpunkt). */
  sourcePosMs: number;
  /** Dauer des Stücks auf der Segment-Timeline in ms. */
  durationMs: number;
}

/**
 * Baut die Stückliste eines Video-Segments. Exportiert für Tests/Debug —
 * reine Funktion ohne I/O.
 *
 * Invarianten:
 *   - Σ durationMs der Stücke == `durationMs` (exakt).
 *   - Quellposition akkumuliert über die Play-Stücke (Resume-Semantik).
 *   - Fenster werden auf [0, durationMs] geclampt; Play-Länge zusätzlich auf
 *     die verbleibende Quelllänge — der Rest des Fensters friert ein.
 *   - Stücke < MIN_PIECE_MS werden in den Vorgänger (bzw. Nachfolger)
 *     gemerged.
 */
export function planVideoPieces(opts: {
  windows: VideoPlaybackWindow[];
  durationMs: number;
  trimStartMs: number;
  /** Quelldauer in ms; Infinity = unbekannt (kein Clamp). */
  sourceDurationMs: number;
}): MediaPiece[] {
  const total = Math.max(1, Math.round(opts.durationMs));
  const srcDur = opts.sourceDurationMs;
  let srcPos = Math.max(0, opts.trimStartMs);
  if (Number.isFinite(srcDur)) srcPos = Math.min(srcPos, Math.max(0, srcDur));

  const sorted = [...opts.windows]
    .map((w) => ({
      startMs: Math.max(0, Math.min(total, Math.round(w.startMs))),
      stopMs: Math.max(0, Math.min(total, Math.round(w.stopMs))),
    }))
    .filter((w) => w.stopMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  // KRITISCH: Ohne Playback-Fenster wird das Video normal von Anfang bis Ende
  // (bzw. bis zum Segment-Ende) abgespielt. Ohne diesen Fallback rendert der
  // Worker ein Standbild für die gesamte Segment-Dauer — das ist der einzige
  // Grund, warum ein Video-Segment im finalen Lead-Video eingefroren wirken
  // kann. Studio-Aufnahmen füllen `playbackWindows` selbst (aus Play/Pause-
  // Events), aber Video-Segmente aus dem Editor haben das Feld nicht, weil
  // dort keine expliziten Play-Events erzeugt werden.
  if (sorted.length === 0) {
    sorted.push({ startMs: 0, stopMs: total });
  }

  const pieces: MediaPiece[] = [];
  let cursor = 0;

  for (const w of sorted) {
    const start = Math.max(w.startMs, cursor);
    if (start >= w.stopMs) continue; // Überlapp — defensiv überspringen
    if (start > cursor) {
      pieces.push({ type: "still", sourcePosMs: srcPos, durationMs: start - cursor });
      cursor = start;
    }
    const want = w.stopMs - cursor;
    const avail = Number.isFinite(srcDur) ? Math.max(0, srcDur - srcPos) : want;
    const playLen = Math.min(want, avail);
    if (playLen > 0) {
      pieces.push({ type: "play", sourcePosMs: srcPos, durationMs: playLen });
      srcPos += playLen;
      cursor += playLen;
    }
    if (cursor < w.stopMs) {
      // Quelle erschöpft → Rest des Fensters als Freeze-Frame.
      pieces.push({
        type: "still",
        sourcePosMs: srcPos,
        durationMs: w.stopMs - cursor,
      });
      cursor = w.stopMs;
    }
  }

  if (cursor < total) {
    pieces.push({ type: "still", sourcePosMs: srcPos, durationMs: total - cursor });
  }
  if (pieces.length === 0) {
    pieces.push({ type: "still", sourcePosMs: srcPos, durationMs: total });
  }

  // Mini-Stücke in den Vorgänger mergen (Dauer bleibt exakt erhalten).
  const merged: MediaPiece[] = [];
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    if (p.durationMs < MIN_PIECE_MS && prev) {
      prev.durationMs += p.durationMs;
    } else {
      merged.push({ ...p });
    }
  }
  if (merged.length > 1 && merged[0].durationMs < MIN_PIECE_MS) {
    merged[1].durationMs += merged[0].durationMs;
    merged.shift();
  }
  return merged;
}

/* -------------------------------------------------------------------------- */
/* Bild-Segment                                                               */
/* -------------------------------------------------------------------------- */

export interface RenderImageSegmentOpts {
  segment: ImageSegment;
  /** Geplante (ggf. geclampte) Segment-Dauer in ms. */
  durationMs: number;
  /** Per-Segment-Arbeitsverzeichnis (Temp; wird selbst aufgeräumt). */
  outputDir: string;
  /** Zielpfad des fertigen Segment-MP4. */
  outputPath: string;
  fps?: number;
}

async function renderImageSegmentUncached(
  opts: RenderImageSegmentOpts,
  mp4Path: string,
  fps: number,
): Promise<void> {
  const workDir = join(opts.outputDir, "image-render");
  await mkdir(workDir, { recursive: true });
  try {
    const rawPath = join(workDir, "source.img");
    await fetchToFile(opts.segment.publicUrl as string, rawPath);

    // sharp: contain auf 1280x720 mit Bühnen-Grund (identisch zur
    // studio-stage-Vorschau). flatten zuerst — Alpha (PNG/SVG) landet sonst
    // beim JPEG-Encode auf Schwarz statt MEDIA_STAGE_BG.
    const composedPath = join(workDir, "composed.jpg");
    await sharp(rawPath, { density: 300 })
      .flatten({ background: MEDIA_STAGE_BG })
      .resize(OUT_W, OUT_H, { fit: "contain", background: MEDIA_STAGE_BG })
      .jpeg({ quality: 92 })
      .toFile(composedPath);

    await stillToMp4({
      imagePath: composedPath,
      durationMs: opts.durationMs,
      outputPath: mp4Path,
      fps,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Rendert ein Bild-Segment (Studio) zu einem 1280x720-Still-MP4 nach
 * `opts.outputPath`. Prozessweit gecached (identisch für alle Leads).
 */
export async function renderImageSegment(
  opts: RenderImageSegmentOpts,
): Promise<void> {
  if (!opts.segment.publicUrl?.trim()) {
    throw new Error("[media-segment] image segment without publicUrl");
  }
  const fps = opts.fps ?? DEFAULT_FPS;
  const key = createHash("sha1")
    .update(
      JSON.stringify({
        v: 1,
        kind: "image",
        url: opts.segment.publicUrl,
        durationMs: opts.durationMs,
        fps,
      }),
    )
    .digest("hex");
  await renderCached(key, opts.outputPath, "image", (tmp) =>
    renderImageSegmentUncached(opts, tmp, fps),
  );
}

/* -------------------------------------------------------------------------- */
/* Video-Segment                                                              */
/* -------------------------------------------------------------------------- */

export interface RenderVideoSegmentOpts {
  segment: VideoSegment;
  /** Geplante (ggf. geclampte) Segment-Dauer in ms. */
  durationMs: number;
  /** Per-Segment-Arbeitsverzeichnis (Temp; wird selbst aufgeräumt). */
  outputDir: string;
  /** Zielpfad des fertigen Segment-MP4. */
  outputPath: string;
  fps?: number;
}

async function renderVideoSegmentUncached(
  opts: RenderVideoSegmentOpts,
  mp4Path: string,
  fps: number,
): Promise<void> {
  const workDir = join(opts.outputDir, "video-render");
  await mkdir(workDir, { recursive: true });
  try {
    // 1. Beste MP4-Variante laden (Bunny-Stream-HLS → Auflösungs-Fallbacks,
    //    Logik in fetchToFile / video-render.ts).
    const srcPath = join(workDir, "source.mp4");
    await fetchToFile(opts.segment.publicUrl as string, srcPath);

    // 2. Quelle vermessen (Dauer für Fenster-Clamp, Audio für die Tonspur).
    const probedSec = await probeVideoDuration(srcPath);
    const sourceDurationMs =
      typeof probedSec === "number" && probedSec > 0
        ? probedSec * 1000
        : typeof opts.segment.originalDurationSec === "number" &&
            opts.segment.originalDurationSec > 0
          ? opts.segment.originalDurationSec * 1000
          : Infinity;
    const hasAudio = await probeHasAudioStream(srcPath);

    // 3. Stückliste planen (Fenster → Stills + Play-Abschnitte).
    const pieces = planVideoPieces({
      windows: opts.segment.playbackWindows ?? [],
      durationMs: opts.durationMs,
      trimStartMs: opts.segment.trimStartMs ?? 0,
      sourceDurationMs,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[media-segment] video plan: ${pieces
        .map((p) => `${p.type}@${Math.round(p.sourcePosMs)}+${Math.round(p.durationMs)}`)
        .join(" ")} (src=${Number.isFinite(sourceDurationMs) ? Math.round(sourceDurationMs) : "?"}ms, audio=${hasAudio})`,
    );

    // 4. Stücke encodieren. Frame-Extraktionen werden pro Quellposition
    //    dedupliziert (Poster + Tail nutzen oft denselben Frame).
    const frameCache = new Map<number, string>();
    const getFrame = async (posMs: number): Promise<string> => {
      const keyMs = Math.round(posMs);
      const cached = frameCache.get(keyMs);
      if (cached) return cached;
      const framePath = join(workDir, `frame-${keyMs}.jpg`);
      const capMs = Number.isFinite(sourceDurationMs)
        ? Math.max(0, sourceDurationMs - 150)
        : keyMs;
      await extractFrame({
        sourcePath: srcPath,
        sourcePosMs: Math.min(keyMs, capMs),
        outputPath: framePath,
      });
      frameCache.set(keyMs, framePath);
      return framePath;
    };

    const piecePaths: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const piecePath = join(workDir, `piece-${i}.mp4`);
      if (piece.type === "still") {
        const framePath = await getFrame(piece.sourcePosMs);
        await stillToMp4({
          imagePath: framePath,
          durationMs: piece.durationMs,
          outputPath: piecePath,
          fps,
        });
      } else {
        await playPieceToMp4({
          sourcePath: srcPath,
          sourcePosMs: piece.sourcePosMs,
          durationMs: piece.durationMs,
          outputPath: piecePath,
          fps,
          hasAudio,
          volume: videoSegmentVolume(opts.segment),
        });
      }
      piecePaths.push(piecePath);
    }

    // 5. Stücke zusammensetzen (identische Codec-Parameter → `-c copy`).
    if (piecePaths.length === 1) {
      await copyFile(piecePaths[0], mp4Path);
    } else {
      await concatClips({
        inputPaths: piecePaths,
        outputPath: mp4Path,
        workDir,
      });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Cache-Key-Payload eines Video-Segments. Pure Funktion, exportiert für
 * Tests: volume=1 (Default) darf den Key NICHT verändern, damit alle vor
 * dem Volume-Feature gerenderten Cache-Einträge gültig bleiben.
 */
export function videoSegmentCacheKeyPayload(
  opts: Pick<RenderVideoSegmentOpts, "segment" | "durationMs">,
  fps: number,
): string {
  return JSON.stringify({
    // v2: default-playback bei leeren windows (2026-08-18). Bumpen
    // invalidiert Alt-Cache-Einträge, die bei windows:[] als Standbild
    // gerendert wurden — sonst blockiert der Cache die neue Semantik.
    v: 2,
    kind: "video",
    url: opts.segment.publicUrl,
    durationMs: opts.durationMs,
    trimStartMs: opts.segment.trimStartMs ?? 0,
    windows: opts.segment.playbackWindows ?? [],
    // Nur bei ≠1 in den Key aufnehmen — hält alle bestehenden
    // Cache-Einträge (Default-Lautstärke) gültig.
    ...(videoSegmentVolume(opts.segment) !== 1
      ? { volume: videoSegmentVolume(opts.segment) }
      : {}),
    fps,
  });
}

/**
 * Rendert ein Video-Segment (Studio-Wiedergabefenster) zu einem
 * 1280x720-MP4 exakter Segment-Dauer nach `opts.outputPath`. Prozessweit
 * gecached — Fenster/Trim/Lautstärke gehen in den Key ein.
 */
export async function renderVideoSegment(
  opts: RenderVideoSegmentOpts,
): Promise<void> {
  if (!opts.segment.publicUrl?.trim()) {
    throw new Error("[media-segment] video segment without publicUrl");
  }
  const fps = opts.fps ?? DEFAULT_FPS;
  const key = createHash("sha1")
    .update(videoSegmentCacheKeyPayload(opts, fps))
    .digest("hex");
  await renderCached(key, opts.outputPath, "video", (tmp) =>
    renderVideoSegmentUncached(opts, tmp, fps),
  );
}
