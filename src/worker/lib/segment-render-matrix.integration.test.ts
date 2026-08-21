/**
 * Regressions-Testmatrix über ALLE Segment-Typen (SegmentKind) — prüft den
 * TATSÄCHLICHEN Render-Output (Dauer, Bildinhalt nicht schwarz, Audio),
 * nicht nur Exit-Codes. Hintergrund: Prod-Bugs 2026-08 (KI-Intro-Snapshot
 * bei Regenerate, Video-Segment-Lautstärke im Render ignoriert).
 *
 * Matrix:
 *   ECHT gerendert + Output-geprüft (lokal, ohne externes Netz — Fixtures
 *   kommen aus einem test-eigenen node:http-Server):
 *     - text   (ffmpeg drawtext; braucht drawtext-Filter + DejaVu-Font des
 *               Worker-Images — auf macOS-Dev-Maschinen wird der Test
 *               deshalb zur Laufzeit geskippt, im Debian-Worker läuft er)
 *     - image  (media-segment-render → sharp + ffmpeg Still-MP4)
 *     - video  (media-segment-render → Stückliste + volume-Filter;
 *               inkl. Volume-Regression zum Incident 2026-08-21)
 *     - slide  (slide-renderer → React-SSR + Puppeteer file://-Screenshot,
 *               kein externes Netz solange keine Google-Fonts gesetzt sind)
 *     - pdf    (pdf-segment-render → pdftoppm + Puppeteer file:// mit
 *               Request-Interception, die alles außer file:/data: blockt)
 *
 *   NUR Plan-/Geometrie-Ebene (pure Funktionen):
 *     - website, gdocs (echter Render braucht Live-Netz/Google)
 *     - gslide, canva  (echter Render braucht Google-PPTX-Download bzw.
 *                       LibreOffice-headless-Pipeline)
 *
 * Guards: Ohne ffmpeg/ffprobe (CI) wird die komplette Render-Matrix
 * geskippt — die puren Plan-Tests laufen immer.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ffmpeg/ffprobe/pdftoppm-Pfade MÜSSEN vor dem Laden der Worker-Module in
 * process.env stehen: `src/lib/ffprobe.ts` liest FFPROBE_PATH/FFMPEG_PATH
 * zur MODUL-LADEZEIT (Zeile 21/22), `src/worker/lib/ffmpeg.ts` und
 * `pdf-to-image.ts` zur Call-Zeit. vi.hoisted läuft vor allen statischen
 * Imports dieses Files (synchron, daher ohne fs — die Existenz-Guards
 * greifen unten via existsSync und skippen die Suite sauber, wenn die
 * Binaries fehlen).
 */
const BIN = vi.hoisted(() => {
  const isMac = process.platform === "darwin";
  const def = (name: string) =>
    isMac ? `/opt/homebrew/bin/${name}` : `/usr/bin/${name}`;
  const pick = (envVal: string | undefined, name: string): string =>
    envVal && envVal.trim().length > 0 ? envVal : def(name);
  const ffmpeg = pick(process.env.FFMPEG_PATH, "ffmpeg");
  const ffprobe = pick(process.env.FFPROBE_PATH, "ffprobe");
  const pdftoppm = pick(process.env.PDFTOPPM_PATH, "pdftoppm");
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;
  process.env.PDFTOPPM_PATH = pdftoppm;
  return { ffmpeg, ffprobe, pdftoppm };
});

import sharp from "sharp";
import { executablePath as puppeteerExecutablePath } from "puppeteer";
import type {
  ImageSegment,
  PdfSegment,
  SlideSegment,
  VideoSegment,
} from "@/lib/segments/types";
import { interpolateScrollRatio } from "@/lib/segments/scroll-math";
import {
  isEditMode,
  parsePublishedSlidesUrl,
} from "@/lib/gslides/validate-url";
import { probeHasAudioStream, probeVideoDuration } from "@/lib/ffprobe";
import { renderTextSegment } from "./ffmpeg";
import {
  renderImageSegment,
  renderVideoSegment,
} from "./media-segment-render";
import {
  buildPdfViewerHtml,
  PDF_TOOLBAR_HEIGHT_PX,
} from "./pdf-viewer-html";
import { closeBrowserPool } from "./browser-pool";

