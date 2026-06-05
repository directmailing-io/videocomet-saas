/**
 * Helper für das Bunny-Asset-Tracking-Pattern.
 *
 * Hintergrund:
 *   Mehrere Pipeline-Stages (video-upload, video-resolve-shared, …)
 *   führen die gleiche zwei-Schritt-Sequenz aus:
 *     1. `trackBunnyAsset(input)` → `{ assetId, created }`
 *     2. `addBunnyAssetRef(assetId, ownerType, ownerId)`
 *
 *   Wenn Schritt 1 fehlschlägt oder den Property-Namen falsch liest
 *   (`asset.id` statt `asset.assetId` — der Bug aus Paket D), wird die
 *   Ref nie geschrieben. Der Purge-Sweep markiert das gerade frisch
 *   hochgeladene Asset dann als orphan → physisch gelöscht innerhalb 60s
 *   → Lead bekommt 404 auf die Video-URL.
 *
 *   Dieser Helper bündelt das Pattern an EINER Stelle, damit der Bug
 *   nicht erneut entstehen kann.
 *
 * Verhalten:
 *   - Fehler in `trackBunnyAsset` werden geloggt und der Caller bekommt
 *     `null` zurück (best-effort; Pipeline soll nicht abbrechen, wenn
 *     nur das Tracking kaputt ist).
 *   - Fehler in `addBunnyAssetRef` werden ebenfalls geloggt; trotzdem
 *     wird die `assetId` zurückgegeben, weil der Caller sie evtl.
 *     noch für andere Refs braucht.
 */

import {
  addBunnyAssetRef,
  trackBunnyAsset,
  type OwnerType,
  type TrackBunnyAssetInput,
} from "@/lib/db/queries/bunny-assets";

export interface TrackAndRefAssetInput {
  trackInput: TrackBunnyAssetInput;
  ownerType: OwnerType;
  ownerId: string;
}

/**
 * Trackt einen Bunny-Asset und legt direkt die Owner-Ref an. Idempotent
 * über die UNIQUE-Indizes in `bunny_assets` und `bunny_asset_refs`.
 *
 * Returns:
 *   - `assetId` (string) wenn das Tracking erfolgreich war.
 *   - `null` wenn das Tracking-Insert fehlgeschlagen ist (Pipeline läuft
 *     trotzdem weiter, Asset bleibt evtl. orphan — Purge-Worker räumt
 *     irgendwann auf).
 */
export async function trackAndRefAsset(
  input: TrackAndRefAssetInput,
): Promise<string | null> {
  let assetId: string;
  try {
    const tracked = await trackBunnyAsset(input.trackInput);
    assetId = tracked.assetId;
  } catch (err) {
    console.warn(
      `[bunny-asset-tracking] trackBunnyAsset failed (kind=${input.trackInput.kind}, bunnyId=${input.trackInput.bunnyId}): ${(err as Error).message}`,
    );
    return null;
  }

  try {
    await addBunnyAssetRef(assetId, input.ownerType, input.ownerId);
  } catch (err) {
    console.warn(
      `[bunny-asset-tracking] addBunnyAssetRef failed (assetId=${assetId}, ownerType=${input.ownerType}, ownerId=${input.ownerId}): ${(err as Error).message}`,
    );
    // Wir geben trotzdem die assetId zurück — sie ist gültig, nur die
    // Ref hängt. Caller kann später retry'en.
  }

  return assetId;
}
