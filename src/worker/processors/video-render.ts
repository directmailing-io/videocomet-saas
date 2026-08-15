/**
 * Stage 1: Video render.
 *
 * Two render modes:
 *  - `webcam-only`         → the lead's video IS the campaign webcam clip
 *                            (downloaded from Bunny + re-compressed in place).
 *  - `with-presentation`   → Puppeteer scroll-captures the lead's website
 *                            into a 30 fps JPG sequence, ffmpeg encodes it
 *                            into a base MP4, and the webcam clip is overlaid
 *                            as PiP on top.
 *
 * Fallbacks for `with-presentation`:
 *  1. Website value empty / not parseable → render a "Website nicht erreichbar"
 *     placeholder page and use that as the base track.
 *  2. Puppeteer scroll-capture throws (DNS/404/timeout/hang) → same fallback
 *     placeholder. If the fallback ALSO throws (e.g. browser pool dead), we
 *     fall all the way back to a black clip so the lead still completes.
 *
 * Both flows return a single MP4 + the measured duration.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addSilentAudioTrack,
  composePip,
  concatClips,
  generateBlackClip,
  imageSeqToMp4,
  renderTextSegment,
  trimVideoToDuration,
  type PipPosition,
  type PipShape,
} from "../lib/ffmpeg";
import { compressForBunny } from "../lib/video-compress";
import {
  normaliseWebsiteUrl,
  recordCapture,
  recordFallbackPage,
  recordScroll,
} from "../lib/scroll-recorder";
import { renderPersonalizedGDocs } from "../lib/personalized-gdocs";
import {
  renderWebsiteCapture,
  renderUnreachablePlaceholder,
} from "../lib/website-render-pipeline";
import type { Segment } from "@/lib/segments/types";
import { planSegmentDurations } from "@/lib/segments/plan-durations";
import { substitute, resolveValue } from "@/lib/placeholders/substitute";
import { websiteSegmentMappingKey } from "@/lib/placeholders/website-url";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";

export interface VideoRenderInput {
  outDir: string;
  /** Campaign mode determines the render strategy. */
  mode: "webcam-only" | "with-presentation";
  /** Absolute or remote URL to the webcam clip in the mediathek. */
  webcamSourceUrl: string;
  /** Lead's target website (used for scroll-capture). */
  website?: string | null;
  /**
   * Vom Preflight verifizierte finale URL (nach Redirects, ggf. `http://`
   * wenn die Site kein TLS hat). Wird für Website-Segmente bevorzugt, wenn
   * ihr Host mit der aus den Lead-Daten aufgelösten URL übereinstimmt —
   * so landen schemalose Lead-URLs auf dem tatsächlich erreichbaren Ziel,
   * ohne Segmente mit abweichender urlColumn (z.B. Karriereseite) zu stören.
   */
  preflightFinalUrl?: string | null;
  /** PiP configuration when mode = with-presentation. */
  pip?: {
    position: PipPosition;
    shape: PipShape;
  };
  /** Defaults to 30 if we cannot probe the source. */
  defaultDurationSec?: number;
  /** Optional ordered segments for the presentation track. */
  segments?: Segment[];
  /**
   * Intro-Feature: um wieviel ms die KI-Begrüßung den Anfang des Webcam-
   * Videos getrimmt hat. Alle Sprech-Zeitpunkte liegen dadurch um diesen
   * Betrag früher — die vorderen Segmente werden um exakt denselben Betrag
   * gekürzt (kaskadierend, min 200ms pro Segment), damit spätere Segment-
   * wechsel wieder synchron zur Sprache liegen. Es wird NICHTS geschnitten,
   * nur Anzeigedauern der separat gerenderten Segment-Clips ändern sich.
   */
  introTrimMs?: number;
  /** Lead data for placeholder substitution in text segments. */
  leadData?: Record<string, string>;
  /**
   * Optionales Platzhalter-Mapping aus `runs.column_mapping.placeholderMapping`.
   * Wenn nicht vorhanden, fällt die Substitution auf das alte Verhalten zurück
   * (key === column) — siehe `substitute()` in `@/lib/placeholders/substitute`.
   */
  placeholderMapping?: PlaceholderMapping | LegacyMapping;
  /**
   * Per-lead public landing-page URL. Threaded through so the gdocs
   * personalisation can substitute `{{landingpageUrl}}` placeholders. When
   * unset, the placeholder substitution falls back to empty string.
   *
   * NOTE: in the current pipeline the landing page is created AFTER the
   * video render, so this is typically undefined here. The field is kept
   * so the upstream caller can pre-compute / re-order in a future change.
   */
  landingpageUrl?: string;
}

/**
 * Replace {{key}} placeholders in any string with values from leadData.
 * Delegiert an die zentrale `substitute()` aus `@/lib/placeholders`, damit
 * das gleiche Lookup-Verhalten wie in PDF/LP greift.
 */
