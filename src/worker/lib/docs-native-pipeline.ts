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
 *      → Kopie im Shared Drive (dessen Storage der Organisation gehört, nicht dem SA).
 *   2. documents.batchUpdate(replaceAllText) für alle Merge-Tags.
 *   3. drive.files.export(mimeType=application/pdf) → PDF-Buffer.
 *   4. drive.files.delete(copyId) — auch bei Errors (try/finally).
 *
 * Voraussetzungen:
 *   - GOOGLE_DRIVE_SA_KEY (Service-Account-JSON) im Env
 *   - GOOGLE_SHARED_DRIVE_ID im Env — Shared Drive wo der SA Manager ist
 *   - Kunden-Doc auf "Jeder mit Link → Betrachter" (oder mehr) freigegeben
 *
 * Bilder-Replacement (QR + Thumbnail) folgt in einem späteren Schritt.
 * Für v1 belassen wir die Marker-Bilder im Doc (unpersonalisiert).
 */

import { getDriveClient, getDocsClient, extractDocId } from "@/lib/google-docs/sa-auth";
import type { docs_v1 } from "googleapis";

export interface DocsNativePipelineInput {
  googleDocsUrl: string;
  textVars: Record<string, string>;
  /** Optional: eindeutiger Suffix für die Copy (Debugging). */
  copyNameHint?: string;
}

export interface DocsNativePipelineOutput {
  pdfBuffer: Buffer;
  textReplacements: number;
  /** ID der (mittlerweile gelöschten) temporären Doc-Kopie — für Logs. */
  copyDocId: string;
}

export function isDocsNativeConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHARED_DRIVE_ID && process.env.GOOGLE_DRIVE_SA_KEY);
}

/**
 * Erwartete Env: GOOGLE_SHARED_DRIVE_ID = Shared-Drive-Root-ID (startet
 * typischerweise mit "0A"). Wirft wenn nicht gesetzt.
 */
function getSharedDriveId(): string {
  const id = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_SHARED_DRIVE_ID nicht gesetzt — Renderer 4.0 ist nicht konfiguriert.",
    );
  }
  return id;
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

    // 2. Merge-Tags via batchUpdate replaceAllText ersetzen.
    // Wir bauen eine Request pro Merge-Tag. Unbekannte Tags im Template
    // (die nicht in textVars sind) werden von Google einfach ignoriert.
    // Zusätzlich räumen wir am Ende alle noch verbliebenen `{{...}}`
    // Patterns per weiterer Requests weg — sonst blieben unbekannte Tags
    // als roher Text im PDF stehen.
    const requests: docs_v1.Schema$Request[] = [];
    for (const [key, value] of Object.entries(input.textVars)) {
      requests.push({
        replaceAllText: {
          containsText: { text: `{{${key}}}`, matchCase: true },
          replaceText: value ?? "",
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

    // 3. PDF-Export via Google's eigenen Renderer.
    const pdfRes = await drive.files.export(
      { fileId: copyDocId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    );
    const pdfBuffer = Buffer.from(pdfRes.data as ArrayBuffer);

    return {
      pdfBuffer,
      textReplacements,
      copyDocId,
    };
  } finally {
    // 4. Cleanup — auch bei Fehlern.
    if (copyDocId) {
      try {
        await drive.files.delete({
          fileId: copyDocId,
          supportsAllDrives: true,
        });
      } catch (err) {
        console.warn(
          `[docs-native] cleanup failed for ${copyDocId}: ${err instanceof Error ? err.message : "?"}`,
        );
      }
    }
  }
}
