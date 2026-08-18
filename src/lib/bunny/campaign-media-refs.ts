/**
 * campaign_media-Ref-Sync (Migration 0062).
 *
 * Problem (2026-08-18): Kampagnen-Segmente referenzieren Dateien in Bunny
 * Storage (PDF-Segment: Original-PDF + Seiten-PNGs, Canva: PPTX, Folien:
 * Thumbnails), die beim Upload NICHT im bunny_assets-Register landeten.
 * Beim Löschen der Kampagne oder Ersetzen einer Szene blieben die Dateien
 * für immer in Storage liegen.
 *
 * Lösung: Bei jedem Kampagnen-Save (POST/PATCH mit `segments`) werden alle
 * Storage-URLs aus dem Segments-JSON eingesammelt und als Assets mit einer
 * Ref (owner 'campaign_media', ownerId = campaignId) registriert. Nicht
 * mehr referenzierte Dateien verlieren ihre Ref; der Orphan-Sweep des
 * Purge-Workers räumt sie dann aus Bunny. Das Campaign-DELETE entfernt
 * alle campaign_media-Refs.
 *
 * Der Sync läuft beim SAVE statt beim Upload, weil Studio/Wizard Dateien
 * hochladen, BEVOR die Kampagne existiert — erst das Segments-JSON macht
 * die Zugehörigkeit eindeutig. Nebeneffekt: Bestandskampagnen heilen sich
 * beim nächsten Editor-Save selbst.
 *
 * Sicherheit: NUR URLs auf dem eigenen Storage-CDN-Host werden erfasst.
 * Bunny-STREAM-URLs (vz-*.b-cdn.net, Video-/Webcam-Segmente) laufen über
 * die bestehenden media_item-Refs und werden hier bewusst ignoriert.
 *
 * ACHTUNG für die Zukunft: Sollte je ein „Kampagne duplizieren"-Feature
 * kommen, das Segments-JSON 1:1 kopiert, MUSS die Kopie sofort gesynct
 * werden — sonst purged das Löschen des Originals die geteilten Dateien.
 */

import {
  addBunnyAssetRef,
  getBunnyAssetIdsForOwner,
  removeBunnyAssetRefsByAssetIds,
  trackBunnyAsset,
} from "@/lib/db/queries/bunny-assets";
import { getBunnyStorageEnv } from "./env";

/**
 * Sammelt rekursiv alle Strings aus dem Segments-JSON, die URLs auf dem
 * eigenen Storage-CDN-Host sind. Exported für Tests.
 */
export function collectStorageUrls(
  value: unknown,
  cdnHostname: string,
): string[] {
  const urls = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (!v.startsWith("https://") && !v.startsWith("http://")) return;
      try {
        const parsed = new URL(v);
        if (parsed.hostname.toLowerCase() === cdnHostname.toLowerCase()) {
          urls.add(v);
        }
      } catch {
        // kein valider URL — ignorieren
      }
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(value);
  return Array.from(urls);
}

/**
 * Gleicht die campaign_media-Refs einer Kampagne mit ihrem aktuellen
 * Segments-JSON ab: fehlende Assets/Refs anlegen, Refs auf nicht mehr
 * referenzierte Dateien entfernen. Best-effort — Fehler dürfen den
 * Kampagnen-Save nie blockieren (Caller: fire-and-forget mit catch).
 */
export async function syncCampaignMediaRefs(
  userId: string,
  campaignId: string,
  segments: unknown,
): Promise<void> {
  const cdnHostname = getBunnyStorageEnv().cdnHostname;
  const urls = collectStorageUrls(segments, cdnHostname);

  const desired = new Set<string>();
  for (const url of urls) {
    const remotePath = new URL(url).pathname.replace(/^\/+/, "");
    if (!remotePath) continue;
    const { assetId } = await trackBunnyAsset({
      userId,
      kind: "storage",
      bunnyId: remotePath,
      cdnUrl: url,
    });
    await addBunnyAssetRef(assetId, "campaign_media", campaignId);
    desired.add(assetId);
  }

  const existing = await getBunnyAssetIdsForOwner("campaign_media", campaignId);
  const stale = existing.filter((id) => !desired.has(id));
  await removeBunnyAssetRefsByAssetIds(stale, "campaign_media", campaignId);
}
