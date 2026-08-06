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
 *
 * QR-Ersetzung — inline vs. positioned (Incident 2026-07-15):
 *   Ein FLOATING QR-Platzhalter (positionedObjects) wird von Googles Renderer
 *   am unteren Seitenrand GECLAMPT: Wird der Brieftext durch laengere
 *   Personalisierungs-Werte eine Zeile laenger, wandert die Textzeile ueber
 *   dem QR nach unten, die Box aber nicht mehr → Text laeuft sichtbar in den
 *   QR (gemessen: Box blieb bei identischer Seiten-Position, waehrend die
 *   URL-Zeile 14pt tiefer rutschte). Die Docs-API kann positioned objects
 *   weder verschieben noch resizen. Darum wird ein positioned QR-Platzhalter
 *   in ein INLINE-Bild konvertiert: deletePositionedObject + insertInlineImage
 *   in einem eigenen Absatz direkt nach dem Anker-Absatz, mit exakt der
 *   Platzhalter-Groesse. Ein Inline-Bild reserviert seinen Platz im Textfluss
 *   — Text kann nie hineinlaufen, und der QR wandert immer mit seiner Zeile.
 *   Inline-Platzhalter werden weiterhin per replaceImage ersetzt (kein
 *   Clamping-Problem, Layout bleibt 1:1 erhalten).
 *   WICHTIG: Die Index-basierten Insert-Requests MUESSEN im batchUpdate VOR
 *   allen replaceAllText-Requests stehen — Textersetzungen verschieben die
 *   Indizes aus documents.get.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDriveClient, getDocsClient, extractDocId } from "@/lib/google-docs/sa-auth";
import { uploadFile, deleteFile } from "@/lib/bunny/storage";
import { acquireDocsWriteSlot, withGoogleRetry } from "./google-api-guard";
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
interface QrTarget {
  objectId: string;
  kind: "inline" | "positioned";
  widthPt: number;
  heightPt: number;
  /** Nur bei positioned: horizontaler Offset relativ zur Textspalte. */
  leftOffsetPt: number;
}

interface ImageCandidates {
  qr: QrTarget | null;
  thumbObjectId: string | null;
}

function findImageCandidates(doc: docs_v1.Schema$Document): ImageCandidates {
  // Kandidaten aus BEIDEN Maps sammeln — inlineObjects UND positionedObjects.
  // Google Docs unterscheidet: "In line with text" landet in `inlineObjects`,
  // "Wrap text / Behind / In front" (floating) in `positionedObjects`.
  // Beide Object-IDs teilen sich den Namespace (`kix.<hash>`) und beide
  // sind gültige `imageObjectId`-Werte für replaceImage.
  const candidates: Array<{
    id: string;
    kind: "inline" | "positioned";
    w: number;
    h: number;
    leftOffsetPt: number;
  }> = [];

  for (const [id, obj] of Object.entries(doc.inlineObjects ?? {})) {
    const size = obj.inlineObjectProperties?.embeddedObject?.size;
    const w = size?.width?.magnitude;
    const h = size?.height?.magnitude;
    if (!w || !h) continue;
    candidates.push({ id, kind: "inline", w, h, leftOffsetPt: 0 });
  }
  for (const [id, obj] of Object.entries(doc.positionedObjects ?? {})) {
    const size = obj.positionedObjectProperties?.embeddedObject?.size;
    const w = size?.width?.magnitude;
    const h = size?.height?.magnitude;
    if (!w || !h) continue;
    candidates.push({
      id,
      kind: "positioned",
      w,
      h,
      leftOffsetPt: obj.positionedObjectProperties?.positioning?.leftOffset?.magnitude ?? 0,
    });
  }

  let qr: QrTarget | null = null;
  let thumbObjectId: string | null = null;
  for (const c of candidates) {
    const aspect = c.w / c.h;
    // Quadratisch → QR
    if (!qr && aspect >= 0.95 && aspect <= 1.05) {
      qr = {
        objectId: c.id,
        kind: c.kind,
        widthPt: c.w,
        heightPt: c.h,
        leftOffsetPt: c.leftOffsetPt,
      };
      continue;
    }
    // 16:9 → Thumbnail
    if (!thumbObjectId && aspect >= 1.7 && aspect <= 1.83) {
      thumbObjectId = c.id;
      continue;
    }
  }
  return { qr, thumbObjectId };
}