/* -------------------------------------------------------------------------- */
/* Umgebungs-Guards                                                            */
/* -------------------------------------------------------------------------- */

// vitest.config.ts lässt src/worker-Tests in BEIDEN Projekten (node + jsdom)
// laufen — die schweren Renders sollen nur einmal (node) laufen.
const IS_JSDOM = typeof document !== "undefined";
const HAS_FFMPEG = existsSync(BIN.ffmpeg) && existsSync(BIN.ffprobe);
const RUN = HAS_FFMPEG && !IS_JSDOM;

/**
 * renderTextSegment nutzt ffmpeg-drawtext mit hart verdrahtetem
 * Debian-Font-Pfad (worker/lib/ffmpeg.ts). Auf Dev-Macs fehlt oft beides
 * (Homebrew-ffmpeg z.T. ohne drawtext-Filter; /usr/share/fonts existiert
 * nicht) → Laufzeit-Skip statt rotem Test.
 */
const DEJAVU_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const HAS_DRAWTEXT = RUN
  ? (spawnSync(BIN.ffmpeg, ["-hide_banner", "-filters"], {
      encoding: "utf8",
    }).stdout ?? "").includes(" drawtext ")
  : false;
const CAN_RENDER_TEXT = HAS_DRAWTEXT && existsSync(DEJAVU_FONT);

const HAS_PDFTOPPM = existsSync(BIN.pdftoppm);

/**
 * slide/pdf rendern über den Puppeteer-Browser-Pool (CHROMIUM_PATH).
 * Lokal nehmen wir den von `puppeteer` gemanagten Chrome-for-Testing-
 * Binary — beide Renderer laden ausschließlich file://-Inhalte
 * (pdf-segment-render blockt alles andere per Request-Interception,
 * slide-renderer lädt ohne Google-Fonts keinerlei externe Ressourcen).
 */
