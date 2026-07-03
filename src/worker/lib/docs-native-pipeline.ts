/**
 * Renderer 4.0 — Docs-API-native PDF-Generierung.
 *
 * Warum das existiert:
 *   - Google Docs' HTML-Export (Renderer 3.0) flacht Absatz-Abstände aus
 *     → Puppeteer rendert Absätze zu weit auseinander.
 *   - LibreOffice (Renderer 2.0) verschluckt Floating-Bilder komplett.
 *   - Google's eigener PDF-Renderer liefert 1:1-Layout wie in der Docs-UI.
 *
 * Pipeline (pro Lead):
 *   1. drive.files.copy(fileId, { parents: [SHARED_DRIVE_ID] })
 *   2. documents.get → finde QR/Thumbnail-Marker per Aspect-Ratio
 *   3. Upload QR/Thumbnail nach Bunny → CDN-URL
 *   4. documents.batchUpdate(replaceAllText + replaceImage)
 *   5. drive.files.export(mimeType=application/pdf)
 *   6. drive.files.delete(copyId) + Bunny-Cleanup — try/finally.
 *
 * Voraussetzungen:
 *   - GOOGLE_DRIVE_SA_KEY (Service-Account-JSON)
 *   - GOOGLE_SHARED_DRIVE_ID (Shared Drive wo SA Manager ist)
 *   - BUNNY_STORAGE_ACCESS_KEY + Zone-Config für temp-QR-Hosting
 *   - Kunden-Doc auf "Jeder mit Link → Betrachter"
 *
 * Bild-Identifikation:
 *   Wir traversieren body.content → alle inlineObjectElements, holen ihre
 *   angezeigte Groesse aus inlineObjects[id]. Klassifikation nach Aspect-Ratio:
 *     - 0.95..1.05 (quadratisch) → QR-Kandidat
 *     - 1.70..1.83 (~16:9)       → Thumbnail-Kandidat
 *   Bei mehreren Kandidaten: den ERSTEN nehmen (Doc-Reihenfolge).
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDriveClient, getDocsClient, extractDocId } from "@/lib/google-docs/sa-auth";
import { uploadFile, deleteFile } from "@/lib/bunny/storage";
import type { docs_v1 } from "googleapis";

export interface DocsNativePipelineInput {
  googleDocsUrl: string;
  textVars: Record<string, string>;
  /** Optional: eindeutiger Suffix für die Copy (Debugging). */
  copyNameHint?: string;
  /** Optional: Pfad zum personalisierten QR-Code (PNG). */
  qrPngPath?: string | null;
  /** Optional: Pfad zum personalisierten Thumbnail (PNG/JPG). */
  thumbnailFilePath?: string | null;
}

export interface DocsNativePipelineOutput {
  pdfBuffer: Buffer;
  textReplacements: number;
  qrReplaced: boolean;
  thumbReplaced: boolean;
  copyDocId: string;
}

export function isDocsNativeConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHARED_DRIVE_ID && process.env.GOOGLE_DRIVE_SA_KEY);
}

function getSharedDriveId(): string {
  const id = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_SHARED_DRIVE_ID nicht gesetzt — Renderer 4.0 ist nicht konfiguriert.",
    );
  }
  return id;
}

/**
 * Findet Kandidaten fuer QR und Thumbnail im Doc anhand ihrer Aspect-Ratio.
 * Wir nutzen die ANGEZEIGTE Groesse (was im Doc drin steht), weil die
 * Original-Pixel-Groesse via Docs-API nicht direkt zugaenglich ist —
 * Aspect-Ratio ist aber stabil (100x100 → 1:1 bleibt 1:1, egal wie skaliert).
 */
interface ImageCandidates {
  qrObjectId: string | null;
  thumbObjectId: string | null;
}

function findImageCandidates(doc: docs_v1.Schema$Document): ImageCandidates {
  // Kandidaten aus BEIDEN Maps sammeln — inlineObjects UND positionedObjects.
  // Google Docs unterscheidet: "In line with text" landet in `inlineObjects`,
  // "Wrap text / Behind / In front" (floating) in `positionedObjects`.
  // Beide Object-IDs teilen sich den Namespace (`kix.<hash>`) und beide
  // sind gültige `imageObjectId`-Werte für replaceImage.
  const candidates: Array<{ id: string; aspect: number }> = [];

  for (const [id, obj] of Object.entries(doc.inlineObjects ?? {})) {
    const size = obj.inlineObjectProperties?.embeddedObject?.size;
    const w = size?.width?.magnitude;
    const h = size?.height?.magnitude;
    if (!w || !h) continue;
    candidates.push({ id, aspect: w / h });
  }
  for (const [id, obj] of Object.entries(doc.positionedObjects ?? {})) {
    const size = obj.positionedObjectProperties?.embeddedObject?.size;
    const w = size?.width?.magnitude;
    const h = size?.height?.magnitude;
    if (!w || !h) continue;
    candidates.push({ id, aspect: w / h });
  }

  let qrObjectId: string | null = null;
  let thumbObjectId: string | null = null;
  for (const c of candidates) {
    // Quadratisch → QR
    if (!qrObjectId && c.aspect >= 0.95 && c.aspect <= 1.05) {
      qrObjectId = c.id;
      continue;
    }
    // 16:9 → Thumbnail
    if (!thumbObjectId && c.aspect >= 1.7 && c.aspect <= 1.83) {
      thumbObjectId = c.id;
      continue;
    }
  }
  return { qrObjectId, thumbObjectId };
}