/**
 * Seitenzahl des unveraenderten Templates, gecacht pro Source-Doc-ID.
 * Wird als Referenz benutzt, um Seitenueberlauf durch das eingefuegte
 * Inline-QR zu erkennen (das Inline-Bild belegt ~60pt echten Textfluss-
 * Platz, den der floating Platzhalter nicht brauchte).
 */
const templatePageCountCache = new Map<string, number>();

async function countPdfPages(buf: Buffer): Promise<number> {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  return pdf.getPageCount();
}

/**
 * Sammelt alle LEEREN Absaetze (nur \n, keine verankerten Objekte) vor dem
 * Absatz, der das angegebene Inline-Objekt enthaelt — in Doc-Reihenfolge.
 * Kandidaten fuer die Ueberlauf-Kompensation. Achtung: Leerabsaetze koennen
 * winzig formatiert sein (Mini-Fontgroesse als Fein-Spacer), einzelne
 * Loeschungen bringen dann kaum Hoehe — darum werden mehrere pro Iteration
 * geloescht.
 */
function findEmptyParagraphsBeforeInlineObject(
  doc: docs_v1.Schema$Document,
  inlineObjectId: string,
): Array<{ start: number; end: number }> {
  const empties: Array<{ start: number; end: number }> = [];
  for (const el of doc.body?.content ?? []) {
    const p = el.paragraph;
    if (!p || typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;
    const containsQr = (p.elements ?? []).some(
      (e) => e.inlineObjectElement?.inlineObjectId === inlineObjectId,
    );
    if (containsQr) return empties;
    const isEmpty =
      el.endIndex - el.startIndex === 1 && (p.positionedObjectIds ?? []).length === 0;
    if (isEmpty) empties.push({ start: el.startIndex, end: el.endIndex });
  }
  return [];
}

/**
 * Findet den Absatz, an dem ein positioned object verankert ist, und gibt
 * dessen endIndex zurueck (Index HINTER dem terminierenden \n).
 */
function findAnchorParagraphEnd(
  doc: docs_v1.Schema$Document,
  objectId: string,
): number | null {
  for (const el of doc.body?.content ?? []) {
    const p = el.paragraph;
    if (!p) continue;
    if ((p.positionedObjectIds ?? []).includes(objectId) && typeof el.endIndex === "number") {
      return el.endIndex;
    }
  }
  return null;
}

/**
 * Leitet die horizontale Ausrichtung des Inline-QR aus der Position des
 * urspruenglichen positioned object ab (leftOffset ist relativ zum linken
 * Spaltenrand), damit der QR horizontal dort landet, wo der Platzhalter sass.
 */
function computeQrAlignment(
  doc: docs_v1.Schema$Document,
  qr: QrTarget,
): "START" | "CENTER" | "END" {
  const ds = doc.documentStyle;
  const pageW = ds?.pageSize?.width?.magnitude;
  const marginL = ds?.marginLeft?.magnitude ?? 72;
  const marginR = ds?.marginRight?.magnitude ?? 72;
  if (!pageW) return "CENTER";
  const columnW = pageW - marginL - marginR;
  const qrCenter = qr.leftOffsetPt + qr.widthPt / 2;
  if (Math.abs(qrCenter - columnW / 2) <= 24) return "CENTER";
  return qrCenter < columnW / 2 ? "START" : "END";
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
    const copy = await withGoogleRetry("drive.files.copy", () =>
      drive.files.copy({
        fileId: docId,
        requestBody: { name: copyName, parents: [sharedDriveId] },
        supportsAllDrives: true,
      }),
    );
    if (!copy.data.id) {
      throw new Error("drive.files.copy hat keine ID zurückgegeben.");
    }
    copyDocId = copy.data.id;

    // 2. Doc-Struktur holen für Bild-Identifikation.
    let qrTarget: QrTarget | null = null;
    let qrAnchorEnd: number | null = null;
    let qrAlignment: "START" | "CENTER" | "END" = "CENTER";
    let thumbObjectId: string | null = null;
    if (input.qrPngPath || input.thumbnailFilePath) {
      const structure = await withGoogleRetry("docs.documents.get", () =>
        docs.documents.get({ documentId: copyDocId! }),
      );
      const candidates = findImageCandidates(structure.data);
      qrTarget = candidates.qr;
      thumbObjectId = candidates.thumbObjectId;
      if (qrTarget?.kind === "positioned") {
        qrAnchorEnd = findAnchorParagraphEnd(structure.data, qrTarget.objectId);
        qrAlignment = computeQrAlignment(structure.data, qrTarget);
      }
    }

    // 2b. Referenz-Seitenzahl des unveraenderten Templates (nur bei
    // Inline-Konvertierung noetig, pro Template gecacht). Die Copy ist hier
    // noch unveraendert — ihr Export entspricht dem Template.
    let baselinePages: number | null = null;
    if (qrTarget?.kind === "positioned" && qrAnchorEnd !== null && input.qrPngPath) {
      const cached = templatePageCountCache.get(docId);
      if (cached !== undefined) {
        baselinePages = cached;
      } else {
        const baseRes = await withGoogleRetry("drive.files.export(baseline)", () =>
          drive.files.export(
            { fileId: copyDocId!, mimeType: "application/pdf" },
            { responseType: "arraybuffer" },
          ),
        );
        baselinePages = await countPdfPages(Buffer.from(baseRes.data as ArrayBuffer));
        templatePageCountCache.set(docId, baselinePages);
      }
    }

    // 3. QR und Thumbnail nach Bunny hochladen, damit Docs-API sie via URL
    // referenzieren kann. Bunny-CDN-URL ist public HTTPS — passt fuer replaceImage.
    let qrBunnyUrl: string | null = null;
    if (input.qrPngPath && qrTarget) {
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

    // 4. Requests fuer batchUpdate zusammenbauen.
    // Index-basierte QR-Requests MUESSEN zuerst kommen (siehe Header-Kommentar):
    // replaceAllText veraendert Textlaengen und damit alle Indizes dahinter.
    const requests: docs_v1.Schema$Request[] = [];
    if (qrTarget && qrBunnyUrl) {
      if (qrTarget.kind === "positioned" && qrAnchorEnd !== null) {
        // Floating-Platzhalter → Inline-Konvertierung.
        // Anker-Absatz endet bei qrAnchorEnd; sein terminierendes \n liegt
        // bei qrAnchorEnd-1. Dort ein \n einfuegen splittet den Absatz und
        // erzeugt einen leeren Folge-Absatz [qrAnchorEnd, qrAnchorEnd+1),
        // in den das Inline-Bild bei Index qrAnchorEnd eingesetzt wird.
        requests.push(
          { insertText: { location: { index: qrAnchorEnd - 1 }, text: "\n" } },
          {
            insertInlineImage: {
              location: { index: qrAnchorEnd },
              uri: qrBunnyUrl,
              objectSize: {
                width: { magnitude: qrTarget.widthPt, unit: "PT" },
                height: { magnitude: qrTarget.heightPt, unit: "PT" },
              },
            },
          },
          {
            // lineSpacing 100% + Abstaende 0: Der QR-Absatz erbt sonst den
            // Zeilenabstand des URL-Absatzes (~115%) — das kostet ~9pt und
            // schiebt knappe Briefe (langer {{ort}}/{{firma}}-Umbruch) auf
            // Seite 2, obwohl der QR selbst noch passen wuerde.
            updateParagraphStyle: {
              range: { startIndex: qrAnchorEnd, endIndex: qrAnchorEnd + 1 },
              paragraphStyle: {
                alignment: qrAlignment,
                lineSpacing: 100,
                spaceAbove: { magnitude: 0, unit: "PT" },
                spaceBelow: { magnitude: 0, unit: "PT" },
              },
              fields: "alignment,lineSpacing,spaceAbove,spaceBelow",
            },
          },
          { deletePositionedObject: { objectId: qrTarget.objectId } },
        );
      } else {
        requests.push({
          replaceImage: {
            imageObjectId: qrTarget.objectId,
            uri: qrBunnyUrl,
            imageReplaceMethod: "CENTER_CROP",
          },
        });
      }
    }
    for (const [key, value] of Object.entries(input.textVars)) {
      requests.push({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: value ?? "",
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
    let qrInlineObjectId: string | null = null;
    if (requests.length > 0) {
      // Slot-Acquire INNERHALB der Retry-Fn: jeder Versuch (auch Retry)
      // ist ein Write und zaehlt auf die 60/min-Quota.
      const res = await withGoogleRetry("docs.documents.batchUpdate", async () => {
        await acquireDocsWriteSlot();
        return docs.documents.batchUpdate({
          documentId: copyDocId!,
          requestBody: { requests },
        });
      });
      const replies = res.data.replies ?? [];
      textReplacements = replies.reduce(
        (sum, r) => sum + (r.replaceAllText?.occurrencesChanged ?? 0),
        0,
      );
      qrInlineObjectId =
        replies.find((r) => r.insertInlineImage?.objectId)?.insertInlineImage?.objectId ?? null;
    }

    // 5. PDF-Export via Google's eigenen Renderer.
    const exportPdf = async (): Promise<Buffer> => {
      const pdfRes = await withGoogleRetry("drive.files.export", () =>
        drive.files.export(
          { fileId: copyDocId!, mimeType: "application/pdf" },
          { responseType: "arraybuffer" },
        ),
      );
      return Buffer.from(pdfRes.data as ArrayBuffer);
    };
    let pdfBuffer = await exportPdf();

    // 5b. Ueberlauf-Kompensation: Das Inline-QR belegt ~60pt Textfluss-Platz,
    // den der floating Platzhalter nicht brauchte. Kompensations-Kaskade in
    // vier Stufen, von komplett-unsichtbar zu sichtbar-destruktiv:
    //
    //   Stufe 1: marginBottom bis 30pt reduzieren (Fussrand schrumpft, sonst
    //            nichts). Bei 72pt Standard bleibt >40pt = ~1.5cm Rand.
    //   Stufe 2: marginTop bis 30pt reduzieren (Kopfrand schrumpft, sonst
    //            nichts). Adress-Header sitzt weiterhin oben, nur naeher am
    //            Blattrand.
    //   Stufe 3: lineSpacing global auf 100% setzen (falls hoeher). Spart
    //            ~10-15% Vertikal. Text wird kompakter, aber nicht gequetscht.
    //   Stufe 4: NUR wenn 1-3 nicht reichen — Leerabsaetze vor dem QR
    //            loeschen. Design-relevante Trenner koennen verschwinden.
    if (qrInlineObjectId && baselinePages !== null) {
      const MAX_ITERATIONS = 20;
      const EMPTIES_PER_ITERATION = 4;
      const MARGIN_STEP_PT = 4;
      const MARGIN_MAX_REDUCTION_PT = 30;
      let marginBottomReducedPt = 0;
      let currentMarginBottomPt: number | null = null;
      let marginTopReducedPt = 0;
      let currentMarginTopPt: number | null = null;
      let lineSpacingReduced = false;
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const pages = await countPdfPages(pdfBuffer);
        if (pages <= baselinePages) break;
        const struct = await withGoogleRetry("docs.documents.get(compensate)", () =>
          docs.documents.get({ documentId: copyDocId! }),
        );
        let requests: docs_v1.Schema$Request[];
        // Stufe 1: marginBottom reduzieren.
        if (marginBottomReducedPt < MARGIN_MAX_REDUCTION_PT) {
          currentMarginBottomPt ??=
            struct.data.documentStyle?.marginBottom?.magnitude ?? 72;
          currentMarginBottomPt -= MARGIN_STEP_PT;
          marginBottomReducedPt += MARGIN_STEP_PT;
          console.warn(
            `[docs-native] page overflow (${pages} > ${baselinePages}) — reducing marginBottom to ${currentMarginBottomPt}pt (iter ${i + 1}/${MAX_ITERATIONS})`,
          );
          requests = [
            {
              updateDocumentStyle: {
                documentStyle: {
                  marginBottom: { magnitude: currentMarginBottomPt, unit: "PT" },
                },
                fields: "marginBottom",
              },
            },
          ];
        } else if (marginTopReducedPt < MARGIN_MAX_REDUCTION_PT) {
          // Stufe 2: marginTop reduzieren.
          currentMarginTopPt ??=
            struct.data.documentStyle?.marginTop?.magnitude ?? 72;
          currentMarginTopPt -= MARGIN_STEP_PT;
          marginTopReducedPt += MARGIN_STEP_PT;
          console.warn(
            `[docs-native] page overflow (${pages} > ${baselinePages}) — reducing marginTop to ${currentMarginTopPt}pt (iter ${i + 1}/${MAX_ITERATIONS})`,
          );
          requests = [
            {
              updateDocumentStyle: {
                documentStyle: {
                  marginTop: { magnitude: currentMarginTopPt, unit: "PT" },
                },
                fields: "marginTop",
              },
            },
          ];
        } else if (!lineSpacingReduced) {
          // Stufe 3: lineSpacing global auf 100% (falls > 100%) fuer ALLE
          // Paragraphen im Body. Google-Docs-Standard ist oft 115% — die
          // Reduktion auf 100% spart pro 20 Zeilen etwa 30pt.
          lineSpacingReduced = true;
          console.warn(
            `[docs-native] page overflow (${pages} > ${baselinePages}) — setting lineSpacing 100% on all body paragraphs (iter ${i + 1}/${MAX_ITERATIONS})`,
          );
          const bodyEnd =
            struct.data.body?.content?.[struct.data.body.content.length - 1]
              ?.endIndex ?? 1;
          requests = [
            {
              updateParagraphStyle: {
                range: { startIndex: 1, endIndex: Math.max(2, bodyEnd - 1) },
                paragraphStyle: { lineSpacing: 100 },
                fields: "lineSpacing",
              },
            },
          ];
        } else {
          // Stufe 4: letzte Instanz — Leerabsaetze vor dem QR loeschen.
          const batch = findEmptyParagraphsBeforeInlineObject(struct.data, qrInlineObjectId)
            .slice(-EMPTIES_PER_ITERATION)
            .sort((a, b) => b.start - a.start);
          if (batch.length > 0) {
            console.warn(
              `[docs-native] page overflow (${pages} > ${baselinePages}) — LAST RESORT: removing ${batch.length} empty paragraph(s) (iter ${i + 1}/${MAX_ITERATIONS})`,
            );
            requests = batch.map((r) => ({
              deleteContentRange: {
                range: { startIndex: r.start, endIndex: r.end },
              },
            }));
          } else {
            console.warn(
              `[docs-native] page overflow (${pages} > ${baselinePages}) — compensation exhausted, accepting extra page.`,
            );
            break;
          }
        }
        await withGoogleRetry("docs.documents.batchUpdate(compensate)", async () => {
          await acquireDocsWriteSlot();
          return docs.documents.batchUpdate({
            documentId: copyDocId!,
            requestBody: { requests },
          });
        });
        pdfBuffer = await exportPdf();
      }
    }

    return {
      pdfBuffer,
      textReplacements,
      qrReplaced: qrTarget !== null && qrBunnyUrl !== null,
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
