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
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
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
import { substitute } from "@/lib/placeholders/substitute";
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
  /** PiP configuration when mode = with-presentation. */
  pip?: {
    position: PipPosition;
    shape: PipShape;
  };
  /** Defaults to 30 if we cannot probe the source. */
  defaultDurationSec?: number;
  /** Optional ordered segments for the presentation track. */
  segments?: Segment[];
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

async function fetchToFile(url: string, outPath: string): Promise<void> {
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
 * Produces a final MP4 in `outDir` and returns its path and duration.
 */
export async function runVideoRender(
  input: VideoRenderInput,
): Promise<VideoRenderOutput> {
  const finalPath = join(input.outDir, "final.mp4");

  // Materialise the webcam source on disk first.
  const webcamLocal = join(input.outDir, "webcam-src.mp4");
  const rawPath = (() => {
    if (input.webcamSourceUrl.startsWith("file://")) {
      return input.webcamSourceUrl.replace(/^file:\/\//, "");
    }
    return null;
  })();
  let sourcePath: string;
  if (rawPath) {
    if (!existsSync(rawPath)) {
      throw new Error(`[render] webcam source missing: ${rawPath}`);
    }
    sourcePath = rawPath;
  } else {
    const raw = join(input.outDir, "webcam-raw");
    await fetchToFile(input.webcamSourceUrl, raw);
    sourcePath = raw;
  }

  // Orientation-aware compress: portrait sources (z. B. 720×1280 Selfie)
  // sollen NICHT auf 1280×720 ge-pillarboxt werden. compressForBunny erkennt
  // die Source-Orientation selbst aus den Pixel-Dimensionen und wählt den
  // passenden Cap (landscape→1280×720, portrait→720×1280, square→720×720).
  // KEIN Upscale + KEIN Letterbox — die Scale-Formel ist `min(in,out)`.
  // Bei H.264-Webcams läuft `-c copy` und spart Encode-Zeit; Re-Encode nur
  // wenn nötig (Codec/Profile/Bitrate jenseits der Skip-Heuristik).
  const compressResult = await compressForBunny({
    inputPath: sourcePath,
    outputPath: webcamLocal,
    reason: "webcam-source-normalize",
  });
  console.log(
    `[render] webcam normalised: ${compressResult.skipped ? "passthrough" : "re-encode"} (${compressResult.orientation}, ${(compressResult.bytesIn / 1024 / 1024).toFixed(2)}MB → ${(compressResult.bytesOut / 1024 / 1024).toFixed(2)}MB)`,
  );

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
      totalDurationSec: duration,
    });
  } else {
    await renderPresentationBase({
      website: input.website ?? null,
      outDir: input.outDir,
      basePath,
      durationSec: duration,
    });
  }

  await composePip({
    basePath,
    webcamPath: webcamLocal,
    outputPath: finalPath,
    position: input.pip?.position ?? "right",
    shape: input.pip?.shape ?? "rounded",
    durationSec: duration,
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
  totalDurationSec: number;
}): Promise<void> {
  // Hart auf die Webcam-Dauer clampen: Segmente, die nicht mehr in das
  // Webcam-Budget passen, werden komplett verworfen — das letzte Segment
  // das noch passt wird gekürzt. Schützt vor falsch konfigurierten
  // Wizard-State und vor zu-langen-Slides.
  const totalBudgetMs = Math.max(200, Math.round(opts.totalDurationSec * 1000));
  const clampedSegments: Array<{ seg: Segment; durationMs: number }> = [];
  let consumedMs = 0;
  for (const seg of opts.segments) {
    if (consumedMs >= totalBudgetMs) break;
    const requested = Math.max(200, seg.durationMs);
    const remaining = totalBudgetMs - consumedMs;
    const granted = Math.min(requested, remaining);
    if (granted < 200) break;
    clampedSegments.push({ seg, durationMs: granted });
    consumedMs += granted;
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
        // Website-Segment: Lead-URL aus der CSV-Spalte (urlColumn), sonst
        // generische Top-Level-URL, sonst statische seg.fallbackUrl.
        const colKey = seg.urlColumn?.trim();
        const fromCsv =
          colKey && opts.leadData
            ? pickFieldCI(opts.leadData, [colKey])
            : null;
        const url =
          normaliseWebsiteUrl(fromCsv) ??
          normaliseWebsiteUrl(opts.fallbackWebsite) ??
          normaliseWebsiteUrl(seg.fallbackUrl) ??
          null;
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
      } else {
        // image / video not yet rendered in v1 — black clip placeholder.
        console.warn(
          `[render] segment kind=${seg.kind} not yet supported in v1 — using placeholder`,
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