function resolveChromium(): string | null {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const p = puppeteerExecutablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* puppeteer ohne installierten Browser → Fallback unten */
  }
  // Fallback: puppeteer.executablePath() zeigt auf die zur installierten
  // puppeteer-Version "pinned" Chrome-Version — die muss lokal nicht
  // heruntergeladen sein. Nimm stattdessen den neuesten bereits
  // installierten Chrome-for-Testing aus dem Puppeteer-Cache.
  try {
    const cacheDir = join(homedir(), ".cache", "puppeteer", "chrome");
    const versions = readdirSync(cacheDir).sort().reverse();
    for (const v of versions) {
      const candidates = [
        join(
          cacheDir,
          v,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        join(cacheDir, v, "chrome-linux64", "chrome"),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    }
  } catch {
    /* kein Cache-Verzeichnis → CHROMIUM bleibt null, Suites skippen */
  }
  return null;
}

let CHROMIUM: string | null = null;
if (RUN) {
  CHROMIUM = resolveChromium();
  if (CHROMIUM) process.env.CHROMIUM_PATH = CHROMIUM;
}

/* -------------------------------------------------------------------------- */
/* Helpers: Prozesse + Output-Content-Prüfungen                                */
/* -------------------------------------------------------------------------- */

function runBin(
  bin: string,
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString("utf8")).slice(-16384);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function runBinOk(bin: string, args: string[]): Promise<void> {
  const { code, stderr } = await runBin(bin, args);
  if (code !== 0) {
    throw new Error(`${bin} exited ${code}: ${stderr.slice(-800)}`);
  }
}

/** Dauer in Sekunden — wirft, wenn ffprobe nichts Verwertbares liefert. */
async function probeDurationSec(path: string): Promise<number> {
  const d = await probeVideoDuration(path);
  expect(d, `ffprobe-Dauer von ${path}`).toBeTypeOf("number");
  return d as number;
}

/**
 * Mittlere Helligkeit (Rec-709-Luma, 0..255) eines extrahierten Frames.
 * "Nicht schwarz" heißt: deutlich über dem Schwellwert des Black-Clip-
 * Fallbacks (Luma ~16 bei yuv420p-Schwarz).
 */
async function frameLuma(
  videoPath: string,
  atSec: number,
  workDir: string,
): Promise<number> {
  const framePath = join(
    workDir,
    `luma-${Math.random().toString(16).slice(2)}.png`,
  );
  await runBinOk(BIN.ffmpeg, [
    "-y",
    "-ss",
    atSec.toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    framePath,
  ]);
  const stats = await sharp(framePath).stats();
  const [r, g, b] = stats.channels;
  return 0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean;
}

/** mean_volume in dB via ffmpeg volumedetect. null = nicht ermittelbar. */
async function meanVolumeDb(videoPath: string): Promise<number | null> {
  const { stderr } = await runBin(BIN.ffmpeg, [
    "-i",
    videoPath,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const m = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? parseFloat(m[1]) : null;
}

const DURATION_TOLERANCE_SEC = 0.15;

/** Gemeinsame Content-Prüfung: Dauer ±150ms, nicht schwarz, Audio-Spur. */
async function expectSegmentOutput(opts: {
  path: string;
  durationMs: number;
  workDir: string;
  /** Mindest-Luma des mittleren Frames (Black-Clip ≈ 16). */
  minLuma?: number;
  /**
   * Audio-Spur-Erwartung. Default true (anullsrc-Stille zählt!). pdf-
   * Segmente kommen aus imageSeqToMp4 OHNE Audio-Spur — die stille Spur
   * bekommt der Clip erst später via addSilentAudioTrack im Concat-Pfad
   * (processors/video-render.ts).
   */
  expectAudio?: boolean;
}): Promise<void> {
  const durSec = await probeDurationSec(opts.path);
  const wantSec = opts.durationMs / 1000;
  expect(
    Math.abs(durSec - wantSec),
    `Dauer ${durSec}s vs. Soll ${wantSec}s (${opts.path})`,
  ).toBeLessThanOrEqual(DURATION_TOLERANCE_SEC);

  const luma = await frameLuma(opts.path, wantSec / 2, opts.workDir);
  expect(luma, `mittlere Helligkeit (${opts.path})`).toBeGreaterThan(
    opts.minLuma ?? 40,
  );

  const hasAudio = await probeHasAudioStream(opts.path);
  expect(hasAudio, `Audio-Spur vorhanden (${opts.path})`).toBe(
    opts.expectAudio ?? true,
  );
}

/* -------------------------------------------------------------------------- */
/* Fixtures (zur Laufzeit erzeugt) + lokaler HTTP-Stub                        */
/* -------------------------------------------------------------------------- */

interface Fixtures {
  dir: string;
  baseUrl: string;
  server: Server;
  pngUrl: string;
  mp4Url: string;
  mp4SilentUrl: string;
  pdfUrl: string;
}

async function createFixtures(): Promise<Fixtures> {
  const dir = await mkdtemp(join(tmpdir(), "segment-matrix-"));

  // 1. Test-PNG via sharp: kräftiges Orange, 640x360 (16:9 → füllt die
  //    1280x720-Bühne komplett, Helligkeits-Check trifft das Motiv).
  const pngPath = join(dir, "fixture.png");
  await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 255, g: 140, b: 0 },
    },
  })
    .png()
    .toFile(pngPath);

  // 2. Test-MP4 mit Sinuston (440 Hz) + Farbfläche, 6s.
  const mp4Path = join(dir, "fixture.mp4");
  await runBinOk(BIN.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xff8c00:s=640x360:r=30:d=6",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
    mp4Path,
  ]);

  // 3. Test-MP4 OHNE Audio-Stream (für die anullsrc-Garantie).
  const mp4SilentPath = join(dir, "fixture-noaudio.mp4");
  await runBinOk(BIN.ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x4488ff:s=640x360:r=30:d=6",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    mp4SilentPath,
  ]);

  // 4. Test-PDF via pdf-lib (Dependency): 2 helle A4-Seiten mit Motiv.
  const { PDFDocument, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const page = pdfDoc.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
      color: rgb(0.98, 0.92, 0.6),
    });
    page.drawRectangle({
      x: 60,
      y: 560,
      width: 460,
      height: 160,
      color: rgb(0.12, 0.12, 0.45),
    });
  }
  const pdfPath = join(dir, "fixture.pdf");
  await writeFile(pdfPath, Buffer.from(await pdfDoc.save()));

  // 5. Lokaler HTTP-Stub: die Renderer laden publicUrl/pdfUrl via fetch
  //    (fetchToFile bzw. downloadPdf) — wir bedienen sie aus dem Fixture-
  //    Verzeichnis, ohne dass eine Quelldatei angefasst werden muss.
  const MIME: Record<string, string> = {
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
  };
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const name = (req.url ?? "/").split("?")[0].replace(/^\/+/, "");
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
          res.writeHead(400).end();
          return;
        }
        const buf = await readFile(join(dir, name));
        res.writeHead(200, {
          "Content-Type": MIME[extname(name)] ?? "application/octet-stream",
          "Content-Length": buf.byteLength,
        });
        res.end(buf);
      } catch {
        res.writeHead(404).end("not found");
      }
    })();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("http fixture server: no port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    dir,
    baseUrl,
    server,
    pngUrl: `${baseUrl}/fixture.png`,
    mp4Url: `${baseUrl}/fixture.mp4`,
    mp4SilentUrl: `${baseUrl}/fixture-noaudio.mp4`,
    pdfUrl: `${baseUrl}/fixture.pdf`,
  };
}

