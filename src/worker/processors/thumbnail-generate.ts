/**
 * Pipeline-Stage `thumbnailGenerate` — Paket D.
 *
 * Rendert das `CampaignThumbnailImage` (Background + Layers) als 1280×720
 * PNG und lädt es nach Bunny Edge Storage. Caller (Pipeline-Orchestrator)
 * entscheidet vorher via `hasPersonalization()`, ob das einmal pro Run
 * (geteilt) oder pro Lead passiert.
 *
 * Diese Datei selbst kennt das Caching-Modell NICHT — sie macht genau
 * EINEN Render+Upload pro Aufruf. Das Lock- und Cache-Pattern liegt in
 * `pipeline.ts` (siehe Smart-Cache-Block dort), analog zu wie
 * `runVideoResolveShared` den shared-video-Cache verwaltet, aber simpler:
 * für Thumbnails reicht eine atomare „first writer wins"-Strategie ohne
 * eigenen State-Machine-Spalte (das Asset ist klein, Re-Render ist billig
 * im Vergleich zu Bunny-Stream-Uploads).
 *
 * Bunny-Zone:
 *   `videocomet-pdf` (Standard-Storage-Zone, identisch zum PDF-Upload).
 *   Die Zone-Auswahl passiert implizit in `uploadFile()` via Env, daher
 *   keine zusätzliche Konfiguration hier nötig.
 *
 * Remote-Pfad-Schema:
 *   - per-Lead:  `thumbnails/<runId>/<leadId>.png`
 *   - shared:    `thumbnails/<runId>/shared.png`
 *   Caller setzt den `remotePath` explizit, damit der Stage-Code keine
 *   Annahmen über das Cache-Modell trifft.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { uploadFile } from "@/lib/bunny/storage";
import type { CampaignThumbnailImage } from "@/lib/segments/types";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";
import { renderThumbnailToPng } from "../lib/slide-image-render";

export interface ThumbnailGenerateInput {
  /** Lead-ID (für Logging; nicht im Output-Pfad benutzt — siehe `remotePath`). */
  leadId: string;
  /** Run-ID (für Logging; identisch wie `leadId`). */
  runId: string;
  /** Lead-Daten für Substitution. Bei shared-Modus typischerweise `{}`. */
  leadData: Record<string, string>;
  /** Aufgelöste Landingpage-URL des Leads (System-Context für `{{pageUrl}}`). */
  pageUrl: string | null;
  /** Kampagnen-Thumbnail-Template (Background + Layers, JSONB). */
  thumbnailConfig: CampaignThumbnailImage;
  /** Optionales Placeholder-Mapping vom Run. */
  mapping?: PlaceholderMapping | LegacyMapping;
  /** Worker-tmp-Dir; der PNG wird hier zwischengelagert. */
  outDir: string;
  /**
   * Storage-Pfad inkl. Subdirs. Der Caller entscheidet das Cache-Modell:
   *   `thumbnails/<runId>/<leadId>.png`   → per-Lead
   *   `thumbnails/<runId>/shared.png`     → run-shared
   */
  remotePath: string;
}

export interface ThumbnailGenerateOutput {
  /** Öffentlich abrufbare CDN-URL des hochgeladenen PNGs. */
  thumbnailUrl: string;
  /** Bunny-Storage-Remote-Pfad (== input.remotePath, normalisiert). */
  remotePath: string;
}

/**
 * Rendert + lädt EIN Thumbnail-PNG hoch und liefert die CDN-URL zurück.
 * Idempotent gegenüber demselben `remotePath` — Bunny Storage PUT
 * überschreibt eine evtl. existierende Datei.
 */
export async function runThumbnailGenerate(
  input: ThumbnailGenerateInput,
): Promise<ThumbnailGenerateOutput> {
  // Eindeutiger lokaler Dateiname, damit parallele Lead-Jobs sich nicht
  // gegenseitig die Datei wegziehen (mehrere Worker-Prozesse können hier
  // gleichzeitig durchlaufen).
  const localPath = join(input.outDir, `thumb-${randomUUID()}.png`);

  await renderThumbnailToPng({
    content: input.thumbnailConfig,
    leadData: input.leadData,
    pageUrl: input.pageUrl,
    mapping: input.mapping,
    outputPath: localPath,
  });

  const buffer = await readFile(localPath);

  const uploaded = await uploadFile({
    buffer,
    remotePath: input.remotePath,
    contentType: "image/png",
  });

  return {
    thumbnailUrl: uploaded.url,
    remotePath: uploaded.remotePath,
  };
}