export async function renderViaDocsApi(
  input: DocsNativePipelineInput,
): Promise<DocsNativePipelineOutput> {
  const docId = extractDocId(input.googleDocsUrl);
  if (!docId) {
    throw new Error(`Ungültige Google-Docs-URL: ${input.googleDocsUrl}`);
  }

  const drive = getDriveClient();
  const docs = getDocsClient();
  const sharedDriveId = getSharedDriveId();

  const copyName = `VC-render-${input.copyNameHint ?? "lead"}-${Date.now()}`;
  let copyDocId: string | null = null;
  const bunnyCleanupPaths: string[] = [];

  try {
    // 1. Doc in Shared Drive kopieren.
    const copy = await drive.files.copy({
      fileId: docId,
      requestBody: { name: copyName, parents: [sharedDriveId] },
      supportsAllDrives: true,
    });
    if (!copy.data.id) {
      throw new Error("drive.files.copy hat keine ID zurückgegeben.");
    }
    copyDocId = copy.data.id;

    // 2. Doc-Struktur holen für Bild-Identifikation.
    let qrObjectId: string | null = null;
    let thumbObjectId: string | null = null;
    if (input.qrPngPath || input.thumbnailFilePath) {
      const structure = await docs.documents.get({ documentId: copyDocId });
      const candidates = findImageCandidates(structure.data);
      qrObjectId = candidates.qrObjectId;
      thumbObjectId = candidates.thumbObjectId;
    }

    // 3. QR und Thumbnail nach Bunny hochladen, damit Docs-API sie via URL
    // referenzieren kann. Bunny-CDN-URL ist public HTTPS — passt fuer replaceImage.
    let qrBunnyUrl: string | null = null;
    if (input.qrPngPath && qrObjectId) {
      const buf = await readFile(input.qrPngPath);
      const remotePath = `docs-native-tmp/qr-${randomUUID()}.png`;
      const uploaded = await uploadFile({
        buffer: buf,
        remotePath,
        contentType: "image/png",
      });
      qrBunnyUrl = uploaded.url;
      bunnyCleanupPaths.push(uploaded.remotePath);
    }
    let thumbBunnyUrl: string | null = null;
    if (input.thumbnailFilePath && thumbObjectId) {
      const buf = await readFile(input.thumbnailFilePath);
      // Content-Type raten anhand Endung — JPG oder PNG.
      const isJpg = /\.jpe?g$/i.test(input.thumbnailFilePath);
      const remotePath = `docs-native-tmp/thumb-${randomUUID()}.${isJpg ? "jpg" : "png"}`;
      const uploaded = await uploadFile({
        buffer: buf,
        remotePath,
        contentType: isJpg ? "image/jpeg" : "image/png",
      });
      thumbBunnyUrl = uploaded.url;
      bunnyCleanupPaths.push(uploaded.remotePath);
    }

    // 4. Requests fuer batchUpdate zusammenbauen: replaceAllText + replaceImage.
    const requests: docs_v1.Schema$Request[] = [];
    for (const [key, value] of Object.entries(input.textVars)) {
      requests.push({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: value ?? "",
        },
      });
    }
    if (qrObjectId && qrBunnyUrl) {
      requests.push({
        replaceImage: {
          imageObjectId: qrObjectId,
          uri: qrBunnyUrl,
          imageReplaceMethod: "CENTER_CROP",
        },
      });
    }
    if (thumbObjectId && thumbBunnyUrl) {
      requests.push({
        replaceImage: {
          imageObjectId: thumbObjectId,
          uri: thumbBunnyUrl,
          imageReplaceMethod: "CENTER_CROP",
        },
      });
    }

    let textReplacements = 0;
    if (requests.length > 0) {
      const res = await docs.documents.batchUpdate({
        documentId: copyDocId,
        requestBody: { requests },
      });
      textReplacements = (res.data.replies ?? []).reduce(
        (sum, r) => sum + (r.replaceAllText?.occurrencesChanged ?? 0),
        0,
      );
    }

    // 5. PDF-Export via Google's eigenen Renderer.
    const pdfRes = await drive.files.export(
      { fileId: copyDocId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    );
    const pdfBuffer = Buffer.from(pdfRes.data as ArrayBuffer);

    return {
      pdfBuffer,
      textReplacements,
      qrReplaced: qrObjectId !== null && qrBunnyUrl !== null,
      thumbReplaced: thumbObjectId !== null && thumbBunnyUrl !== null,
      copyDocId,
    };
  } finally {
    // 6. Cleanup — auch bei Fehlern.
    if (copyDocId) {
      try {
        await drive.files.delete({
          fileId: copyDocId,
          supportsAllDrives: true,
        });
      } catch (err) {
        console.warn(
          `[docs-native] doc-cleanup failed for ${copyDocId}: ${err instanceof Error ? err.message : "?"}`,
        );
      }
    }
    for (const path of bunnyCleanupPaths) {
      try {
        await deleteFile(path);
      } catch (err) {
        console.warn(
          `[docs-native] bunny-cleanup failed for ${path}: ${err instanceof Error ? err.message : "?"}`,
        );
      }
    }
  }
}