/* -------------------------------------------------------------------------- */
/* Segment-Fixtures (Typ-vollständig)                                          */
/* -------------------------------------------------------------------------- */

function makeVideoSegment(
  overrides: Partial<VideoSegment> & { publicUrl: string },
): VideoSegment {
  return {
    id: `vid-${Math.random().toString(16).slice(2)}`,
    kind: "video",
    durationMs: 4000,
    mediaId: null,
    originalDurationSec: 6,
    trimStartMs: 0,
    trimEndMs: null,
    cropRatio: "16:9",
    showAsBrowserFrame: false,
    browserTabName: "",
    browserTabUrl: "",
    ...overrides,
  };
}

function makeImageSegment(publicUrl: string): ImageSegment {
  return {
    id: `img-${Math.random().toString(16).slice(2)}`,
    kind: "image",
    durationMs: 3000,
    mediaId: null,
    publicUrl,
    displayMode: "fullscreen",
    bgColor: "#101014",
    posXPct: 50,
    posYPct: 50,
    widthPct: 100,
    heightPct: 100,
  };
}

/* -------------------------------------------------------------------------- */
/* ECHTE Renders (text, image, video, slide, pdf)                              */
/* -------------------------------------------------------------------------- */

describe.skipIf(!RUN)("segment-render matrix: echter Output", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await createFixtures();
  }, 120_000);

  afterAll(async () => {
    await closeBrowserPool().catch(() => undefined);
    if (fx?.server) {
      await new Promise<void>((resolve) => fx.server.close(() => resolve()));
    }
    if (fx?.dir) {
      await rm(fx.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 60_000);

  describe("text", () => {
    it(
      "rendert Text-Segment: Dauer, heller Hintergrund, stille Audio-Spur",
      async (ctx) => {
        if (!CAN_RENDER_TEXT) {
          // drawtext-Filter oder Debian-DejaVu-Font fehlen in dieser
          // Umgebung (typisch: macOS-Dev). Im Worker-Image (Debian
          // Bookworm) läuft der Test echt.
          ctx.skip();
          return;
        }
        const out = join(fx.dir, "out-text.mp4");
        await renderTextSegment({
          text: "VIDEOCOMET\nRegressions-Matrix",
          bgColor: "#e8e8ee",
          textColor: "#16161a",
          fontSize: 64,
          textAlign: "center",
          fontWeight: "700",
          italic: false,
          durationMs: 2500,
          outputPath: out,
        });
        await expectSegmentOutput({
          path: out,
          durationMs: 2500,
          workDir: fx.dir,
          minLuma: 120,
        });
        const mv = await meanVolumeDb(out);
        // anullsrc-Stille: praktisch kein Pegel.
        expect(mv === null || mv < -60).toBe(true);
      },
      120_000,
    );
  });

  describe("image", () => {
    it(
      "rendert Bild-Segment (HTTP-Fixture): Dauer, nicht schwarz, Audio-Spur",
      async () => {
        const out = join(fx.dir, "out-image.mp4");
        await renderImageSegment({
          segment: makeImageSegment(fx.pngUrl),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-image"),
          outputPath: out,
        });
        // Orange 16:9 → füllt die Bühne, Luma ≈ 150.
        await expectSegmentOutput({
          path: out,
          durationMs: 3000,
          workDir: fx.dir,
          minLuma: 80,
        });
      },
      120_000,
    );
  });

  describe("video", () => {
    it(
      "rendert Video-Segment ohne Fenster: Dauer, Bild, Original-Ton",
      async () => {
        const out = join(fx.dir, "out-video-full.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({ publicUrl: fx.mp4Url }),
          durationMs: 4000,
          outputDir: join(fx.dir, "work-video-full"),
          outputPath: out,
        });
        await expectSegmentOutput({
          path: out,
          durationMs: 4000,
          workDir: fx.dir,
          minLuma: 80,
        });
        // Sinuston muss hörbar durchkommen (kein Stummschalt-Bug).
        const mv = await meanVolumeDb(out);
        expect(mv).not.toBeNull();
        expect(mv as number).toBeGreaterThan(-30);
      },
      180_000,
    );

    it(
      "Volume-Regression (Incident 2026-08-21): volume=0.5 ≈ -6dB vs. Referenz, volume=0 stumm",
      async () => {
        // Referenz volume=1 (undefined → Default).
        const refOut = join(fx.dir, "out-video-vol1.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({ publicUrl: fx.mp4Url }),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-vol1"),
          outputPath: refOut,
        });
        const halfOut = join(fx.dir, "out-video-vol05.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({ publicUrl: fx.mp4Url, volume: 0.5 }),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-vol05"),
          outputPath: halfOut,
        });
        const muteOut = join(fx.dir, "out-video-vol0.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({ publicUrl: fx.mp4Url, volume: 0 }),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-vol0"),
          outputPath: muteOut,
        });

        const mvRef = await meanVolumeDb(refOut);
        const mvHalf = await meanVolumeDb(halfOut);
        expect(mvRef).not.toBeNull();
        expect(mvHalf).not.toBeNull();

        // 20*log10(0.5) ≈ -6.02 dB relativ zur volume=1-Referenz, ±1.5 dB.
        const expectedDelta = 20 * Math.log10(0.5);
        const actualDelta = (mvHalf as number) - (mvRef as number);
        expect(
          Math.abs(actualDelta - expectedDelta),
          `Δ mean_volume ${actualDelta.toFixed(2)}dB vs. erwartet ${expectedDelta.toFixed(2)}dB`,
        ).toBeLessThanOrEqual(1.5);

        // volume=0 → faktisch Stille (AAC-Noise-Floor erlaubt).
        const mvMute = await meanVolumeDb(muteOut);
        expect(mvMute === null || mvMute < -60).toBe(true);

        // Alle drei Varianten halten die Segment-Dauer.
        for (const p of [refOut, halfOut, muteOut]) {
          const d = await probeDurationSec(p);
          expect(Math.abs(d - 3)).toBeLessThanOrEqual(DURATION_TOLERANCE_SEC);
        }
      },
      240_000,
    );

    it(
      "Quelle ohne Audio-Stream → Output trägt trotzdem eine (stille) Audio-Spur",
      async () => {
        const out = join(fx.dir, "out-video-silent.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({ publicUrl: fx.mp4SilentUrl }),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-video-silent"),
          outputPath: out,
        });
        await expectSegmentOutput({
          path: out,
          durationMs: 3000,
          workDir: fx.dir,
          minLuma: 40,
        });
        const mv = await meanVolumeDb(out);
        expect(mv === null || mv < -60).toBe(true);
      },
      180_000,
    );

    it(
      "Studio-Wiedergabefenster (Still + Play + Freeze) hält die Gesamtdauer exakt",
      async () => {
        const out = join(fx.dir, "out-video-windows.mp4");
        await renderVideoSegment({
          segment: makeVideoSegment({
            publicUrl: fx.mp4Url,
            playbackWindows: [{ startMs: 1000, stopMs: 2000 }],
          }),
          durationMs: 3000,
          outputDir: join(fx.dir, "work-video-windows"),
          outputPath: out,
        });
        await expectSegmentOutput({
          path: out,
          durationMs: 3000,
          workDir: fx.dir,
          minLuma: 80,
        });
        // Auch der Poster-Still-Teil (vor dem Fenster) darf nicht schwarz sein.
        const posterLuma = await frameLuma(out, 0.4, fx.dir);
        expect(posterLuma).toBeGreaterThan(80);
      },
      180_000,
    );
  });

  describe.skipIf(!CHROMIUM)("slide", () => {
    it(
      "rendert Slide-Segment (React-SSR + Puppeteer, offline): Dauer, Bild, Audio",
      async () => {
        const { renderSlideToMp4 } = await import("./slide-renderer");
        const slide: SlideSegment = {
          id: "slide-matrix",
          kind: "slide",
          durationMs: 2500,
          background: { type: "color", color: "#f4c20d" },
          layers: [
            {
              id: "layer-text",
              kind: "text",
              x: 120,
              y: 240,
              w: 1040,
              h: 240,
              rot: 0,
              opacity: 1,
              // Bewusst OHNE font-family → kein Google-Fonts-Request,
              // der Render bleibt komplett offline.
              contentHtml: "<p>VIDEOCOMET Testfolie</p>",
              vAlign: "middle",
            },
          ],
        };
        const out = join(fx.dir, "out-slide.mp4");
        await renderSlideToMp4({
          slide,
          leadData: {},
          durationMs: 2500,
          outputDir: join(fx.dir, "work-slide"),
          outputPath: out,
        });
        await expectSegmentOutput({
          path: out,
          durationMs: 2500,
          workDir: fx.dir,
          minLuma: 120,
        });
      },
      240_000,
    );
  });

  describe.skipIf(!CHROMIUM || !HAS_PDFTOPPM)("pdf", () => {
    it(
      "rendert PDF-Segment (HTTP-Fixture → pdftoppm → file://-Viewer): Dauer + Bild",
      async () => {
        const { renderPdfSegment } = await import("./pdf-segment-render");
        const segment: PdfSegment = {
          id: `pdf-${Math.random().toString(16).slice(2)}`,
          kind: "pdf",
          durationMs: 2500,
          pdfUrl: fx.pdfUrl,
          fileName: "matrix-fixture.pdf",
          // pageUrls/docWidth/docHeight sind Editor-Vorschau-Metadaten —
          // der Worker rastert das Original-PDF selbst neu (pdftoppm).
          pageUrls: [],
          pageCount: 2,
          docWidth: 1240,
          docHeight: 1754,
          captureMode: "static-hero",
        };
        const out = join(fx.dir, "out-pdf.mp4");
        await renderPdfSegment({
          segment,
          durationMs: 2500,
          outputDir: join(fx.dir, "work-pdf"),
          outputPath: out,
        });
        // WICHTIG: PDF-Segmente kommen aus imageSeqToMp4 und haben KEINE
        // Audio-Spur — die stille AAC-Spur ergänzt erst
        // addSilentAudioTrack im Concat-Pfad (processors/video-render.ts).
        await expectSegmentOutput({
          path: out,
          durationMs: 2500,
          workDir: fx.dir,
          minLuma: 60,
          expectAudio: false,
        });
      },
      240_000,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* website / gdocs: nur Plan-/Geometrie-Ebene                                  */
/* -------------------------------------------------------------------------- */

describe("website/gdocs: Scroll-Geometrie (pure, spiegelt buildScrollPlanFromFrames)", () => {
  const frames = [
    { t: 0, y: 0 },
    { t: 1000, y: 0.5 },
    { t: 2000, y: 1 },
  ];

  it("vor dem ersten Sample → y des ersten Samples", () => {
    expect(interpolateScrollRatio(frames, -100)).toBe(0);
    expect(interpolateScrollRatio([{ t: 500, y: 0.3 }], 0)).toBeCloseTo(0.3);
  });

  it("nach dem letzten Sample → y des letzten Samples (Freeze am Ende)", () => {
    expect(interpolateScrollRatio(frames, 5000)).toBe(1);
  });

  it("interpoliert linear zwischen Samples", () => {
    expect(interpolateScrollRatio(frames, 500)).toBeCloseTo(0.25);
    expect(interpolateScrollRatio(frames, 1500)).toBeCloseTo(0.75);
  });

  it("clampt Ausreißer-Samples auf 0..1", () => {
    expect(
      interpolateScrollRatio(
        [
          { t: 0, y: -2 },
          { t: 1000, y: 3 },
        ],
        1000,
      ),
    ).toBe(1);
  });

  it("ohne Samples → 0 (static-hero-Verhalten)", () => {
    expect(interpolateScrollRatio(undefined, 1234)).toBe(0);
    expect(interpolateScrollRatio([], 1234)).toBe(0);
  });
});

describe("pdf/gdocs Viewer-HTML (pure)", () => {
  it("buildPdfViewerHtml bettet alle Seiten-URLs ein und escaped den Dateinamen", () => {
    const html = buildPdfViewerHtml(
      ["file:///tmp/page-1.png", "file:///tmp/page-2.png"],
      { fileName: 'Angebot <"Q3">.pdf', pageCount: 2 },
    );
    expect(html).toContain("file:///tmp/page-1.png");
    expect(html).toContain("file:///tmp/page-2.png");
    expect(html).not.toContain('<"Q3">');
    expect(PDF_TOOLBAR_HEIGHT_PX).toBeGreaterThan(0);
  });
});

// Echte website/gdocs-Renders brauchen Puppeteer GEGEN externes Netz
// (Live-Website des Leads bzw. Google-HTML-Export inkl. Auth) — das ist
// lokal/CI weder deterministisch noch offline machbar. Die Geometrie-Ebene
// ist oben abgedeckt; der Capture-Pfad läuft nur in Staging/Prod.
describe.skip("website/gdocs: echter Segment-Render (Puppeteer + externes Netz)", () => {
  it("website static-hero/scroll-recorded gegen Live-URL", () => {
    expect.unreachable("nur mit Netz/Google-Zugriff sinnvoll");
  });
  it("gdocs HTML-Export + Platzhalter-Substitution", () => {
    expect.unreachable("nur mit Netz/Google-Zugriff sinnvoll");
  });
});

/* -------------------------------------------------------------------------- */
/* gslide / canva: nur strukturelle Ebene                                      */
/* -------------------------------------------------------------------------- */

describe("gslide: URL-Parsing (pure, entscheidet die Render-Pipeline)", () => {
  const DOC_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg";

  it("Edit-URL → edit-Mode mit kanonischem PPTX-Export", () => {
    const parsed = parsePublishedSlidesUrl(
      `https://docs.google.com/presentation/d/${DOC_ID}/edit?usp=sharing`,
    );
    expect(isEditMode(parsed)).toBe(true);
    if (isEditMode(parsed)) {
      expect(parsed.docId).toBe(DOC_ID);
      expect(parsed.canonicalExportUrl).toBe(
        `https://docs.google.com/presentation/d/${DOC_ID}/export/pptx`,
      );
    }
  });

  it("Pubembed-URL → Legacy-Puppeteer-Mode", () => {
    const parsed = parsePublishedSlidesUrl(
      "https://docs.google.com/presentation/d/e/2PACX-1vTabcdefghijklmnopqrstuvwxyz1234567890abcd/pubembed?start=false",
    );
    expect(isEditMode(parsed)).toBe(false);
    expect(parsed.mode).toBe("pubembed");
  });

  it("Nicht-Google-URLs werden abgelehnt", () => {
    expect(() =>
      parsePublishedSlidesUrl("https://example.com/presentation/d/abc/edit"),
    ).toThrowError();
  });
});

// Echte gslide/canva-Renders sind KEINE thumbnailUrl-Standbild-Renderer:
// Der Worker lädt das PPTX (gslide: Google-Export-Endpoint, canva: Bunny-
// CDN) und rendert es über LibreOffice headless → PDF → PNG → MP4
// (gslide-render.ts / canva-render.ts). thumbnailUrl dient NUR der
// Editor-Vorschau. Ohne Google-Download bzw. reproduzierbare
// LibreOffice-Umgebung ist das lokal nicht deterministisch testbar; der
// gemeinsame PNG→MP4-Endpfad (renderImageToMp4) ist über den Slide-Test
// oben real abgedeckt.
describe.skip("gslide/canva: echter Segment-Render (PPTX + LibreOffice)", () => {
  it("gslide edit-mode: Google-PPTX-Export → LibreOffice → MP4", () => {
    expect.unreachable("braucht Google-Download");
  });
  it("canva: Bunny-PPTX → LibreOffice → MP4", () => {
    expect.unreachable("braucht LibreOffice-Pipeline mit PPTX-Fixture");
  });
});