function applyPlaceholders(
  s: string,
  data: Record<string, string> | undefined,
  mapping?: PlaceholderMapping | LegacyMapping,
): string {
  if (!data) return s;
  return substitute(s, data, mapping, "double-brace");
}

/**
 * Picks the first non-empty value from `data` for any candidate column,
 * case-insensitively. Mirrors the behaviour of `pickField` in
 * `pipeline.ts` so gdocs placeholder substitution sees the same auto-derived
 * `firstName` / `lastName` keys as the PDF flow.
 */
function pickFieldCI(
  data: Record<string, string>,
  candidates: readonly string[],
): string {
  for (const key of candidates) {
    const value = data[key];
    if (value && value.trim()) return value.trim();
  }
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) lower.set(k.toLowerCase(), v);
  for (const key of candidates) {
    const v = lower.get(key.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Builds the placeholder vars passed into `renderPersonalizedGDocs`.
 *
 * Mirrors `buildDocxVars` from `pipeline.ts` so the template author can use
 * the SAME placeholder names in the Google Doc as in the PDF DOCX template:
 *
 *   - any raw CSV column (`{{Firma}}`, `{{email}}`, …)
 *   - `{{landingpageUrl}}` / `{{landingpage_url}}`
 *   - `{{firstName}}` / `{{lastName}}` (case-insensitively derived from
 *     common column names like "Vorname", "first_name", …)
 *
 * Wenn ein `placeholderMapping` (neues Format) übergeben wird, kommen
 * SEINE Werte zuerst — pro Key wird die Spalte aus dem Mapping aufgelöst,
 * sodass der User in der Mapping-Stage explizit z. B. `vorname` → `Anrede`
 * legen kann.
 */
function buildGDocsVars(
  leadData: Record<string, string>,
  landingpageUrl: string | undefined,
  mapping?: PlaceholderMapping | LegacyMapping,
): Record<string, string> {
  const lpUrl = landingpageUrl ?? "";
  const firstName = pickFieldCI(leadData, [
    "firstName",
    "Vorname",
    "first_name",
    "vorname",
  ]);
  const lastName = pickFieldCI(leadData, [
    "lastName",
    "Nachname",
    "last_name",
    "nachname",
  ]);
  const base: Record<string, string> = {
    ...leadData,
    landingpageUrl: lpUrl,
    landingpage_url: lpUrl,
    firstName,
    lastName,
  };
  // Mapping-Overrides anwenden — pro Key der im Mapping steht, schreiben wir
  // den per `substitute()` aufgelösten Wert in base. So sieht der Docs-
  // Renderer (der die Vars 1:1 in `{{key}}` einsetzt) das vom User gewählte
  // Mapping ohne dass wir die Doc-Engine selbst anfassen müssen.
  if (mapping) {
    for (const key of Object.keys(extractMappingKeys(mapping))) {
      const v = substitute(`{{${key}}}`, leadData, mapping, "double-brace");
      if (v) base[key] = v;
    }
  }
  return base;
}

/** Liefert die im Mapping enthaltenen Keys, unabhängig vom Format. */
function extractMappingKeys(
  mapping: PlaceholderMapping | LegacyMapping,
): Record<string, true> {
  const out: Record<string, true> = {};
  for (const k of Object.keys(mapping)) out[k] = true;
  return out;
}

export interface VideoRenderOutput {
  videoFilePath: string;
  durationSec: number;
}

/**
 * Lädt eine Media-URL auf Disk. Exportiert für media-segment-render.ts
 * (Studio-Bild/Video-Segmente) — die Bunny-Stream-HLS-Auflösung (beste
 * MP4-Variante statt playlist.m3u8) soll es nur einmal geben.
 */
export async function fetchToFile(url: string, outPath: string): Promise<void> {
  if (url.startsWith("file://")) {
    return; // Already on local disk; caller handles this branch.
  }

  // Bunny CDN blockt requests ohne Referer (Hotlink-Protection in der
  // Library). APP_URL als Referer reicht — die Allowlist hat
  // `app.videocomet.de` drin.
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const baseHeaders = {
    Referer: referer,
    Origin: referer,
    "User-Agent": "videocomet-worker/1.0",
  };

  // Bunny-Stream-HLS: wir koennen ffmpeg nicht direkt eine playlist.m3u8
  // geben (HTTP-Range-Seeks brauchen ein einzelnes Asset). Wir holen die
  // beste verfuegbare MP4-Variante via Library-API — hardcoded
  // `play_720p.mp4` knallt bei Videos, deren Source-Aufloesung kleiner als
  // 720p ist (z.B. 404×720 Portrait), weil Bunny KEINE Upscale-Variante
  // ausspielt.
  const hlsMatch = url.match(
    /^https?:\/\/([^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i,
  );
  if (hlsMatch) {
    const cdnHostname = hlsMatch[1];
    const guid = hlsMatch[2];
    let candidates: { url: string; label: string }[] = [];
    try {
      const { getVideoDownloadUrls } = await import("@/lib/bunny/stream");
      candidates = await getVideoDownloadUrls(guid, cdnHostname);
    } catch (err) {
      // API-Call-Failure → wir versuchen wenigstens die alten Konventionen.
      // eslint-disable-next-line no-console
      console.warn(
        `[render] bunny meta lookup failed for ${guid}: ${
          (err as Error).message
        } — falling back to fixed resolutions`,
      );
    }
    if (candidates.length === 0) {
      // Fallback-Reihenfolge: hoechste zuerst, dann Original.
      const base = `https://${cdnHostname}/${guid}`;
      candidates = [
        { url: `${base}/play_1080p.mp4`, label: "1080p" },
        { url: `${base}/play_720p.mp4`, label: "720p" },
        { url: `${base}/play_480p.mp4`, label: "480p" },
        { url: `${base}/play_360p.mp4`, label: "360p" },
        { url: `${base}/play_240p.mp4`, label: "240p" },
        { url: `${base}/original`, label: "original" },
      ];
    }

    let lastErr: string | null = null;
    for (const c of candidates) {
      const res = await fetch(c.url, { headers: baseHeaders });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(outPath, buf);
        return;
      }
      lastErr = `${res.status} ${c.label}`;
    }
    throw new Error(
      `[render] webcam fetch failed for all variants (${candidates.length}): ${lastErr} ${url}`,
    );
  }

  // Nicht-HLS: direkt fetchen (Bunny Storage / Webcam-Recording).
  const res = await fetch(url, { headers: baseHeaders });
  if (!res.ok) {
    throw new Error(
      `[render] webcam fetch ${res.status} ${url} (referer=${referer})`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
}

/**
 * Drives the Puppeteer scroll-capture and ffmpeg encode that produces the
 * "base" presentation track. Returns the absolute path to a 1280x720 MP4.
 *
 * Failure handling is layered:
 *   1. URL not usable → placeholder page MP4.
 *   2. Scroll-capture throws → placeholder page MP4.
 *   3. Placeholder page ALSO throws → black clip (so the pipeline never gets
 *      stuck on a bad website + a missing browser).
 */
/** Host einer URL ohne `www.`-Präfix — für den "gleiche Site?"-Vergleich. */
function comparableHost(u: string): string | null {
  try {
    let h = new URL(u).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

async function renderPresentationBase(opts: {
  website: string | null | undefined;
  outDir: string;
  basePath: string;
  durationSec: number;
}): Promise<void> {
  const durationMs = Math.max(1, opts.durationSec * 1000);
  const url = normaliseWebsiteUrl(opts.website);

  // Helper: take a frames-dir result and encode it to opts.basePath.
  const encode = async (framesDir: string, fps: number) => {
    await imageSeqToMp4({
      framesDir,
      outputPath: opts.basePath,
      fps,
    });
  };

  const fallbackToPlaceholder = async (reason: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[render] scroll-capture fallback → placeholder: ${reason}`);
    try {
      const fb = await recordFallbackPage({
        outputDir: opts.outDir,
        durationMs,
        websiteLabel: opts.website?.toString() ?? "(keine Website angegeben)",
      });
      await encode(fb.framesDir, fb.fps);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[render] placeholder page failed: ${(e as Error).message}`);
      return false;
    }
  };

  const fallbackToBlackClip = async () => {
    // eslint-disable-next-line no-console
    console.warn(`[render] falling back to black clip`);
    await generateBlackClip({
      outputPath: opts.basePath,
      durationSec: opts.durationSec,
    });
  };

  if (!url) {
    if (await fallbackToPlaceholder("invalid or empty website value")) return;
    await fallbackToBlackClip();
    return;
  }

  // Stage A: scroll-capture (browser open + page goto + N screenshots).
  let framesResult;
  try {
    framesResult = await recordScroll({
      url,
      outputDir: opts.outDir,
      durationMs,
    });
  } catch (e) {
    if (await fallbackToPlaceholder((e as Error).message)) return;
    await fallbackToBlackClip();
    return;
  }

  // Stage B: encode frames → MP4.
  try {
    await encode(framesResult.framesDir, framesResult.fps);
  } catch (e) {
    if (await fallbackToPlaceholder(`encode failed: ${(e as Error).message}`)) return;
    await fallbackToBlackClip();
  }
}

/**
 * Prozessweiter Webcam-Normalize-Cache (M1, Perf-Paket 2026-07-21).
 *
 * Problem: bei with-presentation-Kampagnen lädt + re-encodiert JEDER Lead
 * dieselbe Webcam-Quelle (Browser-Recorder liefert VP8/WebM → libx264-
 * Re-Encode ~56s unter Contention). Bei 5 parallelen Leads: 5× dieselbe
 * Arbeit, die Encodes verlangsamen sich gegenseitig.
 *
 * Der Cache dedupliziert per URL (neue Aufnahme = neue UUID-CDN-URL, der
 * Key ist also inhaltsstabil): der erste Caller lädt + normalisiert, alle
 * anderen teilen die Promise. Downstream (probe/composePip) liest die
 * Cache-Datei nur — cleanupTempDir räumt nur per-Lead-Dirs, nie den Cache.
 *
 * Sicherheit: atomar via .tmp + rename, rejected Promises werden evicted,
 * Disk-Hits (Worker-Restart) werden per ffprobe validiert, TTL-Sweep >2h
 * (mtime wird bei jedem Hit getouched). Nur für http(s)-Quellen —
 * file://-Pfade sind lokale per-Run-Dateien ohne stabile Identität.
 */
const WEBCAM_CACHE_DIR = "/tmp/videocomet-webcam-cache";
const WEBCAM_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const WEBCAM_NORMALIZE_CACHE = new Map<string, Promise<string>>();

async function sweepWebcamCache(): Promise<void> {
  try {
    const entries = await readdir(WEBCAM_CACHE_DIR);
    const now = Date.now();
    for (const name of entries) {
      const p = join(WEBCAM_CACHE_DIR, name);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > WEBCAM_CACHE_TTL_MS) {
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

async function normalizeWebcamCached(url: string): Promise<string> {
  const key = createHash("sha1").update(url).digest("hex");
  const target = join(WEBCAM_CACHE_DIR, `${key}.mp4`);

  const existing = WEBCAM_NORMALIZE_CACHE.get(key);
  if (existing) {
    try {
      const p = await existing;
      if (existsSync(p)) {
        // mtime touchen, damit der TTL-Sweep aktive Einträge nicht killt.
        const now = new Date();
        await utimes(p, now, now).catch(() => {});
        console.log(`[render] webcam normalize cache hit (${key.slice(0, 8)})`);
        return p;
      }
    } catch {
      // rejected — unten frisch aufbauen
    }
    WEBCAM_NORMALIZE_CACHE.delete(key);
  }

  const job = (async () => {
    await mkdir(WEBCAM_CACHE_DIR, { recursive: true });
    void sweepWebcamCache();

    if (existsSync(target)) {
      // Disk-Hit ohne Memory-Eintrag (z.B. nach Worker-Restart) — nicht
      // blind vertrauen: könnte ein Torso eines gekillten Prozesses sein.
      try {
        const { probeVideoDuration } = await import("../../lib/ffprobe");
        const d = await probeVideoDuration(target);
        if (typeof d === "number" && d > 0) {
          const now = new Date();
          await utimes(target, now, now).catch(() => {});
          console.log(
            `[render] webcam normalize cache hit from disk (${key.slice(0, 8)})`,
          );
          return target;
        }
      } catch {
        // invalide — neu aufbauen
      }
      await rm(target, { force: true }).catch(() => {});
    }

    const suffix = `${process.pid}.${Date.now()}`;
    const rawTmp = join(WEBCAM_CACHE_DIR, `${key}.raw.${suffix}`);
    const normTmp = `${target}.tmp.${suffix}`;
    try {
      await fetchToFile(url, rawTmp);
      const res = await compressForBunny({
        inputPath: rawTmp,
        outputPath: normTmp,
        reason: "webcam-source-normalize",
      });
      await rename(normTmp, target); // atomar (gleiches FS)
      console.log(
        `[render] webcam normalised+cached: ${res.skipped ? "passthrough" : "re-encode"} (${res.orientation}, ${(res.bytesIn / 1024 / 1024).toFixed(2)}MB → ${(res.bytesOut / 1024 / 1024).toFixed(2)}MB)`,
      );
      return target;
    } finally {
      await rm(rawTmp, { force: true }).catch(() => {});
      await rm(normTmp, { force: true }).catch(() => {});
    }
  })();

  WEBCAM_NORMALIZE_CACHE.set(key, job);
  job.catch(() => WEBCAM_NORMALIZE_CACHE.delete(key));
  return job;
}

/**
 * Produces a final MP4 in `outDir` and returns its path and duration.
 */
export async function runVideoRender(
  input: VideoRenderInput,
): Promise<VideoRenderOutput> {
  const finalPath = join(input.outDir, "final.mp4");

  // Materialise + normalise the webcam source.
  //
  // Orientation-aware compress: portrait sources (z. B. 720×1280 Selfie)
  // sollen NICHT auf 1280×720 ge-pillarboxt werden. compressForBunny erkennt
  // die Source-Orientation selbst aus den Pixel-Dimensionen und wählt den
  // passenden Cap (landscape→1280×720, portrait→720×1280, square→720×720).
  // KEIN Upscale + KEIN Letterbox — die Scale-Formel ist `min(in,out)`.
  // Bei H.264-Webcams läuft `-c copy` und spart Encode-Zeit; Re-Encode nur
  // wenn nötig (Codec/Profile/Bitrate jenseits der Skip-Heuristik).
  //
  // http(s)-Quellen laufen über den prozessweiten Normalize-Cache (M1) —
  // parallele Leads derselben Kampagne teilen Download + Re-Encode.
  let webcamLocal: string;
  if (input.webcamSourceUrl.startsWith("file://")) {
    const rawPath = input.webcamSourceUrl.replace(/^file:\/\//, "");
    if (!existsSync(rawPath)) {
      throw new Error(`[render] webcam source missing: ${rawPath}`);
    }
    webcamLocal = join(input.outDir, "webcam-src.mp4");
    const compressResult = await compressForBunny({
      inputPath: rawPath,
      outputPath: webcamLocal,
      reason: "webcam-source-normalize",
    });
    console.log(
      `[render] webcam normalised: ${compressResult.skipped ? "passthrough" : "re-encode"} (${compressResult.orientation}, ${(compressResult.bytesIn / 1024 / 1024).toFixed(2)}MB → ${(compressResult.bytesOut / 1024 / 1024).toFixed(2)}MB)`,
    );
  } else {
    webcamLocal = await normalizeWebcamCached(input.webcamSourceUrl);
  }

  // KRITISCH: die wahre Webcam-Dauer aus der normalisierten Source messen.
  // Wenn `defaultDurationSec` aus der DB NULL ist, fiel der alte Code auf
  // 30s zurück — Segmente wurden auf 30s aufgebaut, das finale Video war
  // länger als die Webcam (Prod-Bug 2026-06-03: 6s-Webcam → 22s-Output).
  // Wir messen JETZT immer aus der Quelle und nehmen den kleineren von
  // (DB-Wert, gemessen). Floor 0.5s damit ein Mess-Glitch nicht das ganze
  // Render killt.
  const { probeVideoDuration } = await import("../../lib/ffprobe");
  const probedSec = await probeVideoDuration(webcamLocal);
  const dbSec = input.defaultDurationSec ?? null;
  const candidates = [probedSec, dbSec].filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  const webcamSec =
    candidates.length > 0
      ? Math.max(0.5, Math.min(...candidates))
      : input.defaultDurationSec ?? 30;
  console.log(
    `[render] webcam duration probed=${probedSec ?? "n/a"} db=${dbSec ?? "n/a"} → effective=${webcamSec}s`,
  );
  const duration = webcamSec;

  if (input.mode === "webcam-only") {
    // Webcam IS the final clip.
    return { videoFilePath: webcamLocal, durationSec: duration };
  }

  // with-presentation: build a base track. If the campaign has segments,
  // render each one and concat them; otherwise fall back to the legacy
  // scroll-capture / placeholder flow.
  const basePath = join(input.outDir, "base.mp4");
  if (input.segments && input.segments.length > 0) {
    await renderSegmentsBase({
      segments: input.segments,
      leadData: input.leadData,
      placeholderMapping: input.placeholderMapping,
      landingpageUrl: input.landingpageUrl,
      outDir: input.outDir,
      basePath,
      fallbackWebsite: input.website ?? null,
      preflightFinalUrl: input.preflightFinalUrl ?? null,
      totalDurationSec: duration,
      introTrimMs: input.introTrimMs ?? 0,
    });
  } else {
    await renderPresentationBase({
      // Legacy-Pfad zeigt immer die Haupt-Website des Leads — die vom
      // Preflight verifizierte finale URL ist hier die verlässlichste Quelle.
      website: input.preflightFinalUrl ?? input.website ?? null,
      outDir: input.outDir,
      basePath,
      durationSec: duration,
    });
  }

  // Studio-Video-Segmente mit Wiedergabefenstern bringen Original-Ton auf
  // der Base-Spur mit → beide Tonspuren mischen statt nur Webcam-Audio.
  const mixBaseAudio = (input.segments ?? []).some(
    (s) => s.kind === "video" && (s.playbackWindows?.length ?? 0) > 0,
  );

  await composePip({
    basePath,
    webcamPath: webcamLocal,
    outputPath: finalPath,
    position: input.pip?.position ?? "right",
    shape: input.pip?.shape ?? "rounded",
    durationSec: duration,
    mixBaseAudio,
  });

  // Final-Trim als Safety-Net: auch wenn composePip's -t schon greift,
  // re-probe wir das Output. Wenn es trotz allem zu lang ist (Codec-
  // Glitch, falsche concat-Dauer …) trimmen wir hart auf `duration`.
  const finalProbed = await probeVideoDuration(finalPath);
  if (finalProbed !== null && finalProbed > duration + 0.5) {
    console.warn(
      `[render] final video ${finalProbed}s exceeds cap ${duration}s → trimming`,
    );
    const trimmedPath = join(input.outDir, "final-trimmed.mp4");
    await trimVideoToDuration({
      inputPath: finalPath,
      outputPath: trimmedPath,
      durationSec: duration,
    });
    return { videoFilePath: trimmedPath, durationSec: duration };
  }

  return { videoFilePath: finalPath, durationSec: duration };
}

/**
 * Renders each segment to its own MP4, then concatenates them into a single
 * `basePath`. Currently supports text segments fully; other types fall back
 * to a labeled black clip so the lead still completes.
 *
 * v2 TODOs: image (image overlay), video (re-encode + trim), website (scroll
 * capture for the per-segment duration), gdocs (live doc fetch + capture).
 */
async function renderSegmentsBase(opts: {
  segments: Segment[];
  leadData?: Record<string, string>;
  placeholderMapping?: PlaceholderMapping | LegacyMapping;
  landingpageUrl?: string;
  outDir: string;
  basePath: string;
  fallbackWebsite: string | null;
  preflightFinalUrl?: string | null;
  totalDurationSec: number;
  introTrimMs?: number;
}): Promise<void> {
  // Intro-Kompensation (vordere Segmente um introTrimMs kürzen, damit
  // Segmentwechsel synchron zur früher liegenden Sprache bleiben) +
  // Budget-Clamp auf die Webcam-Dauer — Logik + Doku in planSegmentDurations.
  const plan = planSegmentDurations(
    opts.segments,
    opts.totalDurationSec,
    opts.introTrimMs ?? 0,
  );
  const clampedSegments = plan.planned;
  if (plan.absorbedTrimMs > 0 || plan.unabsorbedTrimMs > 0) {
    console.log(
      `[render] intro compensation: shortened leading segments by ${plan.absorbedTrimMs}ms (requested=${plan.absorbedTrimMs + plan.unabsorbedTrimMs}ms)`,
    );
  }
  if (plan.extendedLeadMs > 0) {
    console.log(
      `[render] intro compensation: extended first segment by ${plan.extendedLeadMs}ms (intro lengthened the video start)`,
    );
  }
  if (plan.unabsorbedTrimMs > 0) {
    console.warn(
      `[render] intro compensation incomplete: ${plan.unabsorbedTrimMs}ms could not be absorbed (all segments at 200ms floor) — trailing segments will be truncated by the budget clamp`,
    );
  }
  if (clampedSegments.length !== opts.segments.length) {
    console.warn(
      `[render] segments clamped: ${opts.segments.length} → ${clampedSegments.length} (budget=${opts.totalDurationSec}s)`,
    );
  }

  const parts: string[] = [];
  for (let i = 0; i < clampedSegments.length; i++) {
    const { seg, durationMs: clampedMs } = clampedSegments[i];
    const partPath = join(opts.outDir, `seg-${i}.mp4`);
    const durationMs = clampedMs;

    try {
      if (seg.kind === "text") {
        await renderTextSegment({
          text: applyPlaceholders(
            seg.text,
            opts.leadData,
            opts.placeholderMapping,
          ),
          bgColor: seg.bgColor,
          textColor: seg.textColor,
          fontSize: seg.fontSize,
          textAlign: seg.textAlign,
          fontWeight: seg.fontWeight,
          italic: seg.italic,
          durationMs,
          outputPath: partPath,
        });
      } else if (seg.kind === "website") {
        // Website-Segment: Lead-URL über das Run-Mapping auflösen (Spalte
        // wird im Mapping-Schritt des Wizards zugewiesen; Key = urlColumn
        // oder "website"). resolveValue fällt ohne Mapping-Eintrag auf den
        // direkten CI-Lookup in leadData zurück (= altes Verhalten), danach
        // generische Top-Level-URL, danach statische seg.fallbackUrl.
        // personalized === false: feste Webseite (Studio „Eigene Webseite")
        // — immer fallbackUrl, Lead-Daten spielen keine Rolle.
        const fixed = seg.personalized === false;
        const mappingKey = websiteSegmentMappingKey(seg);
        const fromLead =
          !fixed && opts.leadData
            ? resolveValue(mappingKey, opts.leadData, opts.placeholderMapping)
            : null;
        const leadUrl = fixed
          ? normaliseWebsiteUrl(seg.fallbackUrl) ?? null
          : normaliseWebsiteUrl(fromLead) ??
            normaliseWebsiteUrl(opts.fallbackWebsite) ??
            normaliseWebsiteUrl(seg.fallbackUrl) ??
            null;
        // Preflight-verifizierte URL bevorzugen, wenn sie zur selben Site
        // gehört: deckt http-only-Domains und www-Redirects ab, ohne
        // Segmente mit anderer urlColumn (z.B. Karriereseite) umzubiegen.
        const probed = !fixed
          ? normaliseWebsiteUrl(opts.preflightFinalUrl ?? null) ?? null
          : null;
        const url =
          probed && leadUrl && comparableHost(probed) === comparableHost(leadUrl)
            ? probed
            : leadUrl;
        if (!url) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          // Sharp-basierte Pipeline mit Browser-Chrome-Overlay — sieht aus
          // wie eine echte Bildschirm-Aufnahme. Fallback auf
          // recordFallbackPage wenn die Site z.B. nicht laedt.
          try {
            const fr = await renderWebsiteCapture({
              url,
              outputDir: join(opts.outDir, `web-${i}`),
              durationMs,
              mode: seg.captureMode ?? "static-hero",
              scrollFrames: seg.scrollFrames,
            });
            await imageSeqToMp4({
              framesDir: fr.framesDir,
              outputPath: partPath,
              fps: fr.fps,
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[render] website capture failed for ${url} → placeholder:`,
              err instanceof Error ? err.message : err,
            );
            // Pure-sharp Placeholder (kein Puppeteer) — verhindert
            // 5-min Hard-Timeout wenn der Browser-Pool deadlocked ist.
            const fb = await renderUnreachablePlaceholder({
              url,
              outputDir: join(opts.outDir, `web-${i}`),
              durationMs,
            });
            await imageSeqToMp4({
              framesDir: fb.framesDir,
              outputPath: partPath,
              fps: fb.fps,
            });
          }
        }
      } else if (seg.kind === "gdocs") {
        // Google-Docs-Segment: NICHT die Live-URL capturen — sonst zeigt das
        // Video die Google-Chrome UI, Cookie-Banner und (entscheidend) die
        // `{{placeholders}}` im Dokument bleiben unersetzt. Stattdessen: Doc
        // als HTML exportieren, Placeholder substituieren, in Puppeteer per
        // `file://` rendern und capturen.
        if (!seg.docsUrl || !seg.docsUrl.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const vars = buildGDocsVars(
            opts.leadData ?? {},
            opts.landingpageUrl,
            opts.placeholderMapping,
          );
          const gdocsOutDir = join(opts.outDir, `gdocs-${i}`);
          try {
            const fr = await renderPersonalizedGDocs({
              docsUrl: seg.docsUrl,
              vars,
              outputDir: gdocsOutDir,
              durationMs,
              mode: seg.captureMode ?? "static-hero",
              scrollFrames: seg.scrollFrames,
            });
            await imageSeqToMp4({
              framesDir: fr.framesDir,
              outputPath: partPath,
              fps: fr.fps,
            });
          } catch (e) {
            // Same defensive fallback as the website branch: render a
            // labelled placeholder so the lead still completes.
            // eslint-disable-next-line no-console
            console.warn(
              `[render] gdocs personalised capture failed → placeholder: ${(e as Error).message}`,
            );
            const fb = await recordFallbackPage({
              outputDir: gdocsOutDir,
              durationMs,
              websiteLabel: seg.docsUrl,
            });
            await imageSeqToMp4({
              framesDir: fb.framesDir,
              outputPath: partPath,
              fps: fb.fps,
            });
          }
        }
      } else if (seg.kind === "slide") {
        const { renderSlideToMp4 } = await import("../lib/slide-renderer");
        await renderSlideToMp4({
          slide: seg,
          leadData: opts.leadData ?? {},
          durationMs,
          outputDir: join(opts.outDir, `slide-${i}`),
          outputPath: partPath,
        });
      } else if (seg.kind === "gslide") {
        // Google-Slides-Segment: pubembed-URL → Puppeteer → DOM-Substitute
        // → Screenshot → MP4. Crasht der Pubembed-Load (z. B. weil der
        // User die Veröffentlichung zurückgezogen hat), fängt der catch
        // weiter unten und liefert einen Black-Clip.
        if (!seg.publishedUrl?.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const { renderGSlideToMp4 } = await import("../lib/gslide-render");
          await renderGSlideToMp4({
            slide: seg,
            leadData: opts.leadData ?? {},
            mapping: opts.placeholderMapping,
            durationMs,
            outputDir: join(opts.outDir, `gslide-${i}`),
            outputPath: partPath,
          });
        }
      } else if (seg.kind === "canva") {
        // Canva-Segment: vom User hochgeladenes PPTX → Bunny-CDN-Fetch
        // (mit Cache) → Substitution → LibreOffice → MP4. Pipeline ist
        // 1:1 der gslide-Edit-Mode-Pfad. Crasht der Fetch oder
        // LibreOffice, fängt der catch weiter unten und liefert einen
        // Black-Clip.
        if (!seg.pptxPublicUrl?.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const { renderCanvaSlideToMp4 } = await import("../lib/canva-render");
          await renderCanvaSlideToMp4({
            segment: seg,
            leadData: opts.leadData ?? {},
            mapping: opts.placeholderMapping,
            durationMs,
            outputDir: join(opts.outDir, `canva-${i}`),
            outputPath: partPath,
          });
        }
      } else if (seg.kind === "pdf") {
        // PDF-Segment: NICHT personalisiert — das hochgeladene PDF wird im
        // Drive-Viewer-Look (dunkle Toolbar + Seiten-Stack auf grauem
        // Grund) durchgescrollt. Der Renderer rastert das Original-PDF
        // selbst neu (pdftoppm, 150 dpi — identisch zur Editor-Vorschau)
        // und cached das fertige MP4 prozessweit, weil das Ergebnis für
        // alle Leads einer Kampagne identisch ist.
        if (!seg.pdfUrl?.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          console.log(
            `[render] pdf segment ${seg.id}: "${seg.fileName}" (${seg.pageCount} Seiten, mode=${seg.captureMode})`,
          );
          const { renderPdfSegment } = await import("../lib/pdf-segment-render");
          await renderPdfSegment({
            segment: seg,
            durationMs,
            outputDir: join(opts.outDir, `pdf-${i}`),
            outputPath: partPath,
          });
        }
      } else if (seg.kind === "image") {
        // Bild-Segment (Studio): statisches Bild, contain auf dunklem
        // Bühnen-Grund — für alle Leads identisch, prozessweit gecached.
        if (!seg.publicUrl?.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const { renderImageSegment } = await import(
            "../lib/media-segment-render"
          );
          await renderImageSegment({
            segment: seg,
            durationMs,
            outputDir: join(opts.outDir, `img-${i}`),
            outputPath: partPath,
          });
        }
      } else if (seg.kind === "video") {
        // Video-Segment (Studio): Poster-Standbild + Play-Abschnitte exakt
        // in den Wiedergabefenstern (playbackWindows) inkl. Original-Ton.
        // Ohne Fenster: Poster-Still über die gesamte Segmentdauer.
        if (!seg.publicUrl?.trim()) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const { renderVideoSegment } = await import(
            "../lib/media-segment-render"
          );
          await renderVideoSegment({
            segment: seg,
            durationMs,
            outputDir: join(opts.outDir, `vid-${i}`),
            outputPath: partPath,
          });
        }
      } else {
        // Unbekannter Segment-Typ — black clip placeholder.
        console.warn(
          `[render] segment kind=${(seg as Segment).kind} not supported — using placeholder`,
        );
        await generateBlackClip({
          outputPath: partPath,
          durationSec: durationMs / 1000,
        });
      }
      parts.push(partPath);
    } catch (e) {
      console.error(
        `[render] segment ${i} (${seg.kind}) failed; using black clip:`,
        e instanceof Error ? e.message : e,
      );
      await generateBlackClip({
        outputPath: partPath,
        durationSec: durationMs / 1000,
      });
      parts.push(partPath);
    }
  }

  // Wenn ein Studio-Video-Segment Original-Ton mitbringt (mixBaseAudio in
  // composePip), muss die Base-Audio-Timeline exakt sein: der concat-Demuxer
  // (`-c copy`) braucht dafür in JEDEM Teil eine Audio-Spur — Website-/
  // GDocs-Clips aus imageSeqToMp4 haben keine → stille AAC-Spur nachrüsten.
  const needsBaseAudio = opts.segments.some(
    (s) => s.kind === "video" && (s.playbackWindows?.length ?? 0) > 0,
  );
  if (needsBaseAudio && parts.length > 1) {
    const { probeHasAudioStream } = await import("../../lib/ffprobe");
    for (let i = 0; i < parts.length; i++) {
      if (await probeHasAudioStream(parts[i])) continue;
      const fixedPath = parts[i].replace(/\.mp4$/, "-audio.mp4");
      try {
        await addSilentAudioTrack({
          inputPath: parts[i],
          outputPath: fixedPath,
        });
        parts[i] = fixedPath;
      } catch (e) {
        console.warn(
          `[render] silent-audio remux failed for part ${i} — base audio may drift:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  if (parts.length === 0) {
    await generateBlackClip({
      outputPath: opts.basePath,
      durationSec: opts.totalDurationSec,
    });
    return;
  }

  if (parts.length === 1) {
    // Single segment: just rename / copy.
    await (await import("node:fs/promises")).copyFile(parts[0], opts.basePath);
    return;
  }

  await concatClips({
    inputPaths: parts,
    outputPath: opts.basePath,
    workDir: opts.outDir,
    maxDurationSec: opts.totalDurationSec,
  });
}
