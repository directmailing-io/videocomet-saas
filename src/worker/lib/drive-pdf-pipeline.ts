/**
 * Renderer 2.0 — Google Drive Pipeline.
 *
 * Loest das LibreOffice-Floating-Layout-Problem fundamental: wir gehen
 * NICHT mehr ueber DOCX-Export. Stattdessen:
 *
 *   1. Service-Account kopiert das User-Template per `drive.files.copy`.
 *   2. `docs.documents.batchUpdate` ersetzt `{{placeholder}}` mit
 *      Lead-Werten und tauscht Marker-Bilder (QR + Thumbnail) per
 *      `replaceImage`-Request mit den Lead-spezifischen Bildern.
 *   3. `drive.files.export(mimeType=application/pdf)` liefert das PDF
 *      vom GOOGLE-Renderer — identisch wie der User es im Browser sieht.
 *   4. Cleanup: `drive.files.delete` der Kopie.
 *
 * Marker-Bilder werden ueber Pixel-Dimensionen identifiziert (QR=400×400,
 * Thumb=640×360) — identisch zur LibreOffice-Pipeline, damit bestehende
 * Templates ohne Anpassung funktionieren.
 *
 * Fehler-Strategie:
 *   - Jeder Schritt darf werfen — der Caller faengt und faellt auf den
 *     LibreOffice-Pfad zurueck (siehe `pipeline.ts` `runDocxModify`-Switch).
 *   - Cleanup laeuft auch im Fehlerfall (finally-Block).
 */

import { randomUUID } from "node:crypto";
import { getDocsClient, getDriveClient, extractDocId } from "@/lib/google-docs/sa-auth";

export interface DrivePipelineInput {
  /** Original-URL des User-Templates (Google Doc). */
  googleDocsUrl: string;
  /** `{{key}}` → Wert. Wird via `replaceAllText` substituiert. */
  textVars: Record<string, string>;
  /** Optionale Bunny-CDN-URL des Lead-spezifischen QR-PNG (400×400). */
  qrImageUrl?: string | null;
  /** Optionale Bunny-CDN-URL des Lead-spezifischen Thumbnail (640×360). */
  thumbnailImageUrl?: string | null;
}

export interface DrivePipelineOutput {
  /** PDF-Bytes des gerenderten Briefs. */
  pdfBuffer: Buffer;
  /** Wurde QR-Marker getauscht? Fuer Telemetry. */
  qrReplaced: boolean;
  /** Wurde Thumb-Marker getauscht? Fuer Telemetry. */
  thumbReplaced: boolean;
  /** Anzahl Text-Substitutionen. */
  textReplacements: number;
}

/** Marker-Pixel-Dimensionen, kompatibel zur LibreOffice-Pipeline. */
const QR_MARKER_SIZE = { width: 400, height: 400 };
const THUMB_MARKER_SIZE = { width: 640, height: 360 };

/**
 * Findet inlineObjectIds, die ein Bild mit den gegebenen Pixel-Dimensionen
 * enthalten. Google-Docs gibt Bild-Groessen in `size` (Magnitude+Unit)
 * — wir matchen auf den `crop`-bereinigten Pixel-Wert.
 *
 * Da User-Templates die Marker-PNGs in Original-Aufloesung einfuegen,
 * sind die Pixel-Werte exakt — Toleranz=2px reicht fuer Anti-Aliasing.
 */
function findMarkerObjectId(
  inlineObjects: Record<string, any>,
  target: { width: number; height: number },
): string | null {
  const TOL = 4;
  for (const [objectId, obj] of Object.entries(inlineObjects)) {
    const props = obj?.inlineObjectProperties?.embeddedObject;
    if (!props?.imageProperties) continue;
    // Google liefert `size` in EMU oder PT — wir nehmen `embeddedObject.size`
    // (Magnitude+Unit "EMU"/"PT") und konvertieren in Pixel @ 96 DPI.
    const size = props.size;
    if (!size?.width?.magnitude || !size?.height?.magnitude) continue;
    const w = toPx(size.width);
    const h = toPx(size.height);
    if (Math.abs(w - target.width) <= TOL && Math.abs(h - target.height) <= TOL) {
      return objectId;
    }
  }
  return null;
}

