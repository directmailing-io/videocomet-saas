/**
 * Stage 6: DOCX modification.
 *
 * Downloads the campaign's Google-Doc as a DOCX (via the public export
 * endpoint, cached 5 min), replaces `{{...}}` text placeholders with
 * values from the lead's data row, and swaps the QR and Thumb marker
 * images for the per-lead PNG/JPG.
 *
 * Marker hashes are computed once via `getMarkerSha256` and memoised in
 * module-scope so every Run only pays the cost once.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadDocx,
  replaceImageByHash,
  replacePlaceholders,
  saveDocx,
} from "../lib/docx";
import { fetchGoogleDocAsDocx } from "../lib/google-docs";
import {
  generateMarkerPng,
  getMarkerSha256,
} from "@/lib/marker-placeholders";

export interface DocxModifyInput {
  outDir: string;
  googleDocsUrl: string;
  /**
   * Raw `{{key}}` -> value map. Typically `lead.data` from the run upload,
   * extended with auto-derived fields (`landingpageUrl`, `firstName`,
   * `lastName`) by the pipeline orchestrator before calling this stage.
   */
  vars: Record<string, string>;
  qrPngPath: string | null;
  /**
   * Legacy: Pfad zum extrahierten Video-Frame (JPG). Wird genutzt, falls
   * der neue Thumbnail-Generator (Paket E) KEIN Lead- bzw. Run-Thumbnail
   * liefert. Wenn alle drei Quellen leer sind, bleibt der Bild-Slot im
   * Brief leer (Bestandsverhalten bei keinem Video).
   */
  thumbJpgPath: string | null;
  /**
   * Personalisiertes Thumbnail-PNG pro Lead (Thumbnail-Generator
   * `leads.customThumbnailUrl`). Wenn gesetzt, hat es die höchste Prio
   * über alle anderen Quellen.
   */
  customThumbnailUrl?: string | null;
  /**
   * Geteiltes Thumbnail-PNG pro Run (Thumbnail-Generator
   * `runs.sharedThumbnailUrl`). Wird verwendet, wenn das Template keine
   * Platzhalter enthält und damit für alle Leads identisch ist.
   */
  sharedThumbnailUrl?: string | null;
}

export interface DocxModifyOutput {
  docxPath: string;
  /** true when at least one media file matched the QR marker hash. */
  qrReplaced: boolean;
  /** true when at least one media file matched the thumb marker hash. */
  thumbReplaced: boolean;
  /**
   * Quelle des eingebetteten Thumbnails — für Telemetry / Pipeline-Events.
   *  - `custom`     : personalisiertes Thumbnail aus `customThumbnailUrl`
   *  - `shared`     : geteiltes Thumbnail aus `sharedThumbnailUrl`
   *  - `video-frame`: Legacy-Video-Frame (`thumbJpgPath`)
   *  - `none`       : keine Quelle vorhanden, Bild-Slot bleibt leer
   */
  thumbSource: "custom" | "shared" | "video-frame" | "none";
}

/**
 * Module-level cache of marker SHA-256 hashes.
 * The marker PNGs are deterministic (see src/lib/marker-placeholders.ts),
 * so the hash is the same across every worker job and we only need to
 * generate the markers once per worker process.
 */
let cachedQrSha: string | null = null;
let cachedThumbSha: string | null = null;

async function getQrMarkerSha(): Promise<string> {
  if (cachedQrSha) return cachedQrSha;
  const buf = await generateMarkerPng("qr");
  cachedQrSha = getMarkerSha256(buf);
  return cachedQrSha;
}

async function getThumbMarkerSha(): Promise<string> {
  if (cachedThumbSha) return cachedThumbSha;
  const buf = await generateMarkerPng("thumb");
  cachedThumbSha = getMarkerSha256(buf);
  return cachedThumbSha;
}

/** Test-only helper: wipe memoised marker hashes. */
export function _clearMarkerHashCache(): void {
  cachedQrSha = null;
  cachedThumbSha = null;
}

/**
 * Lädt eine URL und liefert den Body als Buffer. Genutzt, um die Bunny-
 * gehosteten Thumbnail-PNGs (Paket E) in den DOCX-Stream einzuziehen.
 */
