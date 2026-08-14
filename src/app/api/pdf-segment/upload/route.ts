export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Rastern (pdftoppm) + bis zu 41 Bunny-PUTs — großzügiges Timeout.
export const maxDuration = 60;

/**
 * POST /api/pdf-segment/upload
 *
 * Multipart-Form mit Feld `file` (PDF, max. 25 MB, max. 40 Seiten).
 *
 * Rastert das PDF synchron via `pdftoppm` (150 dpi, wie die GSlides-
 * Pipeline) zu Seiten-PNGs und lädt Original + PNGs nach Bunny Storage
 * (PDF-Zone, dieselbe wie Canva-/Media-Uploads):
 *
 *   pdf-segments/<userId>/<uuid>/source.pdf
 *   pdf-segments/<userId>/<uuid>/page-1.png … page-N.png
 *
 * Antwort 201:
 *   {
 *     pdfUrl: string,        // CDN-URL des Original-PDF
 *     pageUrls: string[],    // CDN-URLs der Seiten-PNGs, in Seitenreihenfolge
 *     pageCount: number,
 *     docWidth: number,      // Pixel-Maße EINER Seite bei 150 dpi
 *     docHeight: number,
 *     fileName: string       // Original-Dateiname (UI + Viewer-Toolbar)
 *   }
 *
 * Die Response-Felder mappen 1:1 auf `PdfSegment` (src/lib/segments/types.ts).
 *
 * Auth: User-Session (Tenant-Guard via Lucia).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { requireUserApi } from "@/lib/auth-guard";
import { uploadFile } from "@/lib/bunny/storage";
import { pdfToPng } from "@/worker/lib/pdf-to-image";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_PAGES = 40;
const RASTER_DPI = 150;
const RASTER_TIMEOUT_MS = 60_000;
/** Kleines Parallel-Fenster für Bunny-PUTs (Muster der Custom-LP-Route). */
const UPLOAD_CONCURRENCY = 8;

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültiger multipart-Body.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Feld 'file' fehlt." }, { status: 400 });
  }

  const fileName = file.name || "dokument.pdf";
  const bytes = file.size;

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return NextResponse.json(
      { error: "Datei ist leer oder ungültig." },
      { status: 422 },
    );
  }
  if (bytes > MAX_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `Datei zu groß (${(bytes / 1024 / 1024).toFixed(1)} MB). Maximum: 25 MB.`,
      },
      { status: 422 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Magic-Bytes statt MIME: Browser liefern für PDFs inkonsistente
  // Content-Types (Safari gern "application/octet-stream").
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json(
      { error: "Die Datei ist kein gültiges PDF. Bitte lade eine PDF-Datei hoch." },
      { status: 422 },
    );
  }

  // Eigene tmp-Sandbox pro Request; wird im finally restlos entsorgt.
  const workDir = await mkdtemp(join(tmpdir(), "pdf-segment-"));
  try {
    const pdfPath = join(workDir, "source.pdf");
    await writeFile(pdfPath, buffer);

    // ── Rastern: pdftoppm 150 dpi → page-1.png … page-N.png ────────────────
    let pagePaths: string[];
    try {
      const result = await pdfToPng({
        pdfPath,
        outDir: workDir,
        dpi: RASTER_DPI,
        prefix: "page",
        timeoutMs: RASTER_TIMEOUT_MS,
      });
      pagePaths = result.pages;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[api/pdf-segment/upload] pdftoppm failed:", err);
      const timedOut =
        err instanceof Error && /timed out/i.test(err.message);
      return NextResponse.json(
        {
          error: timedOut
            ? "Das PDF konnte nicht rechtzeitig verarbeitet werden (Timeout). Bitte ein kleineres oder einfacheres PDF verwenden."
            : "Das PDF konnte nicht verarbeitet werden. Bitte prüfe die Datei und versuche es erneut.",
        },
        { status: 422 },
      );
    }

    if (pagePaths.length === 0) {
      return NextResponse.json(
        { error: "Das PDF enthält keine lesbaren Seiten." },
        { status: 422 },
      );
    }
    if (pagePaths.length > MAX_PAGES) {
      return NextResponse.json(
        { error: `PDF hat zu viele Seiten (max. ${MAX_PAGES}).` },
        { status: 422 },
      );
    }

    // ── Maße der ersten Seite (Scroll-Mathe im Editor + Worker) ────────────
    let docWidth = 0;
    let docHeight = 0;
    try {
      const meta = await sharp(pagePaths[0]!).metadata();
      docWidth = meta.width ?? 0;
      docHeight = meta.height ?? 0;
    } catch {
      // sharp sollte PNGs aus pdftoppm immer lesen können — defensiv 422.
    }
    if (docWidth <= 0 || docHeight <= 0) {
      return NextResponse.json(
        { error: "Die Seitenmaße des PDFs konnten nicht ermittelt werden." },
        { status: 422 },
      );
    }

    // ── Upload nach Bunny: source.pdf + Seiten-PNGs ────────────────────────
    const basePath = `pdf-segments/${auth.user.id}/${randomUUID()}`;

    interface UploadJob {
      localPath: string | null; // null → Buffer direkt (source.pdf)
      remotePath: string;
      contentType: string;
      /** Index in `pageUrls`; -1 = source.pdf */
      pageIndex: number;
    }
    const jobs: UploadJob[] = [
      {
        localPath: null,
        remotePath: `${basePath}/source.pdf`,
        contentType: "application/pdf",
        pageIndex: -1,
      },
      ...pagePaths.map((p, i) => ({
        localPath: p,
        remotePath: `${basePath}/page-${i + 1}.png`,
        contentType: "image/png",
        pageIndex: i,
      })),
    ];

    let pdfUrl = "";
    const pageUrls: string[] = new Array<string>(pagePaths.length).fill("");
    const failures: string[] = [];

    const queue = [...jobs];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) return;
        try {
          const content =
            job.localPath === null ? buffer : await readFile(job.localPath);
          const uploaded = await uploadFile({
            buffer: content,
            remotePath: job.remotePath,
            contentType: job.contentType,
          });
          if (job.pageIndex === -1) pdfUrl = uploaded.url;
          else pageUrls[job.pageIndex] = uploaded.url;
        } catch (err) {
          failures.push(
            `${job.remotePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()),
    );

    if (failures.length > 0 || !pdfUrl || pageUrls.some((u) => !u)) {
      // eslint-disable-next-line no-console
      console.error("[api/pdf-segment/upload] bunny upload failures:", failures);
      return NextResponse.json(
        { error: "Upload nach Bunny fehlgeschlagen. Bitte erneut versuchen." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        pdfUrl,
        pageUrls,
        pageCount: pageUrls.length,
        docWidth,
        docHeight,
        fileName,
      },
      { status: 201 },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