function toPx(dim: { magnitude: number; unit: string }): number {
  // EMU: 914400/inch, PT: 72/inch, 96 DPI.
  if (dim.unit === "EMU") return Math.round((dim.magnitude / 914_400) * 96);
  if (dim.unit === "PT") return Math.round((dim.magnitude / 72) * 96);
  return Math.round(dim.magnitude);
}

export async function renderViaDrive(
  input: DrivePipelineInput,
): Promise<DrivePipelineOutput> {
  const templateId = extractDocId(input.googleDocsUrl);
  if (!templateId) {
    throw new Error(`Invalid Google Doc URL: ${input.googleDocsUrl}`);
  }

  const drive = getDriveClient();
  const docs = getDocsClient();

  // 1. Copy template
  const copyName = `[VC-render] ${randomUUID()}`;
  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: copyName },
    fields: "id",
    supportsAllDrives: true,
  });
  const copyId = copyRes.data.id;
  if (!copyId) {
    throw new Error("Drive copy returned empty fileId");
  }

  try {
    // 2. Inline-Objects auslesen (fuer Marker-Image-Detection)
    const docMeta = await docs.documents.get({
      documentId: copyId,
      fields: "inlineObjects",
    });
    const inlineObjects = (docMeta.data.inlineObjects ?? {}) as Record<
      string,
      unknown
    >;

    const qrObjectId =
      input.qrImageUrl != null
        ? findMarkerObjectId(inlineObjects, QR_MARKER_SIZE)
        : null;
    const thumbObjectId =
      input.thumbnailImageUrl != null
        ? findMarkerObjectId(inlineObjects, THUMB_MARKER_SIZE)
        : null;

    // 3. BatchUpdate: Text + Image-Replacements
    const requests: Array<Record<string, unknown>> = [];

    for (const [key, value] of Object.entries(input.textVars)) {
      // BatchUpdate koennen mehrere `replaceAllText`-Ops nacheinander
      // ausfuehren — `containsText.text` ist 1:1 String-Match, kein Regex.
      requests.push({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: value ?? "",
        },
      });
    }
    // Auch leere Platzhalter werden weggewischt — wenn der User einen
    // Platzhalter im Doc hat, aber kein Mapping → Token wird `""`.
    // Niemals `{{anrede}}` als Rohtext im PDF.

    if (qrObjectId && input.qrImageUrl) {
      requests.push({
        replaceImage: {
          imageObjectId: qrObjectId,
          uri: input.qrImageUrl,
          imageReplaceMethod: "CENTER_CROP",
        },
      });
    }
    if (thumbObjectId && input.thumbnailImageUrl) {
      requests.push({
        replaceImage: {
          imageObjectId: thumbObjectId,
          uri: input.thumbnailImageUrl,
          imageReplaceMethod: "CENTER_CROP",
        },
      });
    }

    if (requests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: copyId,
        requestBody: { requests },
      });
    }

    // 4. PDF export
    const exportRes = await drive.files.export(
      {
        fileId: copyId,
        mimeType: "application/pdf",
      },
      { responseType: "arraybuffer" },
    );

    const pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);
    if (pdfBuffer.length < 1000) {
      // Sanity-Check — Drive-Export antwortet niemals mit <1KB-PDFs.
      throw new Error(
        `Drive PDF export returned suspiciously small buffer: ${pdfBuffer.length} bytes`,
      );
    }

    return {
      pdfBuffer,
      qrReplaced: Boolean(qrObjectId),
      thumbReplaced: Boolean(thumbObjectId),
      textReplacements: Object.keys(input.textVars).length,
    };
  } finally {
    // 5. Cleanup — best-effort, niemals werfen.
    drive.files
      .delete({ fileId: copyId, supportsAllDrives: true })
      .catch((err) => {
        console.warn(
          `[drive-pdf] cleanup delete failed for copy=${copyId}:`,
          err instanceof Error ? err.message : err,
        );
      });
  }
}