async function fetchAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `thumbnail fetch HTTP ${res.status} ${res.statusText} url=${url}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Wählt nach Priorität die Quelle des einzubettenden Thumbnails:
 *   1. customThumbnailUrl (personalisiertes PNG pro Lead)
 *   2. sharedThumbnailUrl (geteiltes PNG pro Run, ohne Platzhalter)
 *   3. thumbJpgPath       (Legacy-Video-Frame-Extract)
 *   4. null               (Bild-Slot bleibt leer)
 *
 * Fehler beim Bunny-Fetch eines Generator-Bildes werden gelogged und
 * fallen STILLE auf die nächste Quelle zurück — der Brief soll trotzdem
 * generiert werden, selbst wenn das hübsche Custom-Thumbnail nicht
 * erreichbar ist.
 */
async function resolveThumbBytes(input: DocxModifyInput): Promise<
  | {
      source: "custom" | "shared" | "video-frame";
      bytes: Buffer;
      contentType: "image/png" | "image/jpeg";
    }
  | { source: "none" }
> {
  if (input.customThumbnailUrl) {
    try {
      const bytes = await fetchAsBuffer(input.customThumbnailUrl);
      return { source: "custom", bytes, contentType: "image/png" };
    } catch (err) {
      console.warn(
        `[docx-modify] customThumbnailUrl fetch failed (${(err as Error).message}); falling back to shared/video-frame`,
      );
    }
  }
  if (input.sharedThumbnailUrl) {
    try {
      const bytes = await fetchAsBuffer(input.sharedThumbnailUrl);
      return { source: "shared", bytes, contentType: "image/png" };
    } catch (err) {
      console.warn(
        `[docx-modify] sharedThumbnailUrl fetch failed (${(err as Error).message}); falling back to video-frame`,
      );
    }
  }
  if (input.thumbJpgPath) {
    const bytes = await readFile(input.thumbJpgPath);
    return { source: "video-frame", bytes, contentType: "image/jpeg" };
  }
  return { source: "none" };
}

export async function runDocxModify(
  input: DocxModifyInput,
): Promise<DocxModifyOutput> {
  // 1. Fetch DOCX from Google (cached 5 min in google-docs lib).
  const docxBuffer = await fetchGoogleDocAsDocx(input.googleDocsUrl);

  // 2. Open ZIP once; all mutations operate on the same handle.
  const { zip } = loadDocx(docxBuffer);

  // 3. Text placeholders.
  replacePlaceholders(zip, input.vars);

  // 4. QR-Marker swap. Dimensions-Fallback (400x400) faengt die Faelle ab,
  //    in denen Google Docs das PNG beim Einfügen re-encoded hat.
  let qrReplaced = false;
  if (input.qrPngPath) {
    const targetSha = await getQrMarkerSha();
    const qrBytes = await readFile(input.qrPngPath);
    qrReplaced = replaceImageByHash(zip, {
      targetSha256: targetSha,
      newImageBuffer: qrBytes,
      contentType: "image/png",
      matchDimensions: { width: 400, height: 400 },
    });
  }

  // 5. Thumb-Marker swap. Quelle nach Priorität wählen (Paket E):
  //    customThumbnailUrl > sharedThumbnailUrl > thumbJpgPath > none.
  //    Dimensions-Fallback bleibt 640x360 — das DOCX-Template wurde mit
  //    diesem Slot-Format angelegt.
  let thumbReplaced = false;
  let thumbSource: DocxModifyOutput["thumbSource"] = "none";
  const resolved = await resolveThumbBytes(input);
  if (resolved.source !== "none") {
    const targetSha = await getThumbMarkerSha();
    thumbReplaced = replaceImageByHash(zip, {
      targetSha256: targetSha,
      newImageBuffer: resolved.bytes,
      contentType: resolved.contentType,
      matchDimensions: { width: 640, height: 360 },
    });
    thumbSource = resolved.source;
  }

  // 6. Toxische wp:anchor-Attribute patchen VOR der Serialisierung.
  //    Google Docs setzt `allowOverlap="1"` auf Floating-Images — kombiniert
  //    mit floating-positionierten Tabellen rendert LibreOffice die Bilder
  //    mit kleinem Position-Drift. Mit `allowOverlap="0"` clampt LO auf die
  //    exakte posOffset-Koordinate.
  //    Bewusst KEIN Anchor→Inline-Umwurf und KEIN wrapNone-Patch — beide
  //    haben in lokalen Tests Layout-Bruch verursacht.
  const { patchToxicAnchorAttributesInZip } = await import(
    "../lib/docx-normalize"
  );
  const anchorPatches = patchToxicAnchorAttributesInZip(zip);
  if (anchorPatches.allowOverlapPatched > 0) {
    console.info(
      `[docxModify] patched ${anchorPatches.allowOverlapPatched} allowOverlap in anchors`,
    );
  }

  // 7. Serialise + write to outDir.
  const outBuffer = saveDocx(zip);
  const outPath = join(input.outDir, "letter.docx");
  await writeFile(outPath, outBuffer);

  return { docxPath: outPath, qrReplaced, thumbReplaced, thumbSource };
}
